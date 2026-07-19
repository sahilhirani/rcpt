import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { FileEdit, SessionEvidence, ShellRun } from "./types.js";

/**
 * Claude Code stores sessions as JSONL under
 * ~/.claude/projects/<project-slug>/<session-id>.jsonl where the slug is the
 * absolute project path with every non-alphanumeric character replaced by "-".
 */
export function claudeProjectSlug(cwd: string): string {
  return resolve(cwd).replace(/[^a-zA-Z0-9]/g, "-");
}

export function claudeProjectsDirFor(cwd: string, home = homedir()): string {
  return join(home, ".claude", "projects", claudeProjectSlug(cwd));
}

/** Newest top-level session file for this project (subagent files live in subdirs). */
export function findLatestSession(cwd: string, home = homedir()): string | null {
  const dir = claudeProjectsDirFor(cwd, home);
  if (!existsSync(dir)) return null;
  let best: { file: string; mtime: number } | null = null;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const full = join(dir, name);
    try {
      const st = statSync(full);
      if (!st.isFile()) continue;
      if (!best || st.mtimeMs > best.mtime) best = { file: full, mtime: st.mtimeMs };
    } catch {
      // Skip unreadable entries.
    }
  }
  return best?.file ?? null;
}

const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

const SKIP_MARKER_RE =
  /\.(?:skip|only)\s*\(|\bxit\s*\(|\bxdescribe\s*\(|@pytest\.mark\.skip|#\[\s*ignore\s*\]|\bt\.Skip\s*\(/;

export const DEFAULT_TEST_GLOBS = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
];

/**
 * Tiny glob matcher (supports ** / * / ?) — enough for test-file patterns.
 * "**" respects segment boundaries: "**\/test/**" matches "a/test/x.ts"
 * but not "attest/x.ts".
 */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?"; // "**/" spans whole segments, including none
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(ch)) {
      re += ch === "\\" ? "/" : `\\${ch}`;
    } else {
      re += ch;
    }
  }
  return new RegExp(`(^|/)${re}$`, "i");
}

export function isTestPath(path: string, globs: string[] = DEFAULT_TEST_GLOBS): boolean {
  const normalized = path.replace(/\\/g, "/");
  return globs.some((g) => globToRegExp(g.replace(/\\/g, "/")).test(normalized));
}

interface PendingShell {
  command: string;
  tool: string;
  timestamp: string | null;
  sidechain: boolean;
}

interface PendingEdit {
  filePath: string;
  tool: string;
  newContent: string;
  timestamp: string | null;
}

function extractResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        b && typeof b === "object" && typeof (b as { text?: unknown }).text === "string"
          ? (b as { text: string }).text
          : "",
      )
      .join("\n");
  }
  return "";
}

export interface ParseOptions {
  testGlobs?: string[];
}

/** Stream-parse a Claude Code session JSONL into verifiable evidence. */
export async function parseSessionFile(
  file: string,
  opts: ParseOptions = {},
): Promise<SessionEvidence> {
  const testGlobs = opts.testGlobs ?? DEFAULT_TEST_GLOBS;
  const pendingShell = new Map<string, PendingShell>();
  const pendingEdit = new Map<string, PendingEdit>();

  const evidence: SessionEvidence = {
    file,
    sessionId: null,
    cwd: null,
    gitBranch: null,
    agentVersion: null,
    startedAt: null,
    endedAt: null,
    shellRuns: [],
    fileEdits: [],
    finalText: null,
    lineCount: 0,
  };

  const rl = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    evidence.lineCount++;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const timestamp = typeof obj.timestamp === "string" ? obj.timestamp : null;
    if (timestamp) {
      if (!evidence.startedAt || timestamp < evidence.startedAt) evidence.startedAt = timestamp;
      if (!evidence.endedAt || timestamp > evidence.endedAt) evidence.endedAt = timestamp;
    }
    if (!evidence.sessionId && typeof obj.sessionId === "string") evidence.sessionId = obj.sessionId;
    if (!evidence.cwd && typeof obj.cwd === "string") evidence.cwd = obj.cwd;
    if (!evidence.gitBranch && typeof obj.gitBranch === "string") evidence.gitBranch = obj.gitBranch;
    if (!evidence.agentVersion && typeof obj.version === "string") {
      evidence.agentVersion = obj.version;
    }

    const sidechain = obj.isSidechain === true;
    const message = obj.message as Record<string, unknown> | undefined;
    if (!message) continue;

    if (obj.type === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content as Record<string, unknown>[]) {
        if (!block || typeof block !== "object") continue;
        if (block.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
          if (!sidechain) evidence.finalText = block.text;
        } else if (block.type === "tool_use" && typeof block.id === "string") {
          const name = typeof block.name === "string" ? block.name : "";
          const input = (block.input ?? {}) as Record<string, unknown>;
          if (SHELL_TOOLS.has(name) && typeof input.command === "string") {
            pendingShell.set(block.id, { command: input.command, tool: name, timestamp, sidechain });
          } else if (EDIT_TOOLS.has(name) && typeof input.file_path === "string") {
            const newContent =
              typeof input.new_string === "string"
                ? input.new_string
                : typeof input.content === "string"
                  ? input.content
                  : typeof input.new_source === "string"
                    ? input.new_source
                    : "";
            pendingEdit.set(block.id, {
              filePath: input.file_path,
              tool: name,
              newContent,
              timestamp,
            });
          }
        }
      }
    } else if (obj.type === "user" && Array.isArray(message.content)) {
      for (const block of message.content as Record<string, unknown>[]) {
        if (!block || typeof block !== "object" || block.type !== "tool_result") continue;
        const id = typeof block.tool_use_id === "string" ? block.tool_use_id : null;
        if (!id) continue;
        const isError = block.is_error === true;
        const toolUseResult = obj.toolUseResult as Record<string, unknown> | undefined;
        const interrupted = toolUseResult?.interrupted === true;

        const shell = pendingShell.get(id);
        if (shell) {
          pendingShell.delete(id);
          const text = extractResultText(block.content);
          const exitMatch = /exit code:?\s*(\d+)/i.exec(text);
          const exitHint = exitMatch ? parseInt(exitMatch[1]!, 10) : null;
          const run: ShellRun = {
            command: shell.command,
            tool: shell.tool,
            isError,
            interrupted,
            exitHint,
            ok: !isError && !interrupted && (exitHint === null || exitHint === 0),
            timestamp: shell.timestamp,
            sidechain: shell.sidechain,
          };
          evidence.shellRuns.push(run);
          continue;
        }

        const edit = pendingEdit.get(id);
        if (edit) {
          pendingEdit.delete(id);
          if (!isError) {
            const fileEdit: FileEdit = {
              filePath: edit.filePath,
              tool: edit.tool,
              isTestFile: isTestPath(edit.filePath, testGlobs),
              addsSkip: SKIP_MARKER_RE.test(edit.newContent),
              timestamp: edit.timestamp,
            };
            evidence.fileEdits.push(fileEdit);
          }
        }
      }
    }
  }
  return evidence;
}
