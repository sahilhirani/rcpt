import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  ConfigError,
  findConfigPath,
  gateChecks,
  loadConfigFile,
  validateConfig,
} from "../src/core/config.js";

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "rcpt-config-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

test("a minimal valid config parses", () => {
  const config = validateConfig({ checks: [{ name: "test", run: "npm test" }] });
  expect(config.checks).toHaveLength(1);
  expect(config.checks[0]!.name).toBe("test");
});

test("empty or missing checks are rejected", () => {
  expect(() => validateConfig({})).toThrow(ConfigError);
  expect(() => validateConfig({ checks: [] })).toThrow(/non-empty/);
});

test("duplicate check names are rejected", () => {
  expect(() =>
    validateConfig({
      checks: [
        { name: "test", run: "a" },
        { name: "test", run: "b" },
      ],
    }),
  ).toThrow(/duplicate/);
});

test("gate referencing unknown checks is rejected", () => {
  expect(() =>
    validateConfig({ checks: [{ name: "test", run: "a" }], gate: ["nope"] }),
  ).toThrow(/unknown check "nope"/);
});

test("bad timeoutSeconds is rejected", () => {
  expect(() =>
    validateConfig({ checks: [{ name: "t", run: "a", timeoutSeconds: -1 }] }),
  ).toThrow(/timeoutSeconds/);
});

test("gateChecks returns the gate subset in gate order, defaulting to all", () => {
  const config = validateConfig({
    checks: [
      { name: "a", run: "x" },
      { name: "b", run: "y" },
      { name: "c", run: "z" },
    ],
    gate: ["c", "a"],
  });
  expect(gateChecks(config).map((c) => c.name)).toEqual(["c", "a"]);

  const noGate = validateConfig({ checks: [{ name: "a", run: "x" }] });
  expect(gateChecks(noGate).map((c) => c.name)).toEqual(["a"]);
});

test("findConfigPath walks up parent directories", () => {
  const root = join(tmp, "walk");
  const deep = join(root, "a", "b", "c");
  mkdirSync(deep, { recursive: true });
  writeFileSync(
    join(root, "rcpt.config.json"),
    JSON.stringify({ checks: [{ name: "t", run: "x" }] }),
  );
  expect(findConfigPath(deep)).toBe(join(root, "rcpt.config.json"));
});

test("loadConfigFile rejects invalid JSON with a friendly error", () => {
  const bad = join(tmp, "bad.json");
  writeFileSync(bad, "{ not json");
  expect(() => loadConfigFile(bad)).toThrow(/not valid JSON/);
});
