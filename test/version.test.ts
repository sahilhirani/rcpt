import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { NPM_PACKAGE, TOOL_NAME, VERSION } from "../src/version.js";

test("version constants match package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    name: string;
    version: string;
    bin: Record<string, string>;
  };
  expect(VERSION).toBe(pkg.version);
  expect(NPM_PACKAGE).toBe(pkg.name);
  // The brand/command name stays `rcpt` even though the npm package is rcpt-cli.
  expect(Object.keys(pkg.bin)).toEqual([TOOL_NAME]);
});
