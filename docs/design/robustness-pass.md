# The Robustness Pass

A systematic pass across everything built, looking specifically for gaps in error handling,
failure reporting, and edge cases — not new features, and not a rewrite. Written down because
the request was to prepare for a full pass, and a pass with no scope is how a review turns
into an unbounded rewrite.

---

## Why this is different from what's been verified so far

Nearly everything shipped this session was verified against its own stated behaviour —
`npm run check`, the build, the unit suite, targeted Playwright specs, deploy status. That
confirms the code does what it was written to do. It does not confirm what happens when a
relay lies, a config file is malformed, storage is full, two taps race each other, or a clock
is wrong. That's a different, narrower question, and this project already has one place where
it's asked rigorously — `packages/core/test/escalation.test.ts`'s seven numbered failure
modes, "the interface" per `build-order.md`. The rest of the system doesn't have an equivalent
discipline yet. This pass is finding out where.

## Scope — the actual subsystems

| Area | What's there |
|---|---|
| `packages/core` | Attestation, keys, NIP-44 sealing, event kinds, board, directory, transport (`sendSignal`/`sendDistress`), merkle tree, escalation state machine |
| `packages/watchtower` | Daemon (watch state machine, board, query, authorization), CLI client, escalation executor, pager, accountability log |
| `packages/seeder` | Directory scraping, dedup, merge, normalise — an offline batch tool, not on the live critical path |
| `web/terminal/*` | 18 screens, storage tiers (accruing/wipeable), offline behaviour |
| `web/` root console + `(site)` | Search, geolocation, budget-constrained, read-mostly |

Ranked by stakes, not alphabetically — a bug in the escalation ladder costs someone their
`Distress` going unanswered; a bug in the root console's search costs an annoying result.

## What "robustness, error reporting/handling, and edge cases" means, concretely

Six questions, asked of each area rather than in the abstract:

1. **Does a failure get reported, or does it get swallowed?** A `catch` block that logs and
   continues is invisible to the operator who needed to know. This project's own worst failure
   mode is a confident wrong answer — silent catch is that failure's quieter sibling.
2. **What happens at the network boundary?** Relay timeout, relay returning malformed events,
   a partial publish (some relays accept, some reject), a relay that goes dark mid-session.
3. **What happens at the storage boundary?** Quota exceeded, a corrupted or missing key in a
   tier, a value that doesn't match its expected shape (schema drift between versions).
4. **What happens under concurrency?** Rapid double-taps on one-shot actions, a held-button
   interrupted mid-hold, two tabs or two devices racing the same state.
5. **What happens at the input boundary?** Malformed TOML config, a directory record with an
   unexpected field, anything from a relay treated as untrusted until parsed and validated.
6. **What happens at the numeric/temporal edge?** Empty board, an oversized board, zero
   on-call, a timestamp in the future, clock skew between node and client.

## Method

**Verify, don't speculate.** A finding is a cited file and line plus either a failing test
that demonstrates it or a traced code path showing the gap — not "this looks like it might."
That's the standard `verification.md` already holds this project to, applied to a new axis.

**Every finding gets a fate**, same discipline as `declined.md`: fixed now (cheap, safe,
unambiguous), deferred (real, named, sequenced — goes to `build-order.md`), or declined (real
but not worth the cost — goes to `declined.md`). Nothing here should turn into an obligation
list that only grows.

**Order follows stakes.** Escalation and the accountability log first — the one place a gap
is not an inconvenience. Then crypto/transport, since everything else assumes message
integrity. Then the daemon's board and directory logic. Then the terminal's storage and UI
error surfacing. Root console and the seeder last — read-mostly and offline-batch,
respectively, neither on a path where a gap reaches someone in the cold.

## Status

| | Area | State |
|---|---|---|
| 1 | Escalation ladder + accountability log | **in progress** |
| 2 | Crypto + transport (`packages/core/crypto`, `transport.ts`) | queued |
| 3 | Daemon board + directory/corrections | queued |
| 4 | Terminal storage tiers + UI error surfacing | queued |
| 5 | Root console + seeder | queued |
