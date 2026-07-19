import { existsSync, appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { CONFIG_FILENAME } from "../core/config.js";
import { detectChecks } from "../core/detect.js";
import { bold, cyan, dim, green, yellow } from "../core/ansi.js";

const CONFIG_SCHEMA_URL = "https://unpkg.com/rcpt-cli/schema/rcpt.config.schema.json";

const SAMPLE = `{
  "$schema": "${CONFIG_SCHEMA_URL}",
  "checks": [
    { "name": "test", "run": "npm run test" },
    { "name": "typecheck", "run": "npx tsc --noEmit" }
  ]
}`;

export async function cmdInit(argv: string[], cwdOverride?: string): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      force: { type: "boolean", short: "f" },
      print: { type: "boolean" },
    },
    allowPositionals: false,
  });

  const cwd = cwdOverride ?? process.cwd();
  const configPath = join(cwd, CONFIG_FILENAME);

  if (existsSync(configPath) && !values.force) {
    process.stderr.write(
      yellow(`${CONFIG_FILENAME} already exists.`) + dim(" Use --force to overwrite.\n"),
    );
    return 2;
  }

  const detected = detectChecks(cwd);
  for (const note of detected.notes) process.stderr.write(dim(`· ${note}\n`));

  if (detected.checks.length === 0) {
    process.stderr.write(
      `\n${yellow("Couldn't detect checks automatically.")} Create ${cyan(CONFIG_FILENAME)} yourself:\n\n${SAMPLE}\n\nEach check is a command that proves something: tests pass, build compiles, lint is clean.\n`,
    );
    return 1;
  }

  const config = {
    $schema: CONFIG_SCHEMA_URL,
    checks: detected.checks,
  };
  const json = JSON.stringify(config, null, 2) + "\n";
  if (values.print) {
    process.stdout.write(json);
    return 0;
  }
  writeFileSync(configPath, json);

  // Keep receipts out of version control by default.
  if (existsSync(join(cwd, ".git"))) {
    const gitignorePath = join(cwd, ".gitignore");
    const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
    if (!/^\.rcpt\/?\s*$/m.test(existing)) {
      appendFileSync(
        gitignorePath,
        (existing.endsWith("\n") || existing === "" ? "" : "\n") + ".rcpt/\n",
      );
      process.stderr.write(dim(`· added .rcpt/ to .gitignore\n`));
    }
  }

  process.stdout.write(
    `\n${green("✓")} wrote ${bold(CONFIG_FILENAME)} with ${detected.checks.length} check(s):\n` +
      detected.checks.map((c) => `    ${cyan(c.name.padEnd(12))} ${dim(c.run)}`).join("\n") +
      `\n\nNext:\n  ${bold("rcpt check")}          run the checks, print a signed receipt\n  ${bold("rcpt hook install")}   make Claude Code prove its work before it stops\n  ${bold("rcpt audit")}          cross-examine the latest agent session\n\n`,
  );
  return 0;
}
