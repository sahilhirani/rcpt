import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  buildReceipt,
  finalizeReceipt,
  listReceipts,
  loadReceipt,
  makeReceiptId,
  receiptContentSha256,
  resolveReceiptPath,
  saveReceipt,
  verifyReceiptIntegrity,
} from "../src/core/receipt.js";
import type { CheckResult, GitState, Receipt } from "../src/core/types.js";

let tmp: string;
let keysHome: string;

const NO_GIT: GitState = {
  available: false,
  isRepo: false,
  head: null,
  headShort: null,
  branch: null,
  dirty: false,
  dirtyFiles: 0,
  diffSha256: null,
};

function fakeResult(name: string, pass: boolean): CheckResult {
  return {
    name,
    command: `run-${name}`,
    cwd: tmp,
    exitCode: pass ? 0 : 1,
    pass,
    timedOut: false,
    durationMs: 42,
    stdoutTail: "out",
    stderrTail: pass ? "" : "boom",
    outputSha256: "0".repeat(64),
    outputBytes: 3,
  };
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "rcpt-receipt-"));
  keysHome = mkdtempSync(join(tmpdir(), "rcpt-receipt-keys-"));
  process.env.RCPT_HOME = keysHome;
});

afterAll(() => {
  delete process.env.RCPT_HOME;
  rmSync(tmp, { recursive: true, force: true });
  rmSync(keysHome, { recursive: true, force: true });
});

test("receipt ids look like rcpt-YYYYMMDD-HHMMSS-xxxxxx", () => {
  expect(makeReceiptId(new Date("2026-07-19T12:34:56Z"))).toMatch(
    /^rcpt-20260719-123456-[0-9a-f]{6}$/,
  );
});

test("buildReceipt computes the summary", () => {
  const r = buildReceipt({
    rootDir: tmp,
    git: NO_GIT,
    checks: [fakeResult("a", true), fakeResult("b", false)],
  });
  expect(r.summary).toEqual({ total: 2, passed: 1, failed: 1, pass: false });
  expect(r.version).toBe(1);
});

test("finalize + verify: intact receipts pass, forged ones fail", () => {
  const r = finalizeReceipt(
    buildReceipt({ rootDir: tmp, git: NO_GIT, checks: [fakeResult("a", false)] }),
    { sign: false },
  );
  expect(r.summary.pass).toBe(false);
  expect(verifyReceiptIntegrity(r).hashOk).toBe(true);
  expect(verifyReceiptIntegrity(r).ok).toBe(true);

  // An agent "editing its grade" from fail to pass must be detectable.
  const forged: Receipt = JSON.parse(JSON.stringify(r)) as Receipt;
  forged.summary.pass = true;
  forged.summary.passed = 1;
  forged.summary.failed = 0;
  forged.checks[0]!.pass = true;
  forged.checks[0]!.exitCode = 0;
  expect(verifyReceiptIntegrity(forged).hashOk).toBe(false);
  expect(verifyReceiptIntegrity(forged).ok).toBe(false);
});

test("signed receipts verify and expose the signature", () => {
  const r = finalizeReceipt(
    buildReceipt({ rootDir: tmp, git: NO_GIT, checks: [fakeResult("a", true)] }),
    { sign: true },
  );
  const check = verifyReceiptIntegrity(r);
  expect(check.sigPresent).toBe(true);
  expect(check.sigOk).toBe(true);
  expect(check.ok).toBe(true);
  expect(r.integrity?.signature?.alg).toBe("Ed25519");
});

test("hash is independent of key order", () => {
  const r = finalizeReceipt(
    buildReceipt({ rootDir: tmp, git: NO_GIT, checks: [fakeResult("a", true)] }),
    { sign: false },
  );
  // Rebuild the object with keys inserted in reverse order at the top level.
  const reordered = Object.fromEntries(
    Object.entries(r).sort(([a], [b]) => (a < b ? 1 : -1)),
  ) as unknown as Receipt;
  expect(Object.keys(reordered)).not.toEqual(Object.keys(r));
  expect(receiptContentSha256(reordered)).toBe(receiptContentSha256(r));
});

test("save / load / list / resolve latest", () => {
  const r1 = finalizeReceipt(
    buildReceipt({
      rootDir: tmp,
      git: NO_GIT,
      checks: [fakeResult("a", true)],
      now: new Date("2026-07-19T01:00:00Z"),
    }),
    { sign: false },
  );
  const r2 = finalizeReceipt(
    buildReceipt({
      rootDir: tmp,
      git: NO_GIT,
      checks: [fakeResult("a", false)],
      now: new Date("2026-07-19T02:00:00Z"),
    }),
    { sign: false },
  );
  saveReceipt(r1, tmp);
  const { path, latestPath } = saveReceipt(r2, tmp);

  expect(loadReceipt(path).id).toBe(r2.id);
  expect(loadReceipt(latestPath).id).toBe(r2.id);
  expect(loadReceipt(resolveReceiptPath(tmp))).toMatchObject({ id: r2.id });
  expect(loadReceipt(resolveReceiptPath(tmp, r1.id)).id).toBe(r1.id);

  const listed = listReceipts(tmp);
  expect(listed).toHaveLength(2);
  expect(listed[0]!.id).toBe(r2.id); // newest first
});

test("loadReceipt rejects non-receipt files", () => {
  const p = join(tmp, "not-a-receipt.json");
  writeFileSync(p, JSON.stringify({ hello: "world" }));
  expect(() => loadReceipt(p)).toThrow(/does not look like/);
  expect(readFileSync(p, "utf8")).toContain("hello");
});
