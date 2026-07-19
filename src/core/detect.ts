import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckConfig } from "./types.js";

export interface DetectedProject {
  checks: CheckConfig[];
  notes: string[];
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function detectPackageManager(rootDir: string): string {
  if (existsSync(join(rootDir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(rootDir, "yarn.lock"))) return "yarn";
  if (existsSync(join(rootDir, "bun.lockb")) || existsSync(join(rootDir, "bun.lock"))) return "bun";
  return "npm";
}

/** Inspect the repo and propose sensible proof obligations. */
export function detectChecks(rootDir: string): DetectedProject {
  const checks: CheckConfig[] = [];
  const notes: string[] = [];
  const add = (name: string, run: string) => {
    if (!checks.some((c) => c.name === name)) checks.push({ name, run });
  };

  const pkg = readJson(join(rootDir, "package.json"));
  if (pkg) {
    const pm = detectPackageManager(rootDir);
    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    notes.push(`detected Node.js project (${pm})`);

    const testScript = scripts.test;
    if (testScript && !/no test specified/i.test(testScript)) {
      add("test", `${pm} run test`);
    }
    if (scripts.typecheck) add("typecheck", `${pm} run typecheck`);
    else if (existsSync(join(rootDir, "tsconfig.json"))) add("typecheck", "npx tsc --noEmit");
    if (scripts.lint) add("lint", `${pm} run lint`);
    if (scripts.build) add("build", `${pm} run build`);
  }

  const hasPyProject = existsSync(join(rootDir, "pyproject.toml"));
  if (
    hasPyProject ||
    existsSync(join(rootDir, "pytest.ini")) ||
    existsSync(join(rootDir, "setup.cfg")) ||
    existsSync(join(rootDir, "tox.ini"))
  ) {
    notes.push("detected Python project");
    const pyproject = hasPyProject ? readFileSync(join(rootDir, "pyproject.toml"), "utf8") : "";
    if (!pkg || /\bpytest\b/.test(pyproject)) add("test", "pytest");
    if (/\bruff\b/.test(pyproject) || existsSync(join(rootDir, "ruff.toml"))) {
      add("lint", "ruff check .");
    }
    if (/\bmypy\b/.test(pyproject)) add("typecheck", "mypy .");
  }

  if (existsSync(join(rootDir, "Cargo.toml"))) {
    notes.push("detected Rust project");
    add("test", "cargo test");
    add("lint", "cargo clippy --quiet -- -D warnings");
  }

  if (existsSync(join(rootDir, "go.mod"))) {
    notes.push("detected Go project");
    add("test", "go test ./...");
    add("lint", "go vet ./...");
  }

  if (checks.length === 0) {
    notes.push("no known project type detected — add your checks to rcpt.config.json by hand");
  }
  return { checks, notes };
}
