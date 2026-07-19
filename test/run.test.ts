import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { runCheck, runChecks } from "../src/core/run.js";

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "rcpt-run-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

test("a passing command yields pass with exit 0", async () => {
  const r = await runCheck({ name: "ok", run: 'node -e "process.exit(0)"' }, tmp);
  expect(r.pass).toBe(true);
  expect(r.exitCode).toBe(0);
  expect(r.timedOut).toBe(false);
});

test("a failing command records its exit code", async () => {
  const r = await runCheck({ name: "fail", run: 'node -e "process.exit(3)"' }, tmp);
  expect(r.pass).toBe(false);
  expect(r.exitCode).toBe(3);
});

test("stdout/stderr tails and output hash are captured", async () => {
  const r = await runCheck(
    { name: "out", run: `node -e "console.log('hello-out'); console.error('hello-err')"` },
    tmp,
  );
  expect(r.stdoutTail).toContain("hello-out");
  expect(r.stderrTail).toContain("hello-err");
  expect(r.outputBytes).toBeGreaterThan(0);
  expect(r.outputSha256).toMatch(/^[0-9a-f]{64}$/);
});

test("a hung command is killed at the timeout", async () => {
  const r = await runCheck(
    { name: "hang", run: 'node -e "setTimeout(function(){}, 15000)"', timeoutSeconds: 1 },
    tmp,
  );
  expect(r.timedOut).toBe(true);
  expect(r.pass).toBe(false);
  expect(r.durationMs).toBeLessThan(10_000);
}, 20_000);

test("a nonexistent command fails instead of throwing", async () => {
  const r = await runCheck({ name: "nope", run: "definitely-not-a-real-command-xyz" }, tmp);
  expect(r.pass).toBe(false);
});

test("runChecks runs sequentially and reports via hooks", async () => {
  const seen: string[] = [];
  const results = await runChecks(
    [
      { name: "one", run: 'node -e "process.exit(0)"' },
      { name: "two", run: 'node -e "process.exit(1)"' },
    ],
    tmp,
    {
      onStart: (c) => seen.push(`start:${c.name}`),
      onFinish: (r) => seen.push(`finish:${r.name}:${r.pass}`),
    },
  );
  expect(results.map((r) => r.pass)).toEqual([true, false]);
  expect(seen).toEqual(["start:one", "finish:one:true", "start:two", "finish:two:false"]);
});
