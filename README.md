<div align="center">

# 🧾 rcpt

**Receipts for your coding agents.**

Your agent says *"All tests pass ✅"* — **make it prove it.**

`rcpt` runs your checks **outside** the agent, cross-examines the agent's own
transcript, and prints a signed, tamper-evident receipt of what actually passed.

[![CI](https://github.com/sahilhirani/rcpt/actions/workflows/ci.yml/badge.svg)](https://github.com/sahilhirani/rcpt/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Zero runtime dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)

</div>

```text
══════════════════════════════════════════════
                R E C E I P T
         proof of work · rcpt v0.1.0
══════════════════════════════════════════════
repo   my-app @ 3f2c91a
date   2026-07-19 08:23:57 UTC
env    node v24.15.0 · win32 x64
──────────────────────────────────────────────
CHECK                          TIME     RESULT
typecheck                      1.5s     ✓ PASS
build                          1.3s     ✓ PASS
test                           5.1s     ✓ PASS
──────────────────────────────────────────────
TOTAL  3/3 PASSED               ✓ PAID IN FULL
──────────────────────────────────────────────
id     rcpt-20260719-082357-83ae01
sha256 a7d706f6bcd60e6a5cd6c99c… ✓ signed ed25519
    ▌█▎█▏▌█▌█▏▎▌▏▌▌▌▎▏▎▌▏▎▎▏▌▌▎██▌▎▌▎██▏▎█
saved  .rcpt/rcpt-20260719-082357-83ae01.json
══════════════════════════════════════════════
           verify: npx rcpt verify
       * THANK YOU FOR SHIPPING PROOF *
```

## Why this exists

Coding agents optimize for *looking* done. They say "all tests pass" while the
suite has syntax errors. They report files created that don't exist. One study
of agent benchmarks found **53% of reported "passes" were tasks the agent never
solved** — the harness trusted the transcript. Every orchestrator that "verifies"
by reading the agent's own words has the same hole: **the witness is grading its
own testimony.**

CI can't save you either — CI proves the *merge*, minutes later, after you
already accepted the lie. `rcpt` proves the *session*: on your machine, the
moment "done" is claimed, in a process the agent doesn't control.

## Quickstart

```bash
npx rcpt init   # detects your stack, writes rcpt.config.json
npx rcpt        # runs your checks → signed receipt in .rcpt/
```

`rcpt.config.json` is just named commands — your proof obligations:

```json
{
  "$schema": "https://unpkg.com/rcpt/schema/rcpt.config.schema.json",
  "checks": [
    { "name": "test", "run": "npm run test" },
    { "name": "typecheck", "run": "npx tsc --noEmit" },
    { "name": "build", "run": "npm run build" }
  ],
  "gate": ["test", "typecheck"]
}
```

Works with any language — a check is any command that exits 0 (`pytest`,
`cargo test`, `go test ./...`, `make ci`, …).

## The stop-gate: your agent can't say "done" until it's true

```bash
rcpt hook install
```

This installs a [Claude Code](https://code.claude.com) `Stop` hook. When the
agent tries to end its turn, `rcpt gate` runs your gate checks **outside the
agent**. If they fail, the agent is sent back with the failure list:

> `rcpt gate: test (exit 1) failed. Fix the failures and run `rcpt check` to
> confirm before finishing. (block 1/3)`

It gives up after `gateMaxBlocks` attempts (default 3) so nothing loops
forever, and it never blocks sessions in repos that haven't adopted rcpt.

## The audit: cross-examine the transcript

```bash
rcpt audit            # latest Claude Code session for this repo
rcpt audit --check    # …and re-run all checks for fresh proof
```

`rcpt audit` parses the agent's session log and compares **what it claimed**
against **what it actually ran**:

```text
──────────────────────────────────────────────
CROSS-EXAMINATION (claude-code)
  CONTRADICTED  test
     last test run failed (exit 1): `npm test`
  unverified  build
     no build command found anywhere in the
     session transcript
  file exists  file src/parser.ts
  ⚠ skip markers added in: src/math.test.ts
──────────────────────────────────────────────
```

It catches the classics:

- **claimed but never ran** — "tests pass" with zero test commands in the log
- **claimed but failed** — the last `npm test` exited 1
- **phantom files** — "I created x.ts" for files that don't exist
- **grade tampering** — `.skip` / `xit` / `@pytest.mark.skip` quietly added to
  test files mid-session

Verdicts are labeled honestly: `corroborated` means the transcript agrees, not
that the code is good — run `rcpt check` (or `audit --check`) for fresh proof.

## Receipts are tamper-evident

Every receipt carries a SHA-256 over its canonical JSON, signed with a
machine-local Ed25519 key (`~/.rcpt/`). If anyone — human or agent — edits a
receipt's grade after the fact:

```bash
$ rcpt verify
hash     ✗ CONTENT HASH MISMATCH — receipt was modified
```

`verify` also reports **drift**: whether HEAD moved or the working tree changed
since the receipt was printed, so a stale green receipt can't masquerade as
current. Full format and threat model: [docs/receipt-format.md](docs/receipt-format.md).

## In CI and PRs

```yaml
- run: npx rcpt check --md >> "$GITHUB_STEP_SUMMARY"
```

or attach the receipt to a PR:

```bash
rcpt md | gh pr comment --body-file -
```

which renders as a table with per-check results, failure log tails, and the
cross-examination verdicts.

## Commands

| command | what it does |
| --- | --- |
| `rcpt init` | detect your stack, write `rcpt.config.json` |
| `rcpt check` | run checks → signed receipt (`--json`, `--md`, `--quiet`, `--only a,b`, `--gate`) |
| `rcpt audit` | cross-examine the latest agent session (`--check`, `--session <file>`) |
| `rcpt verify [ref]` | verify hash + signature + drift of a receipt |
| `rcpt list` | list saved receipts |
| `rcpt md [ref]` | print a receipt as markdown |
| `rcpt hook install\|status\|uninstall` | manage the Claude Code stop-gate (`--global`) |
| `rcpt gate` | the stop-gate itself (also runnable manually) |

## FAQ

**Isn't this just CI?**
CI proves the merge; rcpt proves the session. It runs where the lie happens —
on the dev machine, at the moment "done" is claimed — and produces a portable
artifact you can attach to the PR that CI later confirms.

**Can't the agent just edit the receipt?**
Then `rcpt verify` fails: the content hash won't match, and the signature won't
re-sign without the key. Receipts are tamper-*evident*, not tamper-*proof* —
the honest claim is "this exact result was produced on this machine and hasn't
been altered." See the [threat model](docs/receipt-format.md#trust-model).

**Can't the agent weaken the checks?**
`rcpt.config.json` lives in git — a check that went from `npm test` to
`echo ok` shows up in the diff. Reviewing the config is reviewing the rules.

**Which agents?**
`check`, `gate`, and receipts are agent-agnostic. Transcript audit supports
Claude Code today; Codex CLI and OpenCode adapters are next on the roadmap.

**Does it phone home?**
No. Zero runtime dependencies, zero network calls, everything local.

## Roadmap

- Transcript adapters: Codex CLI, OpenCode, Gemini CLI
- GitHub Action with automatic PR receipt comments
- Shared verify keys for teams (trust roots)
- `rcpt watch` — continuous gate during long agent runs

## Contributing

`npm install && npm test` — that's the whole setup. The project has **zero
runtime dependencies** and intends to keep it that way (a trust tool should
have a minimal trust surface). Attach a receipt to your PR: `rcpt md`.
See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Sahil Hirani
