import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { GitState } from "./types.js";

function git(args: string[], cwd: string): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolvePromise) => {
    execFile(
      "git",
      args,
      { cwd, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        resolvePromise({ ok: !err, stdout: stdout?.toString() ?? "" });
      },
    );
  });
}

/** SHA-256 of `git diff HEAD` streamed, so large diffs don't blow memory. */
function diffSha256(cwd: string): Promise<string | null> {
  return new Promise((resolvePromise) => {
    const hash = createHash("sha256");
    let bytes = 0;
    const child = spawn("git", ["diff", "HEAD"], { cwd, windowsHide: true });
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      hash.update(chunk);
    });
    child.on("error", () => resolvePromise(null));
    child.on("close", (code) => {
      if (code !== 0 || bytes === 0) resolvePromise(null);
      else resolvePromise(hash.digest("hex"));
    });
  });
}

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

/** Capture the repo state a receipt is bound to. Degrades gracefully without git. */
export async function getGitState(cwd: string): Promise<GitState> {
  const version = await git(["--version"], cwd);
  if (!version.ok) return NO_GIT;

  const inside = await git(["rev-parse", "--is-inside-work-tree"], cwd);
  if (!inside.ok || inside.stdout.trim() !== "true") {
    return { ...NO_GIT, available: true };
  }

  const [head, headShort, branch, status] = await Promise.all([
    git(["rev-parse", "HEAD"], cwd),
    git(["rev-parse", "--short", "HEAD"], cwd),
    git(["branch", "--show-current"], cwd),
    git(["status", "--porcelain"], cwd),
  ]);

  const statusLines = status.ok
    ? status.stdout.split("\n").filter((l) => l.trim() !== "")
    : [];
  const dirty = statusLines.length > 0;

  return {
    available: true,
    isRepo: true,
    head: head.ok ? head.stdout.trim() : null,
    headShort: headShort.ok ? headShort.stdout.trim() : null,
    branch: branch.ok && branch.stdout.trim() !== "" ? branch.stdout.trim() : null,
    dirty,
    dirtyFiles: statusLines.length,
    diffSha256: head.ok && dirty ? await diffSha256(cwd) : null,
  };
}
