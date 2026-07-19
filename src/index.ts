/** Public API — everything the CLI does is available as a library. */
export { VERSION, TOOL_NAME } from "./version.js";
export type * from "./core/types.js";
export { canonicalJson } from "./core/canonical.js";
export {
  CONFIG_FILENAME,
  ConfigError,
  findConfigPath,
  gateChecks,
  loadConfig,
  loadConfigFile,
  validateConfig,
} from "./core/config.js";
export { detectChecks } from "./core/detect.js";
export { getGitState } from "./core/git.js";
export { ensureKeys, signHash, verifyHashSignature, rcptHome } from "./core/keys.js";
export {
  buildReceipt,
  finalizeReceipt,
  listReceipts,
  loadReceipt,
  makeReceiptId,
  receiptContentSha256,
  resolveReceiptPath,
  saveReceipt,
  sha256Hex,
  verifyReceiptIntegrity,
  RCPT_DIR,
} from "./core/receipt.js";
export {
  fmtDuration,
  renderReceiptMarkdown,
  renderReceiptTerminal,
  renderSummaryLine,
} from "./core/render.js";
export { runCheck, runChecks } from "./core/run.js";
export {
  claudeProjectSlug,
  claudeProjectsDirFor,
  findLatestSession,
  globToRegExp,
  isTestPath,
  parseSessionFile,
  DEFAULT_TEST_GLOBS,
} from "./core/transcript.js";
export { classifyCommand, crossExamine, extractClaims } from "./core/claims.js";
