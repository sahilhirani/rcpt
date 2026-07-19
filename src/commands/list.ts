import { findConfigPath } from "../core/config.js";
import { listReceipts } from "../core/receipt.js";
import { dim, green, red } from "../core/ansi.js";
import { dirname } from "node:path";

export async function cmdList(cwdOverride?: string): Promise<number> {
  const cwd = cwdOverride ?? process.cwd();
  const configPath = findConfigPath(cwd);
  const rootDir = configPath ? dirname(configPath) : cwd;

  const receipts = listReceipts(rootDir);
  if (receipts.length === 0) {
    process.stdout.write(dim("No receipts yet. Run `rcpt check` to create one.\n"));
    return 0;
  }
  for (const r of receipts) {
    const mark = r.pass ? green("✓ PASS") : red("✗ FAIL");
    process.stdout.write(`${mark}  ${r.id}  ${dim(`${r.createdAt} · ${r.checks} check(s)`)}\n`);
  }
  return 0;
}
