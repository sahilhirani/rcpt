# Changelog

## 0.1.0 — 2026-07-19

Initial release.

- `rcpt init` — stack detection (Node/TS, Python, Rust, Go) → `rcpt.config.json`
- `rcpt check` — run proof obligations outside the agent; thermal-receipt
  terminal output, `--json` / `--md` / `--quiet`; receipts saved to `.rcpt/`
- Signed, tamper-evident receipts (canonical-JSON SHA-256 + machine-local
  Ed25519) with `rcpt verify` (hash, signature, drift)
- `rcpt gate` + `rcpt hook install` — Claude Code Stop hook that blocks "done"
  until the gate checks pass (bounded by `gateMaxBlocks`)
- `rcpt audit` — Claude Code transcript cross-examination: claims vs. actual
  commands, phantom-file detection, test-file edit and skip-marker flagging
- `rcpt list`, `rcpt md`, JSON Schemas for config and receipts
- Zero runtime dependencies; tested on Linux/macOS/Windows, Node 20+
