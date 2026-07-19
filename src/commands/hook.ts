import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { bold, cyan, dim, green, red, yellow } from "../core/ansi.js";
import { VERSION } from "../version.js";

const GATE_MARKER = "rcpt gate";

interface HookEntry {
  matcher?: string;
  hooks: Array<{ type: string; command: string; timeout?: number }>;
}

function settingsPath(global: boolean, cwd: string): string {
  return global
    ? join(homedir(), ".claude", "settings.json")
    : join(cwd, ".claude", "settings.json");
}

function readSettings(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `${path} is not valid JSON (${(err as Error).message}) — fix it before installing the hook.`,
    );
  }
}

function hasLocalRcptDependency(cwd: string): boolean {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<
      string,
      Record<string, string>
    >;
    return Boolean(pkg.dependencies?.rcpt ?? pkg.devDependencies?.rcpt);
  } catch {
    return false;
  }
}

export function defaultGateCommand(cwd: string): string {
  return hasLocalRcptDependency(cwd)
    ? "npx --no-install rcpt gate"
    : `npx -y rcpt@${VERSION} gate`;
}

export async function cmdHook(argv: string[], cwdOverride?: string): Promise<number> {
  const sub = argv[0];
  const rest = argv.slice(1);
  const { values } = parseArgs({
    args: rest,
    options: {
      global: { type: "boolean", short: "g" },
      command: { type: "string" },
      timeout: { type: "string" },
    },
    allowPositionals: false,
  });

  const cwd = cwdOverride ?? process.cwd();
  const path = settingsPath(Boolean(values.global), cwd);

  if (sub !== "install" && sub !== "uninstall" && sub !== "status") {
    process.stderr.write(
      `usage: rcpt hook ${bold("install")}|${bold("uninstall")}|${bold("status")} [--global] [--command <cmd>] [--timeout <secs>]\n`,
    );
    return 2;
  }

  let settings: Record<string, unknown>;
  try {
    settings = readSettings(path);
  } catch (err) {
    process.stderr.write(red((err as Error).message) + "\n");
    return 2;
  }
  const hooks = (settings.hooks ?? {}) as Record<string, HookEntry[]>;
  const stopHooks: HookEntry[] = Array.isArray(hooks.Stop) ? hooks.Stop : [];
  const existing = stopHooks.filter((entry) =>
    entry.hooks?.some((h) => typeof h.command === "string" && h.command.includes(GATE_MARKER)),
  );

  if (sub === "status") {
    if (existing.length === 0) {
      process.stdout.write(dim(`no rcpt gate hook in ${path}\n`));
    } else {
      for (const entry of existing) {
        for (const h of entry.hooks) {
          if (h.command.includes(GATE_MARKER)) {
            process.stdout.write(`${green("✓ installed")}  ${h.command}  ${dim(`(${path})`)}\n`);
          }
        }
      }
    }
    return 0;
  }

  if (sub === "install") {
    if (existing.length > 0) {
      process.stdout.write(yellow("rcpt gate hook already installed.") + dim(` (${path})\n`));
      return 0;
    }
    const command = values.command ?? defaultGateCommand(cwd);
    const timeout = values.timeout ? parseInt(values.timeout, 10) : 600;
    if (Number.isNaN(timeout) || timeout <= 0) {
      process.stderr.write(red("--timeout must be a positive number of seconds\n"));
      return 2;
    }
    stopHooks.push({ hooks: [{ type: "command", command, timeout }] });
    hooks.Stop = stopHooks;
    settings.hooks = hooks;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
    process.stdout.write(
      `${green("✓")} Stop hook installed in ${cyan(path)}\n\n` +
        `  ${bold(command)}\n\n` +
        `From now on, when Claude Code tries to finish, rcpt runs your gate checks.\n` +
        `If they fail, the agent is sent back to fix them (up to gateMaxBlocks times).\n` +
        dim(`  restart your Claude Code session for the hook to load\n`),
    );
    return 0;
  }

  // uninstall
  if (existing.length === 0) {
    process.stdout.write(dim(`no rcpt gate hook found in ${path}\n`));
    return 0;
  }
  hooks.Stop = stopHooks
    .map((entry) => ({
      ...entry,
      hooks: entry.hooks.filter(
        (h) => !(typeof h.command === "string" && h.command.includes(GATE_MARKER)),
      ),
    }))
    .filter((entry) => entry.hooks.length > 0);
  if (hooks.Stop.length === 0) delete hooks.Stop;
  settings.hooks = hooks;
  if (Object.keys(hooks).length === 0) delete settings.hooks;
  writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
  process.stdout.write(`${green("✓")} rcpt gate hook removed from ${cyan(path)}\n`);
  return 0;
}
