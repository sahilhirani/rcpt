# Contributing to rcpt

Thanks for helping make agents show their work.

## Setup

```bash
git clone https://github.com/sahilhirani/rcpt
cd rcpt
npm install
npm test        # builds + runs the full suite
```

`npm run typecheck` checks the whole project including tests. `rcpt check`
(i.e. `node dist/cli.js check`) runs this repo's own proof obligations —
attach the output to your PR with `node dist/cli.js md`. Yes, we require
receipts. Obviously.

## Ground rules

- **Zero runtime dependencies.** A trust tool should have a minimal trust
  surface. Dev dependencies (TypeScript, Vitest) are fine; anything that ships
  in `dist/` must be dependency-free. PRs adding runtime deps will be asked to
  inline or drop them.
- **Every behavior change comes with a test.** The suite is fast (<10s) and
  runs on Linux, macOS, and Windows in CI — mind path separators and shell
  quoting.
- **Honest output.** Verdict labels and docs must never overclaim
  (tamper-*evident*, not tamper-*proof*; `corroborated`, not `verified`).

## Good first contributions

- Transcript adapters for other agents (Codex CLI, OpenCode, Gemini CLI) —
  see `src/core/transcript.ts` for the shape an adapter must produce.
- More claim patterns and command classifiers (`src/core/claims.ts`) — with
  fixture-based tests.
- Detection for more stacks in `rcpt init` (`src/core/detect.ts`).

## Releasing (maintainers)

`npm version <patch|minor>` (updates `package.json`; keep `src/version.ts` in
sync — the test suite fails if they drift), then `npm publish`.
