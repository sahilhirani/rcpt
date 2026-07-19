import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type {
  Claim,
  ClaimFinding,
  ClaimKind,
  SessionEvidence,
  ShellRun,
} from "./types.js";

/**
 * Heuristic claim extraction. This is intentionally conservative: it looks for
 * assertions of *completed* verification ("tests pass"), not intentions
 * ("make sure the tests pass"). Findings are labeled, never silently trusted.
 */

const INTENT_RE =
  /\b(?:should|make sure|ensure|need(?:s)? to|todo|next(?: step)?|will (?:need|want|run)|you can run|please run|before (?:merging|committing)|remember to|don't forget)\b/i;

const CLAIM_PATTERNS: Array<{ kind: ClaimKind; re: RegExp }> = [
  {
    kind: "test",
    re: /\b(?:all\s+)?(?:\d+\s+)?tests?\s+(?:are\s+|is\s+|now\s+|all\s+|still\s+)*(?:pass(?:ing|ed)?|green)\b|\btest\s+suite\s+(?:is\s+)?(?:green|passing|clean)\b|\bpass(?:ing|ed)\s+(?:all\s+)?(?:\d+\s+)?tests\b/i,
  },
  {
    kind: "build",
    re: /\bbuilds?\s+(?:now\s+)?(?:succeed(?:s|ed)?|pass(?:es|ing|ed)?|works|is\s+(?:green|clean|passing))\b|\bcompiles?\s+(?:cleanly|successfully|without\s+errors)\b|\bbuilt\s+successfully\b|\bbuild\s+is\s+green\b/i,
  },
  {
    kind: "typecheck",
    re: /\b(?:type\s*-?check(?:s|ing)?|typechecks?|tsc)\s+(?:now\s+)?(?:pass(?:es|ing|ed)?|is\s+clean|succeeds?|clean)\b|\bno\s+(?:more\s+)?type\s+errors\b|\btypes?\s+(?:are\s+)?clean\b/i,
  },
  {
    kind: "lint",
    re: /\blint(?:er|ing)?\s+(?:now\s+)?(?:pass(?:es|ing|ed)?|is\s+clean|clean)\b|\bno\s+(?:more\s+)?lint(?:ing)?\s+(?:errors|issues|warnings)\b/i,
  },
];

const FILE_CLAIM_RE =
  /\b(?:created|added|wrote)\s+(?:a\s+)?(?:new\s+)?(?:file\s+)?`?((?:[\w@-]+[\\/])*[\w@.-]+\.[A-Za-z0-9]{1,8})`?/gi;

const COMPLETION_RE =
  /\b(?:done|complete[d]?|finished|implemented|all\s+set|ready\s+(?:to|for)\s+(?:merge|review|ship))\b/i;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function clip(s: string, max = 140): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export function extractClaims(text: string): Claim[] {
  const claims: Claim[] = [];
  const seenKinds = new Set<string>();

  for (const sentence of sentences(text)) {
    if (INTENT_RE.test(sentence)) continue;
    for (const { kind, re } of CLAIM_PATTERNS) {
      if (seenKinds.has(kind)) continue;
      if (re.test(sentence)) {
        claims.push({ kind, text: clip(sentence) });
        seenKinds.add(kind);
      }
    }
    FILE_CLAIM_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FILE_CLAIM_RE.exec(sentence)) !== null) {
      const file = m[1]!;
      if (file.includes("://")) continue;
      const key = `file:${file}`;
      if (!seenKinds.has(key)) {
        claims.push({ kind: "file", text: clip(sentence), file });
        seenKinds.add(key);
      }
    }
  }

  if (claims.length === 0 && COMPLETION_RE.test(text)) {
    const sentence = sentences(text).find((s) => COMPLETION_RE.test(s) && !INTENT_RE.test(s));
    if (sentence) claims.push({ kind: "completion", text: clip(sentence) });
  }
  return claims;
}

const KIND_COMMAND_RES: Record<Exclude<ClaimKind, "file" | "completion">, RegExp> = {
  typecheck:
    /\btsc\b[^&|;]*--noEmit|\b(?:vue-)?tsc\s+--noEmit|\bmypy\b|\bpyright\b|\btypecheck\b/i,
  test: /\b(?:vitest|jest|mocha|ava|pytest|playwright\s+test|cypress\s+run|go\s+test|cargo\s+(?:test|nextest)|dotnet\s+test|phpunit|rspec|node\s+--test|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|make\s+test|gradlew?\s+\S*test|mvn\s+\S*\s*test)\b/i,
  lint: /\b(?:eslint|ruff\s+check|ruff\b|clippy|golangci-lint|biome\s+(?:check|lint)|flake8|pylint|rubocop|oxlint|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?lint\b|make\s+lint)\b/i,
  build:
    /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b|next\s+build|vite\s+build|cargo\s+build|go\s+build|dotnet\s+build|gradlew?\s+(?:assemble|build)|mvn\s+(?:package|install|compile)|webpack|esbuild|rollup\b|make(?:\s+build)?\s*$)/i,
};

/** Classify each &&/;/| segment of a command into proof kinds. */
export function classifyCommand(command: string): Set<ClaimKind> {
  const kinds = new Set<ClaimKind>();
  for (const segment of command.split(/&&|\|\||;|\|/)) {
    const seg = segment.trim();
    if (!seg) continue;
    // typecheck first: "tsc --noEmit" must not be classified as build.
    if (KIND_COMMAND_RES.typecheck.test(seg)) {
      kinds.add("typecheck");
      continue;
    }
    if (KIND_COMMAND_RES.test.test(seg)) kinds.add("test");
    if (KIND_COMMAND_RES.lint.test(seg)) kinds.add("lint");
    if (KIND_COMMAND_RES.build.test(seg)) kinds.add("build");
  }
  return kinds;
}

function shortCmd(cmd: string, max = 60): string {
  const flat = cmd.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

export interface CrossExamination {
  findings: ClaimFinding[];
  testFileEdits: string[];
  skipMarkersAdded: string[];
}

/** Compare claims in the final message against what actually ran in-session. */
export function crossExamine(evidence: SessionEvidence, projectDir: string): CrossExamination {
  const claims = evidence.finalText ? extractClaims(evidence.finalText) : [];
  const findings: ClaimFinding[] = [];

  const runsByKind = new Map<ClaimKind, ShellRun[]>();
  for (const run of evidence.shellRuns) {
    for (const kind of classifyCommand(run.command)) {
      const arr = runsByKind.get(kind) ?? [];
      arr.push(run);
      runsByKind.set(kind, arr);
    }
  }

  for (const claim of claims) {
    if (claim.kind === "file") {
      const file = claim.file!;
      const full = isAbsolute(file) ? file : resolve(projectDir, file);
      const exists = existsSync(full);
      findings.push({
        claim,
        verdict: exists ? "file-exists" : "file-missing",
        evidence: exists ? `${file} exists on disk` : `${file} not found under ${projectDir}`,
      });
      continue;
    }
    if (claim.kind === "completion") {
      findings.push({
        claim,
        verdict: "info",
        evidence: "generic completion claim — run `rcpt check` for fresh proof",
      });
      continue;
    }
    const runs = runsByKind.get(claim.kind) ?? [];
    if (runs.length === 0) {
      findings.push({
        claim,
        verdict: "unverified",
        evidence: `no ${claim.kind} command found anywhere in the session transcript`,
      });
      continue;
    }
    const last = runs[runs.length - 1]!;
    if (last.ok) {
      findings.push({
        claim,
        verdict: "corroborated",
        evidence: `last ${claim.kind} run succeeded: \`${shortCmd(last.command)}\``,
      });
    } else {
      const why = last.interrupted
        ? "was interrupted"
        : last.exitHint !== null
          ? `failed (exit ${last.exitHint})`
          : "errored";
      findings.push({
        claim,
        verdict: "contradicted",
        evidence: `last ${claim.kind} run ${why}: \`${shortCmd(last.command)}\``,
      });
    }
  }

  const testFileEdits = [
    ...new Set(evidence.fileEdits.filter((e) => e.isTestFile).map((e) => e.filePath)),
  ];
  const skipMarkersAdded = [
    ...new Set(
      evidence.fileEdits.filter((e) => e.isTestFile && e.addsSkip).map((e) => e.filePath),
    ),
  ];
  return { findings, testFileEdits, skipMarkersAdded };
}
