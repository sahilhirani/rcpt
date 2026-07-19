/** A single named check the repo must pass (a proof obligation). */
export interface CheckConfig {
  /** Unique name, e.g. "test", "typecheck". */
  name: string;
  /** Shell command to run, e.g. "npm test". Runs with the platform shell. */
  run: string;
  /** Working directory relative to the repo root. Defaults to ".". */
  cwd?: string;
  /** Kill the check after this many seconds. Defaults to 600. */
  timeoutSeconds?: number;
}

export interface AuditConfig {
  /** Globs treated as test files when flagging edits in transcripts. */
  testGlobs?: string[];
}

export interface RcptConfig {
  $schema?: string;
  checks: CheckConfig[];
  /** Subset of check names run by `rcpt gate` (the agent stop-gate). Defaults to all. */
  gate?: string[];
  /** Max times the stop-gate blocks an agent per session before letting go. Default 3. */
  gateMaxBlocks?: number;
  audit?: AuditConfig;
}

export interface CheckResult {
  name: string;
  command: string;
  cwd: string;
  exitCode: number | null;
  pass: boolean;
  timedOut: boolean;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
  /** SHA-256 of the full interleaved output (stdout then stderr). */
  outputSha256: string;
  outputBytes: number;
}

export interface GitState {
  available: boolean;
  isRepo: boolean;
  head: string | null;
  headShort: string | null;
  branch: string | null;
  dirty: boolean;
  dirtyFiles: number;
  /** SHA-256 of `git diff HEAD` at receipt time; null when clean or unavailable. */
  diffSha256: string | null;
}

export type ClaimKind = "test" | "build" | "lint" | "typecheck" | "file" | "completion";

export interface Claim {
  kind: ClaimKind;
  /** The sentence (trimmed) the claim was extracted from. */
  text: string;
  /** For kind "file": the claimed path. */
  file?: string;
}

export interface ShellRun {
  command: string;
  /** True when the tool result was not an error and not interrupted. */
  ok: boolean;
  isError: boolean;
  interrupted: boolean;
  /** Exit code parsed from the result text when present (e.g. "Exit code 2"). */
  exitHint: number | null;
  timestamp: string | null;
  sidechain: boolean;
  tool: string;
}

export interface FileEdit {
  filePath: string;
  tool: string;
  isTestFile: boolean;
  /** True when the edit introduces skip/only markers (e.g. `.skip(`, `xit(`). */
  addsSkip: boolean;
  timestamp: string | null;
}

export interface SessionEvidence {
  file: string;
  sessionId: string | null;
  cwd: string | null;
  gitBranch: string | null;
  agentVersion: string | null;
  startedAt: string | null;
  endedAt: string | null;
  shellRuns: ShellRun[];
  fileEdits: FileEdit[];
  /** Last non-sidechain assistant text in the session. */
  finalText: string | null;
  lineCount: number;
}

export type Verdict =
  | "corroborated"
  | "contradicted"
  | "unverified"
  | "file-exists"
  | "file-missing"
  | "info";

export interface ClaimFinding {
  claim: Claim;
  verdict: Verdict;
  /** One-line human explanation of the evidence. */
  evidence: string;
}

export interface AuditReport {
  sessionFile: string;
  sessionId: string | null;
  agent: "claude-code";
  finalText: string | null;
  findings: ClaimFinding[];
  testFileEdits: string[];
  skipMarkersAdded: string[];
  shellRunCount: number;
}

export interface ReceiptIntegrity {
  contentSha256: string;
  signature?: {
    alg: "Ed25519";
    /** SPKI DER, base64. */
    publicKey: string;
    /** Signature over the contentSha256 hex string (UTF-8), base64. */
    sig: string;
  };
}

export interface Receipt {
  $schema?: string;
  version: 1;
  id: string;
  createdAt: string;
  tool: { name: string; version: string };
  repo: { root: string; git: GitState };
  env: { os: string; arch: string; node: string };
  checks: CheckResult[];
  summary: { total: number; passed: number; failed: number; pass: boolean };
  audit?: AuditReport;
  integrity?: ReceiptIntegrity;
}
