import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run `rcpt gate` the way Claude Code does: JSON on stdin, not a TTY. */
function runGate(
  cwd: string,
  stdinJson: unknown,
  env: Record<string, string> = {},
): Promise<RunResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [CLI, "gate"], {
      cwd,
      env: { ...process.env, ...env, NO_COLOR: "1" },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
    child.stdin.write(JSON.stringify(stdinJson));
    child.stdin.end();
  });
}

let proj: string;
let keysHome: string;

const failingConfig = {
  checks: [{ name: "test", run: 'node -e "process.exit(1)"' }],
  gateMaxBlocks: 2,
};
const passingConfig = {
  checks: [{ name: "test", run: 'node -e "process.exit(0)"' }],
  gateMaxBlocks: 2,
};

beforeAll(() => {
  if (!existsSync(CLI)) {
    throw new Error("dist/cli.js missing — run `npm run build` first (pretest does this).");
  }
  proj = mkdtempSync(join(tmpdir(), "rcpt-gate-"));
  keysHome = mkdtempSync(join(tmpdir(), "rcpt-gate-keys-"));
  writeFileSync(join(proj, "rcpt.config.json"), JSON.stringify(failingConfig));
});

afterAll(() => {
  rmSync(proj, { recursive: true, force: true });
  rmSync(keysHome, { recursive: true, force: true });
});

const stdin = { session_id: "sess-1", stop_hook_active: false, hook_event_name: "Stop" };

test("failing gate blocks the agent with a reason", async () => {
  const r = await runGate(proj, stdin, { RCPT_HOME: keysHome });
  expect(r.code).toBe(0);
  const decision = JSON.parse(r.stdout) as { decision: string; reason: string };
  expect(decision.decision).toBe("block");
  expect(decision.reason).toContain("test (exit 1)");
  expect(decision.reason).toContain("block 1/2");

  const state = JSON.parse(readFileSync(join(proj, ".rcpt", "gate-state.json"), "utf8")) as {
    sessionId: string;
    blocks: number;
  };
  expect(state).toMatchObject({ sessionId: "sess-1", blocks: 1 });
});

test("second failure blocks again (2/2)", async () => {
  const r = await runGate(proj, stdin, { RCPT_HOME: keysHome });
  const decision = JSON.parse(r.stdout) as { reason: string };
  expect(decision.reason).toContain("block 2/2");
});

test("after gateMaxBlocks the gate lets go instead of looping forever", async () => {
  const r = await runGate(proj, stdin, { RCPT_HOME: keysHome });
  expect(r.code).toBe(0);
  expect(r.stdout.trim()).toBe("");
  expect(r.stderr).toContain("max blocks");
});

test("a new session gets a fresh block budget", async () => {
  const r = await runGate(proj, { ...stdin, session_id: "sess-2" }, { RCPT_HOME: keysHome });
  const decision = JSON.parse(r.stdout) as { reason: string };
  expect(decision.reason).toContain("block 1/2");
});

test("passing gate resets state and stays silent", async () => {
  writeFileSync(join(proj, "rcpt.config.json"), JSON.stringify(passingConfig));
  const r = await runGate(proj, stdin, { RCPT_HOME: keysHome });
  expect(r.code).toBe(0);
  expect(r.stdout.trim()).toBe("");
  const state = JSON.parse(readFileSync(join(proj, ".rcpt", "gate-state.json"), "utf8")) as {
    blocks: number;
  };
  expect(state.blocks).toBe(0);
});

test("gate without a config never blocks (exit 0)", async () => {
  const empty = mkdtempSync(join(tmpdir(), "rcpt-gate-empty-"));
  const r = await runGate(empty, stdin);
  expect(r.code).toBe(0);
  expect(r.stdout.trim()).toBe("");
  rmSync(empty, { recursive: true, force: true });
});
