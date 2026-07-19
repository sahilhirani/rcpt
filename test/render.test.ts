import { beforeAll, expect, test } from "vitest";
import { setColorEnabled, stripAnsi } from "../src/core/ansi.js";
import {
  fmtDuration,
  renderReceiptMarkdown,
  renderReceiptTerminal,
  renderSummaryLine,
} from "../src/core/render.js";
import { buildReceipt, finalizeReceipt } from "../src/core/receipt.js";
import type { AuditReport, CheckResult, GitState, Receipt } from "../src/core/types.js";

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

function fakeResult(name: string, pass: boolean, timedOut = false): CheckResult {
  return {
    name,
    command: `npm run ${name}`,
    cwd: "/x",
    exitCode: pass ? 0 : timedOut ? null : 1,
    pass,
    timedOut,
    durationMs: 1234,
    stdoutTail: "some output",
    stderrTail: pass ? "" : "error output",
    outputSha256: "0".repeat(64),
    outputBytes: 11,
  };
}

function makeReceipt(checks: CheckResult[], audit?: AuditReport): Receipt {
  return finalizeReceipt(buildReceipt({ rootDir: "/x/demo", git: NO_GIT, checks, audit }), {
    sign: false,
  });
}

beforeAll(() => setColorEnabled(false));

test("fmtDuration formats sanely", () => {
  expect(fmtDuration(400)).toBe("0.4s");
  expect(fmtDuration(12_340)).toBe("12.3s");
  expect(fmtDuration(125_000)).toBe("2m 05s");
});

test("terminal receipt shows checks, results, and identity", () => {
  const r = makeReceipt([fakeResult("test", true), fakeResult("lint", false)]);
  const out = stripAnsi(renderReceiptTerminal(r, ".rcpt/x.json"));
  expect(out).toContain("R E C E I P T");
  expect(out).toContain("test");
  expect(out).toContain("✓ PASS");
  expect(out).toContain("✗ FAIL");
  expect(out).toContain("TOTAL  1/2 PASSED");
  expect(out).toContain("✗ INSUFFICIENT");
  expect(out).toContain(r.id);
  expect(out).toContain(".rcpt/x.json");
});

test("an all-green receipt is PAID IN FULL", () => {
  const out = stripAnsi(renderReceiptTerminal(makeReceipt([fakeResult("test", true)])));
  expect(out).toContain("✓ PAID IN FULL");
});

test("audit-only receipts (no checks) skip the checks table", () => {
  const audit: AuditReport = {
    sessionFile: "/s.jsonl",
    sessionId: "sess",
    agent: "claude-code",
    finalText: "All tests pass.",
    findings: [
      {
        claim: { kind: "test", text: "All tests pass." },
        verdict: "contradicted",
        evidence: "last test run failed (exit 1): `npm test`",
      },
    ],
    testFileEdits: [],
    skipMarkersAdded: [],
    shellRunCount: 3,
  };
  const out = stripAnsi(renderReceiptTerminal(makeReceipt([], audit)));
  expect(out).not.toContain("TOTAL");
  expect(out).toContain("CROSS-EXAMINATION");
  expect(out).toContain("CONTRADICTED");
});

test("markdown receipt has the table, failure details, and audit section", () => {
  const audit: AuditReport = {
    sessionFile: "/s.jsonl",
    sessionId: "sess",
    agent: "claude-code",
    finalText: "done",
    findings: [
      {
        claim: { kind: "test", text: "tests pass" },
        verdict: "unverified",
        evidence: "no test command found anywhere in the session transcript",
      },
    ],
    testFileEdits: ["src/a.test.ts"],
    skipMarkersAdded: ["src/a.test.ts"],
    shellRunCount: 1,
  };
  const md = renderReceiptMarkdown(makeReceipt([fakeResult("test", false)], audit));
  expect(md).toContain("### 🧾 Receipt — ❌ 0/1 checks passed");
  expect(md).toContain("| `test` | ❌ fail (exit 1) | 1.2s |");
  expect(md).toContain("output tail");
  expect(md).toContain("Cross-examination");
  expect(md).toContain("Skip markers");
});

test("summary line is one line with counts", () => {
  const line = stripAnsi(
    renderSummaryLine(makeReceipt([fakeResult("test", true), fakeResult("lint", false)])),
  );
  expect(line).toContain("1/2 checks passed");
  expect(line.split("\n")).toHaveLength(1);
});
