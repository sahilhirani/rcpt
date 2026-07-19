import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { canonicalJson } from "./canonical.js";
import { ensureKeys, signHash, verifyHashSignature } from "./keys.js";
import type { AuditReport, CheckResult, GitState, Receipt } from "./types.js";
import { TOOL_NAME, VERSION } from "../version.js";

export const RCPT_DIR = ".rcpt";
export const LATEST_NAME = "latest.json";
export const RECEIPT_SCHEMA_URL = "https://unpkg.com/rcpt/schema/receipt.schema.json";

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function makeReceiptId(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
  return `rcpt-${stamp}-${randomBytes(3).toString("hex")}`;
}

export interface BuildReceiptParts {
  rootDir: string;
  git: GitState;
  checks: CheckResult[];
  audit?: AuditReport;
  now?: Date;
}

export function buildReceipt(parts: BuildReceiptParts): Receipt {
  const now = parts.now ?? new Date();
  const passed = parts.checks.filter((c) => c.pass).length;
  return {
    $schema: RECEIPT_SCHEMA_URL,
    version: 1,
    id: makeReceiptId(now),
    createdAt: now.toISOString(),
    tool: { name: TOOL_NAME, version: VERSION },
    repo: { root: basename(resolve(parts.rootDir)), git: parts.git },
    env: { os: process.platform, arch: process.arch, node: process.version },
    checks: parts.checks,
    summary: {
      total: parts.checks.length,
      passed,
      failed: parts.checks.length - passed,
      pass: parts.checks.length > 0 && passed === parts.checks.length,
    },
    audit: parts.audit,
  };
}

/** The hash covers everything except $schema and the integrity block itself. */
export function receiptContentSha256(receipt: Receipt): string {
  const { integrity: _i, $schema: _s, ...content } = receipt;
  return sha256Hex(canonicalJson(content));
}

/** Compute the content hash and (optionally) sign it with the machine key. */
export function finalizeReceipt(receipt: Receipt, opts: { sign: boolean }): Receipt {
  const contentSha256 = receiptContentSha256(receipt);
  if (!opts.sign) {
    return { ...receipt, integrity: { contentSha256 } };
  }
  const keys = ensureKeys();
  return {
    ...receipt,
    integrity: {
      contentSha256,
      signature: {
        alg: "Ed25519",
        publicKey: keys.publicKeyDerB64,
        sig: signHash(contentSha256, keys.privateKey),
      },
    },
  };
}

export interface IntegrityCheck {
  hashPresent: boolean;
  hashOk: boolean;
  sigPresent: boolean;
  sigOk: boolean;
  ok: boolean;
}

export function verifyReceiptIntegrity(receipt: Receipt): IntegrityCheck {
  const hashPresent = Boolean(receipt.integrity?.contentSha256);
  const recomputed = receiptContentSha256(receipt);
  const hashOk = hashPresent && receipt.integrity?.contentSha256 === recomputed;
  const sig = receipt.integrity?.signature;
  const sigPresent = Boolean(sig);
  const sigOk = sig
    ? verifyHashSignature(receipt.integrity!.contentSha256, sig.publicKey, sig.sig)
    : false;
  return {
    hashPresent,
    hashOk,
    sigPresent,
    sigOk,
    ok: hashOk && (!sigPresent || sigOk),
  };
}

export function rcptDir(rootDir: string): string {
  return join(rootDir, RCPT_DIR);
}

export function saveReceipt(
  receipt: Receipt,
  rootDir: string,
): { path: string; latestPath: string } {
  const dir = rcptDir(rootDir);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${receipt.id}.json`);
  const json = JSON.stringify(receipt, null, 2) + "\n";
  writeFileSync(path, json);
  const latestPath = join(dir, LATEST_NAME);
  writeFileSync(latestPath, json);
  return { path, latestPath };
}

export function loadReceipt(path: string): Receipt {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as Receipt;
  if (parsed.version !== 1 || !Array.isArray(parsed.checks)) {
    throw new Error(`${path} does not look like an rcpt receipt (version 1).`);
  }
  return parsed;
}

/** Resolve "latest", a receipt id, or a path to a receipt file. */
export function resolveReceiptPath(rootDir: string, ref?: string): string {
  if (!ref || ref === "latest") return join(rcptDir(rootDir), LATEST_NAME);
  if (existsSync(ref)) return ref;
  const byId = join(rcptDir(rootDir), ref.endsWith(".json") ? ref : `${ref}.json`);
  if (existsSync(byId)) return byId;
  return ref;
}

export interface ReceiptListing {
  path: string;
  id: string;
  createdAt: string;
  pass: boolean;
  checks: number;
}

export function listReceipts(rootDir: string): ReceiptListing[] {
  const dir = rcptDir(rootDir);
  if (!existsSync(dir)) return [];
  const out: ReceiptListing[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.startsWith("rcpt-") || !name.endsWith(".json")) continue;
    try {
      const r = loadReceipt(join(dir, name));
      out.push({
        path: join(dir, name),
        id: r.id,
        createdAt: r.createdAt,
        pass: r.summary.pass,
        checks: r.summary.total,
      });
    } catch {
      // Skip unreadable files.
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
