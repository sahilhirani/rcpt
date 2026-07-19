import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { findConfigPath } from "../core/config.js";
import { getGitState } from "../core/git.js";
import { loadReceipt, resolveReceiptPath, verifyReceiptIntegrity } from "../core/receipt.js";
import { bold, dim, green, red, yellow } from "../core/ansi.js";
import { dirname } from "node:path";

export async function cmdVerify(argv: string[], cwdOverride?: string): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { json: { type: "boolean" } },
    allowPositionals: true,
  });

  const cwd = cwdOverride ?? process.cwd();
  const configPath = findConfigPath(cwd);
  const rootDir = configPath ? dirname(configPath) : cwd;

  const path = resolveReceiptPath(rootDir, positionals[0]);
  if (!existsSync(path)) {
    process.stderr.write(
      red(`No receipt found at ${path}.`) + dim(" Run `rcpt check` to create one.\n"),
    );
    return 2;
  }

  let receipt;
  try {
    receipt = loadReceipt(path);
  } catch (err) {
    process.stderr.write(red(`Cannot load receipt: ${(err as Error).message}\n`));
    return 2;
  }

  const integrity = verifyReceiptIntegrity(receipt);
  const git = await getGitState(rootDir);

  const drift: string[] = [];
  const rg = receipt.repo.git;
  if (rg.head && git.head && rg.head !== git.head) {
    drift.push(`HEAD moved since receipt (${rg.headShort ?? "?"} → ${git.headShort ?? "?"})`);
  }
  if (rg.isRepo && git.isRepo) {
    if (!rg.dirty && git.dirty) {
      drift.push(
        `working tree is dirty now (${git.dirtyFiles} file(s)) but was clean at receipt time`,
      );
    } else if (
      rg.dirty &&
      git.dirty &&
      rg.diffSha256 &&
      git.diffSha256 &&
      rg.diffSha256 !== git.diffSha256
    ) {
      drift.push("uncommitted changes differ from receipt time");
    }
  }

  if (values.json) {
    process.stdout.write(
      JSON.stringify(
        {
          path,
          integrity,
          drift,
          receipt: { id: receipt.id, createdAt: receipt.createdAt, summary: receipt.summary },
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    process.stdout.write(`\n${bold("receipt")}  ${receipt.id}  ${dim(receipt.createdAt)}\n`);
    process.stdout.write(
      `${bold("checks")}   ${
        receipt.summary.pass
          ? green(`${receipt.summary.passed}/${receipt.summary.total} passed`)
          : red(`${receipt.summary.passed}/${receipt.summary.total} passed`)
      }\n`,
    );
    process.stdout.write(
      `${bold("hash")}     ${
        integrity.hashOk
          ? green("✓ content hash matches")
          : red("✗ CONTENT HASH MISMATCH — receipt was modified")
      }\n`,
    );
    if (integrity.sigPresent) {
      process.stdout.write(
        `${bold("sig")}      ${
          integrity.sigOk ? green("✓ Ed25519 signature valid") : red("✗ SIGNATURE INVALID")
        }\n`,
      );
    } else {
      process.stdout.write(`${bold("sig")}      ${yellow("unsigned (hash only)")}\n`);
    }
    for (const d of drift) process.stdout.write(`${bold("drift")}    ${yellow(d)}\n`);
    if (drift.length === 0 && integrity.ok) {
      process.stdout.write(`${bold("drift")}    ${green("✓ working tree matches receipt state")}\n`);
    }
    process.stdout.write(
      integrity.ok
        ? green(
            `\n✓ receipt is intact${
              drift.length > 0 ? " (but the tree drifted — re-run `rcpt check` for fresh proof)" : ""
            }\n\n`,
          )
        : red("\n✗ receipt failed verification\n\n"),
    );
  }
  return integrity.ok ? 0 : 1;
}
