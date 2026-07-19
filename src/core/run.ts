import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { CheckConfig, CheckResult } from "./types.js";
import { DEFAULT_TIMEOUT_SECONDS } from "./config.js";

const TAIL_CHARS = 4000;

export interface RunHooks {
  onStart?: (check: CheckConfig) => void;
  onFinish?: (result: CheckResult) => void;
}

/**
 * Run one check with the platform shell, outside any agent. Captures exit
 * code, duration, output tails, and a SHA-256 of the full output stream.
 */
export function runCheck(check: CheckConfig, rootDir: string): Promise<CheckResult> {
  const cwd = resolve(rootDir, check.cwd ?? ".");
  const timeoutMs = (check.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
  const started = Date.now();

  return new Promise((resolvePromise) => {
    const hash = createHash("sha256");
    let stdoutTail = "";
    let stderrTail = "";
    let outputBytes = 0;
    let timedOut = false;
    let settled = false;

    const child = spawn(check.run, {
      shell: true,
      cwd,
      env: { ...process.env, RCPT: "1" },
      windowsHide: true,
      detached: process.platform !== "win32",
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      hash.update(chunk);
      outputBytes += chunk.length;
      stdoutTail = (stdoutTail + chunk.toString("utf8")).slice(-TAIL_CHARS);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      hash.update(chunk);
      outputBytes += chunk.length;
      stderrTail = (stderrTail + chunk.toString("utf8")).slice(-TAIL_CHARS);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
      // Fallback in case the process ignores the kill.
      child.kill("SIGKILL");
    }, timeoutMs);
    timer.unref?.();

    const finish = (exitCode: number | null, extraStderr?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (extraStderr) stderrTail = (stderrTail + "\n" + extraStderr).slice(-TAIL_CHARS);
      const result: CheckResult = {
        name: check.name,
        command: check.run,
        cwd,
        exitCode,
        pass: !timedOut && exitCode === 0,
        timedOut,
        durationMs: Date.now() - started,
        stdoutTail,
        stderrTail,
        outputSha256: hash.digest("hex"),
        outputBytes,
      };
      resolvePromise(result);
    };

    child.on("error", (err) => finish(null, `spawn error: ${err.message}`));
    child.on("close", (code) => finish(code));
  });
}

export async function runChecks(
  checks: CheckConfig[],
  rootDir: string,
  hooks: RunHooks = {},
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of checks) {
    hooks.onStart?.(check);
    const result = await runCheck(check, rootDir);
    hooks.onFinish?.(result);
    results.push(result);
  }
  return results;
}

/** Kill a process and its children (checks run via a shell, so kill the tree). */
function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
    } else {
      // Negative pid targets the detached process group.
      process.kill(-pid, "SIGKILL");
    }
  } catch {
    // Best effort — the fallback child.kill covers the direct child.
  }
}
