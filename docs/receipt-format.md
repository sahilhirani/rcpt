# The receipt format

A receipt is a JSON file recording checks that were run outside a coding agent,
bound to a repo state, hashed, and (by default) signed. Schema:
[`schema/receipt.schema.json`](../schema/receipt.schema.json).

```jsonc
{
  "$schema": "https://unpkg.com/keepreceipts/schema/receipt.schema.json",
  "version": 1,
  "id": "rcpt-20260719-082357-83ae01",
  "createdAt": "2026-07-19T08:23:57.924Z",
  "tool": { "name": "rcpt", "version": "0.1.0" },
  "repo": {
    "root": "my-app",
    "git": {
      "available": true,
      "isRepo": true,
      "head": "3f2c91a…full sha…",
      "headShort": "3f2c91a",
      "branch": "main",
      "dirty": true,
      "dirtyFiles": 2,
      "diffSha256": "…sha256 of `git diff HEAD`…"
    }
  },
  "env": { "os": "win32", "arch": "x64", "node": "v24.15.0" },
  "checks": [
    {
      "name": "test",
      "command": "npm run test",
      "cwd": "C:\\repos\\my-app",
      "exitCode": 0,
      "pass": true,
      "timedOut": false,
      "durationMs": 5121,
      "stdoutTail": "…last 4000 chars…",
      "stderrTail": "",
      "outputSha256": "…sha256 of the full output stream…",
      "outputBytes": 48211
    }
  ],
  "summary": { "total": 3, "passed": 3, "failed": 0, "pass": true },
  "audit": { /* optional cross-examination, see below */ },
  "integrity": {
    "contentSha256": "…",
    "signature": {
      "alg": "Ed25519",
      "publicKey": "…SPKI DER, base64…",
      "sig": "…base64…"
    }
  }
}
```

## Canonicalization and hashing

`integrity.contentSha256` is a SHA-256 over the **canonical JSON** of the
receipt with `$schema` and `integrity` removed. Canonical JSON means object
keys sorted recursively (arrays keep their order), serialized with
`JSON.stringify` — so formatting and key order can't change the hash.

The signature is Ed25519 over the UTF-8 bytes of the `contentSha256` hex
string, using a machine-local keypair generated on first use in `~/.rcpt/`
(override the directory with `RCPT_HOME`). The public key is embedded in the
receipt so any holder can verify it.

`rcpt verify` recomputes the hash, checks the signature, and additionally
reports **drift** — whether `HEAD` or the uncommitted diff changed since the
receipt was created.

## The audit block

When produced by `rcpt audit`, the receipt carries the cross-examination:

- `findings[]` — each detected claim from the agent's final message with a
  verdict:
  - `corroborated` — the transcript contains a matching command whose last run
    succeeded
  - `contradicted` — the last matching run failed or was interrupted
  - `unverified` — the claim has no matching command anywhere in the session
  - `file-exists` / `file-missing` — claimed file paths checked on disk
  - `info` — generic completion claims
- `testFileEdits[]` — test files the session modified
- `skipMarkersAdded[]` — test files where the session introduced skip/only
  markers (`.skip(`, `xit(`, `@pytest.mark.skip`, `#[ignore]`, `t.Skip(`)

Claim extraction is heuristic and intentionally conservative (assertions of
completed verification, not intentions). Verdicts describe the *transcript*,
not the code — fresh proof always comes from re-running checks.

## Trust model

What a signed receipt proves:

| claim | proven? |
| --- | --- |
| These commands ran with these exit codes at this time | ✅ within this model |
| The receipt hasn't been edited since it was produced | ✅ hash + signature |
| It was produced by a holder of this machine key | ✅ signature |
| It reflects this repo state | ✅ head/diff hashes + drift check |
| The *code* is correct | ❌ only your checks say that |
| It was produced by an honest environment | ❌ see below |

Known limits, stated plainly:

- **Machine-local key, not remote attestation.** Someone with control of the
  machine (including an agent with shell access) could run `rcpt` themselves
  or use the key. The signature proves integrity and origin-machine, not
  intent. What it defeats: *editing outcomes after the fact* — forging a green
  receipt from a red run fails `verify`.
- **The gate runs in the hook process, outside the agent's turn** — the agent
  cannot answer the gate; it can only make the checks actually pass.
- **Checks are only as good as your config.** `rcpt.config.json` is versioned
  in git precisely so changes to the rules are visible in review.

For teams that need stronger guarantees (shared trust roots, CI
countersigning), see the roadmap in the README.
