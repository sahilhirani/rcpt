import { parseArgs } from "node:util";
import { ConfigError, gateChecks, loadConfig } from "../core/config.js";
import { getGitState } from "../core/git.js";
import { buildReceipt, finalizeReceipt, saveReceipt } from "../core/receipt.js";
import {
  fmtDuration,
  renderReceiptMarkdown,
  renderReceiptTerminal,
  renderSummaryLine,
} from "../core/render.js";
import { runChecks } from "../core/run.js";
import { cyan, dim, green, red } from "../core/ansi.js";
import type { AuditReport } from "../core/types.js";

export interface CheckOptions {
  cwd?: string;
  audit?: AuditReport;
}

export async function cmdCheck(argv: string[], opts: CheckOptions = {}): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      only: { type: "string" },
      gate: { type: "boolean" },
      json: { type: "boolean" },
      md: { type: "boolean" },
      quiet: { type: "boolean", short: "q" },
      "no-save": { type: "boolean" },
      "no-sign": { type: "boolean" },
    },
    allowPositionals: false,
  });

  const cwd = opts.cwd ?? process.cwd();
  let loaded;
  try {
    loaded = loadConfig(cwd);
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(red(err.message) + "\n");
      return 2;
    }
    throw err;
  }
  const { config, rootDir } = loaded;

  let checks = values.gate ? gateChecks(config) : config.checks;
  if (values.only) {
    const names = values.only.split(",").map((s) => s.trim()).filter(Boolean);
    const known = new Map(config.checks.map((c) => [c.name, c]));
    const missing = names.filter((n) => !known.has(n));
    if (missing.length > 0) {
      process.stderr.write(red(`Unknown check(s): ${missing.join(", ")}`) + "\n");
      return 2;
    }
    checks = names.map((n) => known.get(n)!);
  }

  const structured = Boolean(values.json || values.md);
  const showProgress = !structured && !values.quiet;

  const results = await runChecks(checks, rootDir, {
    onStart: (check) => {
      if (showProgress) process.stderr.write(dim(`▸ ${check.name}: ${check.run}\n`));
    },
    onFinish: (result) => {
      if (showProgress) {
        const mark = result.pass ? green("✓") : red("✗");
        process.stderr.write(
          `${mark} ${result.name} ${dim(`(${fmtDuration(result.durationMs)})`)}\n`,
        );
      }
    },
  });

  const git = await getGitState(rootDir);
  let receipt = buildReceipt({ rootDir, git, checks: results, audit: opts.audit });
  receipt = finalizeReceipt(receipt, { sign: !values["no-sign"] });

  let savedPath: string | undefined;
  if (!values["no-save"]) {
    savedPath = saveReceipt(receipt, rootDir).path;
  }

  if (values.json) {
    process.stdout.write(JSON.stringify(receipt, null, 2) + "\n");
  } else if (values.md) {
    process.stdout.write(renderReceiptMarkdown(receipt) + "\n");
  } else if (values.quiet) {
    process.stdout.write(renderSummaryLine(receipt) + "\n");
  } else {
    process.stdout.write(renderReceiptTerminal(receipt, savedPath) + "\n");
    if (!receipt.summary.pass) {
      process.stdout.write(
        dim(`  tip: see failing output tails in ${cyan(savedPath ?? "the receipt JSON")}\n\n`),
      );
    }
  }
  return receipt.summary.pass ? 0 : 1;
}
