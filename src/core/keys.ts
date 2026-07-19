import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Machine-local Ed25519 keypair used to sign receipts. Lives in ~/.rcpt
 * (override with RCPT_HOME — used by tests). The signature makes receipts
 * tamper-evident; it is not remote attestation (see docs/receipt-format.md).
 */
export function rcptHome(): string {
  return process.env.RCPT_HOME ?? join(homedir(), ".rcpt");
}

function keyPaths(): { priv: string; pub: string } {
  const home = rcptHome();
  return { priv: join(home, "key.pem"), pub: join(home, "key.pub.pem") };
}

export interface KeyPair {
  privateKey: KeyObject;
  publicKey: KeyObject;
  /** SPKI DER, base64 — embedded in receipts. */
  publicKeyDerB64: string;
  created: boolean;
}

export function ensureKeys(): KeyPair {
  const { priv, pub } = keyPaths();
  let created = false;
  if (!existsSync(priv)) {
    mkdirSync(rcptHome(), { recursive: true });
    const pair = generateKeyPairSync("ed25519");
    writeFileSync(priv, pair.privateKey.export({ type: "pkcs8", format: "pem" }));
    writeFileSync(pub, pair.publicKey.export({ type: "spki", format: "pem" }));
    try {
      chmodSync(priv, 0o600);
    } catch {
      // Windows: ACLs, not modes — best effort.
    }
    created = true;
  }
  const privateKey = createPrivateKey(readFileSync(priv, "utf8"));
  const publicKey = createPublicKey(readFileSync(pub, "utf8"));
  const publicKeyDerB64 = (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString(
    "base64",
  );
  return { privateKey, publicKey, publicKeyDerB64, created };
}

/** Sign a receipt content hash (the hex string, UTF-8 encoded). */
export function signHash(hashHex: string, privateKey: KeyObject): string {
  return cryptoSign(null, Buffer.from(hashHex, "utf8"), privateKey).toString("base64");
}

/** Verify a signature against the embedded public key. */
export function verifyHashSignature(
  hashHex: string,
  publicKeyDerB64: string,
  sigB64: string,
): boolean {
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(publicKeyDerB64, "base64"),
      format: "der",
      type: "spki",
    });
    return cryptoVerify(
      null,
      Buffer.from(hashHex, "utf8"),
      publicKey,
      Buffer.from(sigB64, "base64"),
    );
  } catch {
    return false;
  }
}
