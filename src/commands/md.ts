import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { findConfigPath } from "../core/config.js";
import { loadReceipt, resolveReceiptPath } from "../core/receipt.js";
import { renderReceiptMarkdown } from "../core/render.js";
import { dim, red } from "../core/ansi.js";

/** Print a saved receipt as markdown — pipe into `gh pr comment -F -`. */
export async function cmdMd(argv: string[], cwdOverride?: string): Promise<number> {
  const cwd = cwdOverride ?? process.cwd();
  const configPath = findConfigPath(cwd);
  const rootDir = configPath ? dirname(configPath) : cwd;

  const path = resolveReceiptPath(rootDir, argv[0]);
  if (!existsSync(path)) {
    process.stderr.write(red(`No receipt found at ${path}.`) + dim(" Run `rcpt check` first.\n"));
    return 2;
  }
  const receipt = loadReceipt(path);
  process.stdout.write(renderReceiptMarkdown(receipt) + "\n");
  return 0;
}
