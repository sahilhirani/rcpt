#!/usr/bin/env node
import { cmdAudit } from "./commands/audit.js";
import { cmdCheck } from "./commands/check.js";
import { cmdGate } from "./commands/gate.js";
import { cmdHook } from "./commands/hook.js";
import { cmdInit } from "./commands/init.js";
import { cmdList } from "./commands/list.js";
import { cmdMd } from "./commands/md.js";
import { cmdVerify } from "./commands/verify.js";
import { findConfigPath } from "./core/config.js";
import { bold, cyan, dim, red } from "./core/ansi.js";
import { HOMEPAGE, TOOL_NAME, VERSION } from "./version.js";

const HELP = `
${bold("🧾 rcpt")} ${dim(`v${VERSION}`)} — receipts for your coding agents

  Your agent says "done". ${bold("Make it prove it.")}
  rcpt runs your checks ${bold("outside")} the agent and prints a signed,
  tamper-evident receipt of what actually passed.

${bold("USAGE")}
  rcpt                     run checks (same as rcpt check)
  rcpt init                detect your stack, write rcpt.config.json
  rcpt check               run all checks → signed receipt (.rcpt/)
       --gate              only the gate subset
       --only a,b          specific checks
       --json | --md       machine/PR-comment output
       --quiet             one-line summary
       --no-save --no-sign skip persisting / signing
  rcpt audit               cross-examine the latest Claude Code session:
                           did it really run what it claims passed?
       --check             also re-run all checks for fresh proof
       --session <file>    audit a specific session transcript
  rcpt verify [ref]        verify a receipt's hash + signature + drift
  rcpt list                list saved receipts
  rcpt md [ref]            print a receipt as markdown (for PR comments)
  rcpt hook install        Claude Code Stop hook: agent can't say "done"
                           until the gate checks pass  [--global]
  rcpt hook status|uninstall
  rcpt gate                (used by the hook; runnable manually)

${bold("QUICKSTART")}
  ${cyan("npx rcpt init && npx rcpt")}

${dim(HOMEPAGE)}
`;

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const rest = argv.slice(1);

  if (cmd === "--version" || cmd === "-v" || cmd === "version") {
    process.stdout.write(`${TOOL_NAME} ${VERSION}\n`);
    return 0;
  }
  if (cmd === "--help" || cmd === "-h" || cmd === "help") {
    process.stdout.write(HELP);
    return 0;
  }

  switch (cmd) {
    case undefined:
      if (findConfigPath(process.cwd())) return cmdCheck([]);
      process.stdout.write(HELP);
      process.stdout.write(dim(`  (no rcpt.config.json here yet — start with \`rcpt init\`)\n\n`));
      return 0;
    case "init":
      return cmdInit(rest);
    case "check":
      return cmdCheck(rest);
    case "audit":
      return cmdAudit(rest);
    case "verify":
      return cmdVerify(rest);
    case "list":
      return cmdList();
    case "md":
      return cmdMd(rest);
    case "hook":
      return cmdHook(rest);
    case "gate":
      return cmdGate();
    default:
      process.stderr.write(red(`Unknown command: ${cmd}\n`));
      process.stdout.write(HELP);
      return 2;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(red(`rcpt: ${(err as Error)?.stack ?? String(err)}\n`));
    process.exitCode = 2;
  });
