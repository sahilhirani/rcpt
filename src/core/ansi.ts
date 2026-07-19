/** Minimal ANSI styling — zero dependencies. Honors NO_COLOR / FORCE_COLOR. */

function colorEnabled(): boolean {
  const force = process.env.FORCE_COLOR;
  if (force !== undefined) return force !== "0";
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.TERM === "dumb") return false;
  return Boolean(process.stdout.isTTY);
}

let enabled = colorEnabled();

/** Test hook: force color on/off. */
export function setColorEnabled(on: boolean): void {
  enabled = on;
}

function wrap(open: number, close: number): (s: string) => string {
  return (s: string) => (enabled ? `[${open}m${s}[${close}m` : s);
}

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const cyan = wrap(36, 39);
export const gray = wrap(90, 39);

const ANSI_RE = /\[[0-9;]*m/g;

/** Strip ANSI escapes (for measuring widths and for tests). */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/** Visible length of a string, ignoring ANSI escapes. */
export function visibleLength(s: string): number {
  return stripAnsi(s).length;
}

/** Pad the end of a styled string to a visible width. */
export function padEndVisible(s: string, width: number): string {
  const pad = width - visibleLength(s);
  return pad > 0 ? s + " ".repeat(pad) : s;
}

/** Pad the start of a styled string to a visible width. */
export function padStartVisible(s: string, width: number): string {
  const pad = width - visibleLength(s);
  return pad > 0 ? " ".repeat(pad) + s : s;
}
