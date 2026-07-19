import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { loadConfig } from "../core/config.js";
import { crossExamine } from "../core/claims.js";
import { getGitState } from "../core/git.js";
import { buildReceipt, finalizeReceipt, saveReceipt } from "../core/receipt.js";
import { renderReceiptMarkdown, renderReceiptTerminal } from "../core/render.js";
import { runChecks } from "../core/run.js";
import {
  claudeProjectsDirFor,
  findLatestSession,
  parseSessionFile,
} from "../core/transcript.js";
import { dim, red, yellow } from "../core/ansi.js";
import type { AuditReport } from "../core/types.js";

export async function cmdAudit(argv: string[], cwdOverride?: string): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      session: { type: "string" },
      check: { type: "boolean" },
      json: { type: "boolean" },
      md: { type: "boolean" },
      "no-save": { type: "boolean" },
      "no-sign": { type: "boolean" },
    },
    allowPositionals: false,
  });

  const cwd = cwdOverride ?? process.cwd();

  // Config is optional for a report-only audit, required for --check.
  let config: ReturnType<typeof loadConfig> | null = null;
  try {
    config = loadConfig(cwd);
  } catch {
    config = null;
  }
  if (values.check && !config) {
    process.stderr.write(
      red("rcpt audit --check needs rcpt.config.json — run `rcpt init` first.\n"),
    );
    return 2;
  }
  const rootDir = config?.rootDir ?? cwd;

  const sessionFile = values.session ?? findLatestSession(rootDir);
  if (!sessionFile || !existsSync(sessionFile)) {
    process.stderr.write(
      yellow(`No Claude Code session found for this project.\n`) +
        dim(
          `  looked in ${claudeProjectsDirFor(rootDir)}\n  (pass one explicitly with --session <path>)\n`,
        ),
    );
    return 2;
  }

  const evidence = await parseSessionFile(sessionFile, {
    testGlobs: config?.config.audit?.testGlobs,
  });
  const exam = crossExamine(evidence, rootDir);

  const audit: AuditReport = {
    sessionFile,
    sessionId: evidence.sessionId,
    agent: "claude-code",
    finalText: evidence.finalText ? evidence.finalText.slice(0, 2000) : null,
    findings: exam.findings,
    testFileEdits: exam.testFileEdits,
    skipMarkersAdded: exam.skipMarkersAdded,
    shellRunCount: evidence.shellRuns.length,
  };

  const results =
    values.check && config ? await runChecks(config.config.checks, rootDir, {}) : [];

  const git = await getGitState(rootDir);
  let receipt = buildReceipt({ rootDir, git, checks: results, audit });
  receipt = finalizeReceipt(receipt, { sign: !values["no-sign"] });

  let savedPath: string | undefined;
  if (values.check && !values["no-save"]) {
    savedPath = saveReceipt(receipt, rootDir).path;
  }

  if (values.json) {
    process.stdout.write(JSON.stringify(receipt, null, 2) + "\n");
  } else if (values.md) {
    process.stdout.write(renderReceiptMarkdown(receipt) + "\n");
  } else {
    process.stdout.write(renderReceiptTerminal(receipt, savedPath) + "\n");
  }

  const contradicted = exam.findings.some(
    (f) => f.verdict === "contradicted" || f.verdict === "file-missing",
  );
  if (values.check) return receipt.summary.pass && !contradicted ? 0 : 1;
  return contradicted ? 1 : 0;
}
