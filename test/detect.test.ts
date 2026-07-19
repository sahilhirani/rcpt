import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { detectChecks } from "../src/core/detect.js";

function tmpProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "rcpt-detect-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

test("detects npm scripts and tsconfig", () => {
  const dir = tmpProject({
    "package.json": JSON.stringify({
      scripts: { test: "vitest run", lint: "eslint .", build: "tsc -p ." },
    }),
    "tsconfig.json": "{}",
  });
  const { checks } = detectChecks(dir);
  const byName = Object.fromEntries(checks.map((c) => [c.name, c.run]));
  expect(byName.test).toBe("npm run test");
  expect(byName.lint).toBe("npm run lint");
  expect(byName.build).toBe("npm run build");
  expect(byName.typecheck).toBe("npx tsc --noEmit");
  rmSync(dir, { recursive: true, force: true });
});

test("prefers pnpm when a pnpm lockfile exists", () => {
  const dir = tmpProject({
    "package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
    "pnpm-lock.yaml": "",
  });
  const { checks } = detectChecks(dir);
  expect(checks.find((c) => c.name === "test")?.run).toBe("pnpm run test");
  rmSync(dir, { recursive: true, force: true });
});

test("skips the npm placeholder test script", () => {
  const dir = tmpProject({
    "package.json": JSON.stringify({
      scripts: { test: 'echo "Error: no test specified" && exit 1' },
    }),
  });
  const { checks } = detectChecks(dir);
  expect(checks.find((c) => c.name === "test")).toBeUndefined();
  rmSync(dir, { recursive: true, force: true });
});

test("detects Rust and Go projects", () => {
  const rust = tmpProject({ "Cargo.toml": '[package]\nname = "x"' });
  expect(detectChecks(rust).checks.find((c) => c.name === "test")?.run).toBe("cargo test");
  rmSync(rust, { recursive: true, force: true });

  const go = tmpProject({ "go.mod": "module x" });
  expect(detectChecks(go).checks.find((c) => c.name === "test")?.run).toBe("go test ./...");
  rmSync(go, { recursive: true, force: true });
});

test("detects pytest + ruff from pyproject", () => {
  const dir = tmpProject({
    "pyproject.toml": "[tool.pytest.ini_options]\naddopts = ''\n[tool.ruff]\nline-length = 100",
  });
  const { checks } = detectChecks(dir);
  expect(checks.find((c) => c.name === "test")?.run).toBe("pytest");
  expect(checks.find((c) => c.name === "lint")?.run).toBe("ruff check .");
  rmSync(dir, { recursive: true, force: true });
});

test("reports when nothing is detected", () => {
  const dir = mkdtempSync(join(tmpdir(), "rcpt-detect-empty-"));
  const { checks, notes } = detectChecks(dir);
  expect(checks).toHaveLength(0);
  expect(notes.join(" ")).toContain("no known project type");
  rmSync(dir, { recursive: true, force: true });
});
