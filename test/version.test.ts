import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { TOOL_NAME, VERSION } from "../src/version.js";

test("VERSION matches package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    name: string;
    version: string;
  };
  expect(VERSION).toBe(pkg.version);
  expect(TOOL_NAME).toBe(pkg.name);
});
