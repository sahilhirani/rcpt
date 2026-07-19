import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_GATE_MAX_BLOCKS,
  findConfigPath,
  gateChecks,
  loadConfig,
} from "../core/config.js";
import { getGitState } from "../core/git.js";
import { buildReceipt, finalizeReceipt, rcptDir, saveReceipt } from "../core/receipt.js";
import { renderSummaryLine } from "../core/render.js";
import { runChecks } from "../core/run.js";
import type { CheckResult } from "../core/types.js";

const GATE_STATE_NAME = "gate-state.json";

interface GateState {
  sessionId: string | null;
  blocks: number;
  updatedAt: string;
}

interface StopHookInput {
  session_id?: string;
  stop_hook_active?: boolean;
  hook_event_name?: string;
}

function readGateState(rootDir: string): GateState | null {
  const path = join(rcptDir(rootDir), GATE_STATE_NAME);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as GateState;
  } catch {
    return null;
  }
}

function writeGateState(rootDir: string, state: GateState): void {
  mkdirSync(rcptDir(rootDir), { recursive: true });
  writeFileSync(join(rcptDir(rootDir), GATE_STATE_NAME), JSON.stringify(state, null, 2) + "\n");
}

/** Read all of stdin, or "" after a short timeout when nothing is piped. */
function readStdin(timeoutMs = 2000): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolvePromise) => {
    let data = "";
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolvePromise(data);
      }
    };
    const timer = setTimeout(finish, timeoutMs);
    timer.unref?.();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => {
      clearTimeout(timer);
      finish();
    });
    process.stdin.on("error", () => {
      clearTimeout(timer);
      finish();
    });
  });
}

function failedSummary(results: CheckResult[]): string {
  return results
    .filter((r) => !r.pass)
    .map((r) => `${r.name} (${r.timedOut ? "timeout" : `exit ${r.exitCode ?? "?"}`})`)
    .join(", ");
}

/**
 * The Claude Code Stop hook. Runs the gate checks outside the agent:
 * - all pass → exit 0 silently, agent may finish (a receipt is saved).
 * - any fail → emit {"decision":"block"} so the agent goes back to fix them,
 *   at most gateMaxBlocks times per session so nothing loops forever.
 * Run manually (TTY), it runs the gate checks and reports like a human CLI.
 */
export async function cmdGate(cwdOverride?: string): Promise<number> {
  const cwd = cwdOverride ?? process.cwd();

  const configPath = findConfigPath(cwd);
  if (!configPath) return 0; // never brick a session that hasn't adopted rcpt

  const stdinRaw = await readStdin();
  let input: StopHookInput = {};
  if (stdinRaw.trim()) {
    try {
      input = JSON.parse(stdinRaw) as StopHookInput;
    } catch {
      input = {};
    }
  }
  const manual = process.stdin.isTTY === true && !stdinRaw.trim();

  let loaded;
  try {
    loaded = loadConfig(cwd);
  } catch (err) {
    // A broken config must never trap the agent in a block loop.
    process.stderr.write(`rcpt gate: config error — ${(err as Error).message} (allowing stop)\n`);
    return manual ? 2 : 0;
  }
  const { config, rootDir } = loaded;
  const checks = gateChecks(config);
  const results = await runChecks(checks, rootDir, {});
  const git = await getGitState(rootDir);
  const receipt = finalizeReceipt(buildReceipt({ rootDir, git, checks: results }), {
    sign: true,
  });
  saveReceipt(receipt, rootDir);

  const pass = receipt.summary.pass;
  const sessionId = input.session_id ?? null;
  const maxBlocks = config.gateMaxBlocks ?? DEFAULT_GATE_MAX_BLOCKS;

  const prev = readGateState(rootDir);
  const blocksSoFar = prev && prev.sessionId === sessionId ? prev.blocks : 0;

  if (manual) {
    process.stderr.write(renderSummaryLine(receipt) + "\n");
    return pass ? 0 : 1;
  }

  if (pass) {
    writeGateState(rootDir, { sessionId, blocks: 0, updatedAt: new Date().toISOString() });
    return 0;
  }

  if (blocksSoFar >= maxBlocks) {
    process.stderr.write(
      `rcpt gate: checks still failing (${failedSummary(results)}) but max blocks (${maxBlocks}) reached — allowing stop.\n`,
    );
    return 0;
  }

  writeGateState(rootDir, {
    sessionId,
    blocks: blocksSoFar + 1,
    updatedAt: new Date().toISOString(),
  });
  const reason =
    `rcpt gate: ${failedSummary(results)} failed. ` +
    `Fix the failures and run \`rcpt check\` to confirm before finishing. ` +
    `Failing output tails are in .rcpt/latest.json. (block ${blocksSoFar + 1}/${maxBlocks})`;
  process.stdout.write(JSON.stringify({ decision: "block", reason }) + "\n");
  return 0;
}
