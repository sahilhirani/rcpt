import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { CheckConfig, RcptConfig } from "./types.js";

export const CONFIG_FILENAME = "rcpt.config.json";
export const DEFAULT_TIMEOUT_SECONDS = 600;
export const DEFAULT_GATE_MAX_BLOCKS = 3;

export class ConfigError extends Error {}

export interface LoadedConfig {
  config: RcptConfig;
  /** Directory containing rcpt.config.json — the project root for rcpt. */
  rootDir: string;
  path: string;
}

/** Walk up from startDir looking for rcpt.config.json. */
export function findConfigPath(startDir: string): string | null {
  let dir = resolve(startDir);
  for (let i = 0; i < 30; i++) {
    const candidate = join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export function loadConfig(startDir: string): LoadedConfig {
  const path = findConfigPath(startDir);
  if (!path) {
    throw new ConfigError(
      `No ${CONFIG_FILENAME} found in ${resolve(startDir)} or any parent directory. Run \`rcpt init\` first.`,
    );
  }
  return loadConfigFile(path);
}

export function loadConfigFile(path: string): LoadedConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new ConfigError(`Cannot read ${path}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(`${path} is not valid JSON: ${(err as Error).message}`);
  }
  const config = validateConfig(parsed, path);
  return { config, rootDir: dirname(resolve(path)), path: resolve(path) };
}

export function validateConfig(value: unknown, source = CONFIG_FILENAME): RcptConfig {
  const problems: string[] = [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError(`${source}: config must be a JSON object.`);
  }
  const obj = value as Record<string, unknown>;

  const checks: CheckConfig[] = [];
  if (!Array.isArray(obj.checks) || obj.checks.length === 0) {
    problems.push(`"checks" must be a non-empty array.`);
  } else {
    const seen = new Set<string>();
    obj.checks.forEach((c, i) => {
      if (c === null || typeof c !== "object") {
        problems.push(`checks[${i}] must be an object.`);
        return;
      }
      const check = c as Record<string, unknown>;
      const name = check.name;
      const run = check.run;
      if (typeof name !== "string" || name.trim() === "") {
        problems.push(`checks[${i}].name must be a non-empty string.`);
        return;
      }
      if (seen.has(name)) problems.push(`duplicate check name "${name}".`);
      seen.add(name);
      if (typeof run !== "string" || run.trim() === "") {
        problems.push(`checks[${i}] ("${name}").run must be a non-empty string.`);
        return;
      }
      if (check.cwd !== undefined && typeof check.cwd !== "string") {
        problems.push(`checks[${i}] ("${name}").cwd must be a string.`);
      }
      if (
        check.timeoutSeconds !== undefined &&
        (typeof check.timeoutSeconds !== "number" || check.timeoutSeconds <= 0)
      ) {
        problems.push(`checks[${i}] ("${name}").timeoutSeconds must be a positive number.`);
      }
      checks.push({
        name,
        run,
        cwd: check.cwd as string | undefined,
        timeoutSeconds: check.timeoutSeconds as number | undefined,
      });
    });
  }

  let gate: string[] | undefined;
  if (obj.gate !== undefined) {
    if (!Array.isArray(obj.gate) || obj.gate.some((g) => typeof g !== "string")) {
      problems.push(`"gate" must be an array of check names.`);
    } else {
      gate = obj.gate as string[];
      const names = new Set(checks.map((c) => c.name));
      for (const g of gate) {
        if (!names.has(g)) problems.push(`"gate" references unknown check "${g}".`);
      }
    }
  }

  let gateMaxBlocks: number | undefined;
  if (obj.gateMaxBlocks !== undefined) {
    if (
      typeof obj.gateMaxBlocks !== "number" ||
      !Number.isInteger(obj.gateMaxBlocks) ||
      obj.gateMaxBlocks < 0
    ) {
      problems.push(`"gateMaxBlocks" must be a non-negative integer.`);
    } else {
      gateMaxBlocks = obj.gateMaxBlocks;
    }
  }

  let audit: RcptConfig["audit"];
  if (obj.audit !== undefined) {
    if (obj.audit === null || typeof obj.audit !== "object" || Array.isArray(obj.audit)) {
      problems.push(`"audit" must be an object.`);
    } else {
      const a = obj.audit as Record<string, unknown>;
      if (
        a.testGlobs !== undefined &&
        (!Array.isArray(a.testGlobs) || a.testGlobs.some((g) => typeof g !== "string"))
      ) {
        problems.push(`"audit.testGlobs" must be an array of glob strings.`);
      } else {
        audit = { testGlobs: a.testGlobs as string[] | undefined };
      }
    }
  }

  if (problems.length > 0) {
    throw new ConfigError(`${source} has problems:\n  - ${problems.join("\n  - ")}`);
  }
  return {
    checks,
    gate,
    gateMaxBlocks,
    audit,
    $schema: typeof obj.$schema === "string" ? obj.$schema : undefined,
  };
}

/** The checks the stop-gate runs: config.gate subset, or all checks. */
export function gateChecks(config: RcptConfig): CheckConfig[] {
  if (!config.gate || config.gate.length === 0) return config.checks;
  const byName = new Map(config.checks.map((c) => [c.name, c]));
  return config.gate.map((name) => byName.get(name)).filter((c): c is CheckConfig => Boolean(c));
}
