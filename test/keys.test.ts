import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { ensureKeys, rcptHome, signHash, verifyHashSignature } from "../src/core/keys.js";

let home: string;
const HASH = "a".repeat(64);

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "rcpt-keys-"));
  process.env.RCPT_HOME = home;
});

afterAll(() => {
  delete process.env.RCPT_HOME;
  rmSync(home, { recursive: true, force: true });
});

test("RCPT_HOME override is honored", () => {
  expect(rcptHome()).toBe(home);
});

test("ensureKeys generates a keypair once and reuses it", () => {
  const first = ensureKeys();
  expect(first.created).toBe(true);
  expect(existsSync(join(home, "key.pem"))).toBe(true);
  expect(existsSync(join(home, "key.pub.pem"))).toBe(true);

  const second = ensureKeys();
  expect(second.created).toBe(false);
  expect(second.publicKeyDerB64).toBe(first.publicKeyDerB64);
});

test("sign/verify roundtrip", () => {
  const keys = ensureKeys();
  const sig = signHash(HASH, keys.privateKey);
  expect(verifyHashSignature(HASH, keys.publicKeyDerB64, sig)).toBe(true);
});

test("verification fails for a different hash", () => {
  const keys = ensureKeys();
  const sig = signHash(HASH, keys.privateKey);
  expect(verifyHashSignature("b".repeat(64), keys.publicKeyDerB64, sig)).toBe(false);
});

test("verification fails for garbage inputs without throwing", () => {
  expect(verifyHashSignature(HASH, "not-a-key", "not-a-sig")).toBe(false);
});
