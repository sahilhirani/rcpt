import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { crossExamine } from "../src/core/claims.js";
import {
  claudeProjectSlug,
  claudeProjectsDirFor,
  findLatestSession,
  globToRegExp,
  isTestPath,
  parseSessionFile,
} from "../src/core/transcript.js";

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "rcpt-transcript-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// --- synthetic session lines matching the real Claude Code JSONL shapes ---

let ts = 0;
function stamp(): string {
  ts += 1000;
  return new Date(Date.UTC(2026, 6, 19, 10, 0, 0, ts)).toISOString();
}

const meta = {
  sessionId: "sess-abc",
  cwd: "C:\\proj",
  gitBranch: "main",
  version: "2.1.215",
};

function userText(text: string): string {
  return JSON.stringify({
    type: "user",
    message: { role: "user", content: text },
    timestamp: stamp(),
    ...meta,
  });
}

function assistantText(text: string, sidechain = false): string {
  return JSON.stringify({
    type: "assistant",
    isSidechain: sidechain,
    message: { role: "assistant", content: [{ type: "text", text }] },
    timestamp: stamp(),
    ...meta,
  });
}

function toolUse(id: string, name: string, input: Record<string, unknown>): string {
  return JSON.stringify({
    type: "assistant",
    isSidechain: false,
    message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
    timestamp: stamp(),
    ...meta,
  });
}

function toolResult(id: string, content: unknown, isError = false, interrupted = false): string {
  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }],
    },
    toolUseResult: { stdout: "", stderr: "", interrupted, isImage: false },
    timestamp: stamp(),
    ...meta,
  });
}

function writeSession(lines: string[]): string {
  const file = join(tmp, `session-${Math.random().toString(36).slice(2)}.jsonl`);
  writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

test("parses shell runs, edits, final text, and metadata from a session", async () => {
  const file = writeSession([
    userText("please fix the tests"),
    assistantText("Working on it."),
    toolUse("b1", "Bash", { command: "npm test", description: "Run tests" }),
    toolResult("b1", "Exit code 1\nFAIL src/math.test.ts", true),
    toolUse("e1", "Edit", {
      file_path: "C:/proj/src/math.test.ts",
      old_string: "it('adds')",
      new_string: "it.skip('adds')",
    }),
    toolResult("e1", [{ type: "text", text: "ok" }]),
    toolUse("b2", "PowerShell", { command: "npm test", description: "Run tests again" }),
    toolResult("b2", "all 12 tests passed"),
    assistantText("sidechain chatter", true),
    assistantText("All tests pass. Done."),
    "not json at all {{{",
  ]);

  const evidence = await parseSessionFile(file);
  expect(evidence.sessionId).toBe("sess-abc");
  expect(evidence.cwd).toBe("C:\\proj");
  expect(evidence.gitBranch).toBe("main");
  expect(evidence.agentVersion).toBe("2.1.215");
  expect(evidence.startedAt! <= evidence.endedAt!).toBe(true);

  expect(evidence.shellRuns).toHaveLength(2);
  expect(evidence.shellRuns[0]).toMatchObject({
    command: "npm test",
    ok: false,
    isError: true,
    exitHint: 1,
    tool: "Bash",
  });
  expect(evidence.shellRuns[1]).toMatchObject({ ok: true, tool: "PowerShell" });

  expect(evidence.fileEdits).toHaveLength(1);
  expect(evidence.fileEdits[0]).toMatchObject({ isTestFile: true, addsSkip: true });

  // Sidechain text must not become the final message.
  expect(evidence.finalText).toBe("All tests pass. Done.");
});

test("cross-examination corroborates when the last matching run passed", async () => {
  const file = writeSession([
    toolUse("b1", "Bash", { command: "npm test" }),
    toolResult("b1", "ok"),
    assistantText("All tests pass."),
  ]);
  const evidence = await parseSessionFile(file);
  const exam = crossExamine(evidence, tmp);
  expect(exam.findings[0]!.verdict).toBe("corroborated");
});

test("cross-examination contradicts when the last matching run failed", async () => {
  const file = writeSession([
    toolUse("b1", "Bash", { command: "npm test" }),
    toolResult("b1", "Exit code 2\nfailures", true),
    assistantText("All tests pass."),
  ]);
  const evidence = await parseSessionFile(file);
  const exam = crossExamine(evidence, tmp);
  expect(exam.findings[0]!.verdict).toBe("contradicted");
  expect(exam.findings[0]!.evidence).toContain("exit 2");
});

test("isTestPath matches default globs across separators", () => {
  expect(isTestPath("src/foo.test.ts")).toBe(true);
  expect(isTestPath("src\\bar.spec.tsx")).toBe(true);
  expect(isTestPath("tests/helpers.py")).toBe(true);
  expect(isTestPath("a/b/__tests__/x.js")).toBe(true);
  expect(isTestPath("src/index.ts")).toBe(false);
  expect(isTestPath("attest/data.ts")).toBe(false);
});

test("globToRegExp handles *, ** and ?", () => {
  expect(globToRegExp("*.test.ts").test("a.test.ts")).toBe(true);
  expect(globToRegExp("*.test.ts").test("a/b.test.ts")).toBe(true); // matches basename after /
  expect(globToRegExp("src/*.ts").test("src/a.ts")).toBe(true);
  expect(globToRegExp("src/*.ts").test("src/deep/a.ts")).toBe(false);
  expect(globToRegExp("a?c.js").test("abc.js")).toBe(true);
});

test("claudeProjectSlug replaces every non-alphanumeric character", () => {
  const slug = claudeProjectSlug(process.cwd());
  expect(slug).toMatch(/^[A-Za-z0-9-]+$/);
  expect(slug).not.toContain("\\");
  expect(slug).not.toContain("/");
  expect(slug).not.toContain(":");
});

test("findLatestSession picks the newest top-level jsonl, ignoring subagent dirs", () => {
  const home = mkdtempSync(join(tmpdir(), "rcpt-home-"));
  const projDir = claudeProjectsDirFor(tmp, home);
  mkdirSync(projDir, { recursive: true });
  const older = join(projDir, "older.jsonl");
  const newer = join(projDir, "newer.jsonl");
  writeFileSync(older, "{}\n");
  writeFileSync(newer, "{}\n");
  const past = new Date(Date.now() - 60_000);
  utimesSync(older, past, past);
  const sub = join(projDir, "sess", "subagents");
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, "agent-x.jsonl"), "{}\n");

  expect(findLatestSession(tmp, home)).toBe(newer);
  rmSync(home, { recursive: true, force: true });
});

test("findLatestSession returns null when the project has no sessions", () => {
  const home = mkdtempSync(join(tmpdir(), "rcpt-home-empty-"));
  expect(findLatestSession(tmp, home)).toBe(null);
  rmSync(home, { recursive: true, force: true });
});
