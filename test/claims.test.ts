import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { classifyCommand, crossExamine, extractClaims } from "../src/core/claims.js";
import type { SessionEvidence, ShellRun } from "../src/core/types.js";

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "rcpt-claims-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function evidenceWith(finalText: string, shellRuns: ShellRun[] = []): SessionEvidence {
  return {
    file: "/session.jsonl",
    sessionId: "sess-1",
    cwd: tmp,
    gitBranch: "main",
    agentVersion: "2.0.0",
    startedAt: "2026-07-19T10:00:00.000Z",
    endedAt: "2026-07-19T10:30:00.000Z",
    shellRuns,
    fileEdits: [],
    finalText,
    lineCount: 10,
  };
}

function run(command: string, ok: boolean, exitHint: number | null = ok ? 0 : 1): ShellRun {
  return {
    command,
    ok,
    isError: !ok,
    interrupted: false,
    exitHint,
    timestamp: "2026-07-19T10:15:00.000Z",
    sidechain: false,
    tool: "Bash",
  };
}

test("extracts test/build/typecheck/lint claims", () => {
  const claims = extractClaims(
    "All 24 tests pass and the build succeeds. Lint is clean. No type errors remain.",
  );
  const kinds = claims.map((c) => c.kind).sort();
  expect(kinds).toEqual(["build", "lint", "test", "typecheck"]);
});

test("intentions are not claims", () => {
  expect(extractClaims("Make sure the tests pass before merging.")).toHaveLength(0);
  expect(extractClaims("You should run npm test to confirm the tests pass.")).toHaveLength(0);
});

test("file creation claims capture the path", () => {
  const claims = extractClaims("I created src/utils/helpers.ts and added test/helpers.test.ts.");
  const files = claims.filter((c) => c.kind === "file").map((c) => c.file);
  expect(files).toContain("src/utils/helpers.ts");
  expect(files).toContain("test/helpers.test.ts");
});

test("bare completion claims are the fallback", () => {
  const claims = extractClaims("Everything is implemented and done.");
  expect(claims).toHaveLength(1);
  expect(claims[0]!.kind).toBe("completion");
});

test("classifyCommand recognizes common tools per segment", () => {
  expect(classifyCommand("npm test")).toEqual(new Set(["test"]));
  expect(classifyCommand("npx tsc --noEmit")).toEqual(new Set(["typecheck"]));
  expect(classifyCommand("npm run build && npm test")).toEqual(new Set(["build", "test"]));
  expect(classifyCommand("npx eslint . --fix")).toEqual(new Set(["lint"]));
  expect(classifyCommand("cargo clippy -- -D warnings")).toEqual(new Set(["lint"]));
  expect(classifyCommand("pytest -q")).toEqual(new Set(["test"]));
  expect(classifyCommand("echo hello")).toEqual(new Set());
});

test("a test claim with a failing last run is CONTRADICTED", () => {
  const exam = crossExamine(
    evidenceWith("All tests pass now.", [run("npm test", true), run("npm test", false)]),
    tmp,
  );
  expect(exam.findings).toHaveLength(1);
  expect(exam.findings[0]!.verdict).toBe("contradicted");
  expect(exam.findings[0]!.evidence).toContain("exit 1");
});

test("a test claim whose last run succeeded is corroborated", () => {
  const exam = crossExamine(
    evidenceWith("All tests pass now.", [run("npm test", false), run("npm test", true)]),
    tmp,
  );
  expect(exam.findings[0]!.verdict).toBe("corroborated");
});

test("a test claim with no test runs at all is unverified", () => {
  const exam = crossExamine(evidenceWith("All tests pass now.", [run("echo hi", true)]), tmp);
  expect(exam.findings[0]!.verdict).toBe("unverified");
});

test("file claims are checked on disk", () => {
  writeFileSync(join(tmp, "real.ts"), "export {}");
  const exam = crossExamine(
    evidenceWith("I created real.ts and also created ghost.ts today."),
    tmp,
  );
  const byFile = new Map(exam.findings.map((f) => [f.claim.file, f.verdict]));
  expect(byFile.get("real.ts")).toBe("file-exists");
  expect(byFile.get("ghost.ts")).toBe("file-missing");
});

test("test-file edits and skip markers are surfaced", () => {
  const evidence = evidenceWith("done");
  evidence.fileEdits = [
    {
      filePath: "src/math.test.ts",
      tool: "Edit",
      isTestFile: true,
      addsSkip: true,
      timestamp: null,
    },
    { filePath: "src/math.ts", tool: "Edit", isTestFile: false, addsSkip: false, timestamp: null },
  ];
  const exam = crossExamine(evidence, tmp);
  expect(exam.testFileEdits).toEqual(["src/math.test.ts"]);
  expect(exam.skipMarkersAdded).toEqual(["src/math.test.ts"]);
});
