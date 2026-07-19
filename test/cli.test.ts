import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Receipt } from "../src/core/types.js";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string, env: Record<string, string> = {}): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      {
        cwd,
        env: { ...process.env, ...env, NO_COLOR: "1" },
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        const code =
          err && typeof (err as { code?: unknown }).code === "number"
            ? ((err as { code: number }).code as number)
            : err
              ? 1
              : 0;
        resolvePromise({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

let proj: string;
let keysHome: string;

beforeAll(() => {
  if (!existsSync(CLI)) {
    throw new Error(`dist/cli.js missing — run \`npm run build\` first (pretest does this).`);
  }
  proj = mkdtempSync(join(tmpdir(), "rcpt-cli-proj-"));
  keysHome = mkdtempSync(join(tmpdir(), "rcpt-cli-keys-"));
  writeFileSync(
    join(proj, "package.json"),
    JSON.stringify(
      { name: "fixture", version: "0.0.0", scripts: { test: 'node -e "process.exit(0)"' } },
      null,
      2,
    ),
  );
});

afterAll(() => {
  rmSync(proj, { recursive: true, force: true });
  rmSync(keysHome, { recursive: true, force: true });
});

describe("rcpt CLI end to end", () => {
  test("--version prints the version", async () => {
    const r = await runCli(["--version"], proj);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^rcpt \d+\.\d+\.\d+$/);
  });

  test("init detects the npm test script and writes config", async () => {
    const r = await runCli(["init"], proj);
    expect(r.code).toBe(0);
    const config = JSON.parse(readFileSync(join(proj, "rcpt.config.json"), "utf8")) as {
      checks: Array<{ name: string; run: string }>;
    };
    expect(config.checks.some((c) => c.name === "test")).toBe(true);
    expect(r.stdout).toContain("rcpt check");
  });

  test("init refuses to overwrite without --force", async () => {
    const r = await runCli(["init"], proj);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("already exists");
  });

  test("check runs the checks, saves and signs a receipt, exit 0", async () => {
    const r = await runCli(["check"], proj, { RCPT_HOME: keysHome });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("R E C E I P T");
    expect(r.stdout).toContain("PAID IN FULL");
    const latest = JSON.parse(readFileSync(join(proj, ".rcpt", "latest.json"), "utf8")) as Receipt;
    expect(latest.summary.pass).toBe(true);
    expect(latest.integrity?.signature?.alg).toBe("Ed25519");
  });

  test("check --json emits a parseable receipt", async () => {
    const r = await runCli(["check", "--json", "--no-save"], proj, { RCPT_HOME: keysHome });
    expect(r.code).toBe(0);
    const receipt = JSON.parse(r.stdout) as Receipt;
    expect(receipt.version).toBe(1);
    expect(receipt.checks).toHaveLength(1);
  });

  test("verify accepts an intact receipt and rejects a tampered one", async () => {
    const ok = await runCli(["verify"], proj, { RCPT_HOME: keysHome });
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain("content hash matches");

    const latestPath = join(proj, ".rcpt", "latest.json");
    const receipt = JSON.parse(readFileSync(latestPath, "utf8")) as Receipt;
    receipt.summary.passed = 999;
    writeFileSync(latestPath, JSON.stringify(receipt, null, 2));

    const bad = await runCli(["verify"], proj, { RCPT_HOME: keysHome });
    expect(bad.code).toBe(1);
    expect(bad.stdout).toContain("MISMATCH");
  });

  test("md renders a saved receipt as markdown", async () => {
    await runCli(["check"], proj, { RCPT_HOME: keysHome }); // restore an intact latest
    const r = await runCli(["md"], proj);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("### 🧾 Receipt");
  });

  test("list shows saved receipts", async () => {
    const r = await runCli(["list"], proj);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("rcpt-");
  });

  test("a failing check exits 1 and stamps INSUFFICIENT", async () => {
    const failProj = mkdtempSync(join(tmpdir(), "rcpt-cli-fail-"));
    writeFileSync(
      join(failProj, "rcpt.config.json"),
      JSON.stringify({ checks: [{ name: "test", run: 'node -e "process.exit(2)"' }] }),
    );
    const r = await runCli(["check"], failProj, { RCPT_HOME: keysHome });
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("INSUFFICIENT");
    rmSync(failProj, { recursive: true, force: true });
  });

  test("check without a config explains how to start", async () => {
    const empty = mkdtempSync(join(tmpdir(), "rcpt-cli-empty-"));
    const r = await runCli(["check"], empty);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("rcpt init");
    rmSync(empty, { recursive: true, force: true });
  });

  test("unknown commands exit 2 with help", async () => {
    const r = await runCli(["frobnicate"], proj);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Unknown command");
  });
});
