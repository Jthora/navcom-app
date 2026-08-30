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
| 1 | Escalation ladder + accountability log | **done — 6 real gaps found, all fixed**, including the named follow-up (log-review now merges the executor's own log) |
| 2 | Crypto + transport (`packages/core/crypto`, `transport.ts`) | **done — 3 minor gaps found, 2 fixed, 1 declined** |
| 3 | Daemon board + directory/corrections | **done — 7 real gaps found and fixed** (2 additional items checked and confirmed low-risk, not counted as findings) |
| 4 | Terminal storage tiers + UI error surfacing | **done — 7 real gaps found and fixed, 1 already-acknowledged pattern re-confirmed** |
| 5 | Root console + seeder | **done — 4 real gaps found and fixed, all low severity as expected of the lowest-stakes area** |

**The pass is complete.** All five areas audited, triaged, and verified. Totals below.

### 5 — what was found, and what happened to each finding

The lowest-stakes area by design, and it came back that way: no serious findings, mostly
confirmed-solid (per-source fetch isolation in the seeder, `merge.ts`'s human-row protections,
`dedupe.ts`'s high merge bar, the root console's pole-safe `coarsen()` and non-rejecting
one-shot geolocation). Four small, genuinely latent-not-live gaps, all fixed:

- **A fourth site with the calendar-invalid-date bug area 3 fixed at three others.**
  `packages/seeder/src/record.ts`'s `--on` flag used the same shape-only regex, missed
  because the seeder package was outside area 3's scope. **Fixed** — reuses the same
  `isValidIsoDate()` — and gained its first-ever test coverage in the process (`record.ts`
  had none at all, despite its own docstring calling it "the one file in the project where a
  careless write ends with somebody standing outside a locked door").
- **`metresApart()` — duplicated in the seeder and the root console — breaks at the
  antimeridian.** A raw longitude difference computes two points 0.2° apart on opposite
  sides of ±180° as roughly the earth's circumference instead of ~22km. No current region is
  near the dateline, so this is latent, not live. **Fixed in both copies** (not consolidated
  — that non-consolidation was itself a considered decision recorded in the root console
  roadmap, for one call site's blast radius; this fix respects it).
- **The root console's region picker silently omitted every region with zero records** —
  `regionFigures()` was built only from records seen, contradicting its own "computed once...
  for whichever region resolves to" premise and CLAUDE.md's own stated value that every
  region should be reachable, seeded or not. **Fixed** — every region now gets a real entry.
- **A nameless raw record would throw and kill an entire region's build**, instead of being
  tallied and skipped like every other unusable record in the same file — a landmine, since
  the one wired source already filters this case before it arrives. **Fixed** — matches the
  function's own stated contract now.

Verified: seeder 56 tests (up from 51), web's full `verify:deploy` (465 unit tests, budget
within bounds), watchtower 221 — all clean.

## Totals across all five areas

**27 real, independently-verified findings — 6 + 3 + 7 + 7 + 4 across the five areas above.
26 fixed, 1 declined** (area 2's hybrid-keygen recompute, with reasoning recorded there).
A handful of additional items were checked and confirmed low-risk or already-correct along
the way (idempotency in area 1, cross-tab storage races and orphaned corrections in area 3,
an already-acknowledged pattern in area 4) — these aren't counted in the 27, since they were
never gaps to begin with, just questions this pass's own six dimensions asked and answered
"no."

The single most important finding: `Distress` could fail completely silently (area 4) — now
fixed and covered by a new e2e test. Every fix in this pass was verified against the real
`verify`/`verify:deploy` script for every workspace it touched, not just `vitest run`, after
that distinction itself caused a deploy failure mid-pass (the fix and the lesson are both
recorded above, area 2).

### 4 — what was found, and what happened to each finding

**The most serious finding of the whole pass.** `Distress` — the single highest-stakes action
in the app — could fail completely silently:

- **`raiseDistress()` built its context (which throws with no identity, or the ordinary Alone
  case of no watch configured) *before* its own try/catch started**, and the screen fires it
  with no `await` and no `.catch`. The throw became an unhandled rejection nothing on the
  screen ever saw — `operator.error` stayed null, the operator felt the hold complete and was
  told nothing. Direct violation of invariant 2, on the one path that skipped the `run()`
  wrapper every other operator action correctly uses. **Fixed** — `ctx()` now runs inside the
  try block, so the same catch that already handles a failed send catches this too. New e2e
  coverage: holding to send with no watch configured now shows a real error message.

Five more, all fixed:

- **The shared hold-to-fire component had no unmount cleanup at all.** A hold armed by
  `press()` is a real `setTimeout`, not tied to the component's lifetime — interrupted by
  navigation before the threshold, it still fired seconds later. Used for **panic wipe** and
  **taking over a watch**. The hand-rolled Distress hold had the same gap for its own timer
  (its `onDestroy` cancelled the animation frame but not the fire timer). **Fixed**, both.
- **A malformed recovery code reported success while silently failing.** Shape-valid (64 hex
  characters) is not the same as a usable secp256k1 scalar; the invalid case was written to
  storage and only failed later, silently, inside `loadIdentity()`'s own catch — the operator
  was told "Your callsign is back" when it wasn't. **Fixed** — the key is now proven usable
  before it's written, not after.
- **A throwing storage-error watcher defeated the one guarantee `storage.ts` exists to
  provide** — no isolation between watchers, so one bug would break every write for every
  caller. Latent (today's one subscriber is safe) but real. **Fixed.**
- **A schema-drifted `seen_roots` entry silently broke the accountability-check path** —
  the one device-side mechanism that lets an operator catch a rewritten watch history. An
  unchecked cast from storage reached a throw several calls deep; a real relay library caught
  it with a bare `console.warn`, so it never crashed, it just stopped working, forever, with
  nothing surfaced. Same class of bug area 3 fixed in the correction cache. **Fixed** —
  shape-checked on read, malformed entries dropped rather than trusted.
- **Geolocation permission-denied and no-fix/timeout were conflated into one flag** — an
  operator with a genuine weak GPS signal (the situation an outdoor operator is most likely
  to actually hit) was told to go check a permission that was never the problem. **Fixed** —
  the two are now reported separately.

One more, fixed defensively though no concrete failing browser path was found: **burn's
cache-clearing step had no guard**, so a hypothetical rejection would leave a stale
confirmation screen showing after storage was already irreversibly gone. Wrapped, silently —
this screen's whole point is to show nothing at all, on success or failure alike.

Cross-tab races on `storage.ts`'s own read-modify-write are the same already-acknowledged
low-priority class area 3 declined for the correction cache (device floor is one prepaid
phone) — re-confirmed to apply here identically, not a new finding.

Also confirmed solid: `packages/core/src/backup.ts`'s tamper resistance, `board.svelte.ts`'s
defensive typing throughout the squad-watch mode, every other operator action's `run()`
error-wrapping, and `signature.ts`'s guarding beyond the already-fixed bundle-size bug.

Verified: `svelte-check` (586 files, 0 errors), the full `verify:deploy` pipeline (462 unit
tests, budget within bounds), and the new and existing Playwright coverage for distress,
reachability, wipe, and watch handover — 77+4 passing.

### 3 — what was found, and what happened to each finding

The busiest tranche so far — six real, independently-verified gaps, all fixed. Confirmed
solid: `board.distress()` on an unknown operator, the staleness margin's exact boundary,
future-dated record/correction handling, deterministic merge tie-breaking, correction/place
flood handling, and the client storage layer's own corruption handling — all real discipline,
not just apparently working. `answerQuery` having no directory connection at all is not a
gap; it's an explicit, already-tracked stub (Milestone 8 gated on 6.9).

What wasn't clean:

- **The on-station receive path had no length cap on `area`/`callsign`**, the same class of
  bug area 1 found in `transport.ts`: the cap exists in `limits.ts` and is enforced on the
  compose side, never on receive. **Fixed** — `validateOnStationPayload` now checks both.
- **`assist.text` reached the human-read console with no `sanitizeForLog`** — a real
  log-injection hole in the one mechanism this daemon's whole no-persistence design leans
  on (a human reading stdout to verify checks 02/03/05). An embedded newline plus a forged
  `"[distress] ..."` line was indistinguishable from a real one. **Fixed.**
- **`Board.standDown()` unconditionally deleted an entry**, including one in distress — the
  one mutating path with no such guard, unlike `onStation()` and `sweep()`'s hard-expiry.
  A stood-down signal (self-sent, mis-tapped, or coerced) could erase the board's only
  visible record of a distress while the real ladder — gated separately by `distress-ack` —
  kept paging in the background. **Fixed.**
- **`routine()`/`touch()` cleared "overdue" regardless of which clock caused it** — an
  operator overdue on total duration who kept checking in had the flag cleared and
  immediately re-set by the next sweep, logging the same continuing condition as a fresh
  transition every sweep tick. **Fixed** — both now only clear overdue if the expected-
  duration clock has not also run out.
- **`expected_duration`/`routine_interval` had no upper bound**, and the board recorded the
  entry before the line that could throw on an extreme value — the same root cause as the
  original NaN bug this file was written to prevent, a different magnitude class. The
  operator was told "internal error" while actually on the board, permanently active.
  **Fixed** — a 30-day upper bound, checked before the entry is ever recorded.
- **A calendar-invalid but shape-valid date (`"2023-02-29"`, `"2024-04-31"`) silently
  rolled over to the following day** at three independent, duplicated regex sites (CSV
  parsing, corrections, places). **Fixed** — consolidated into one shared
  `isValidIsoDate()` that round-trips the parsed date, closing the bug in one place instead
  of three separately.

Also fixed, flagged in the audit as more serious than its "edge case" label suggested:
**the client-side correction cache trusted whatever `localStorage` held with no
re-validation**, unlike every other entry point. A cache entry shaped like an older schema
threw reading `.fields.flag` deep inside `mergeCorrections`, and since it's called inline in
a Svelte `{#each}`, one bad cached row could take down a whole region page's render. **Fixed**
— a malformed entry is now excluded like a correction that never existed, not thrown on.

Noted, not fixed — genuinely lower risk: no cross-tab `localStorage` sync (a repo-wide
property, and the device floor — one prepaid phone — makes multi-tab unlikely); orphaned
corrections for a renamed/removed record sit inertly in the already-bounded client cache
forever (self-limiting, not a live risk).

Verified against every workspace's real `verify`/`verify:deploy` script: `@navcom/core` 519
tests, `@navcom/watchtower` 221, `@navcom/seeder` 51, `web`'s full pipeline with 456 unit
tests — all clean.

### 2 — what was found, and what happened to each finding

Much cleaner than area 1. Confirmed solid, not just apparently working: decrypt-time
robustness against truncated/malformed/adversarial ciphertext at both the classical and
hybrid layers (fails fast, never hangs, never returns unauthenticated plaintext), one
corrupted wrap in a group envelope doesn't take down the others, degenerate secret keys
fail loudly rather than producing a valid-looking wrong key, and the PQ downgrade path is
genuinely surfaced to the operator rather than silent.

What wasn't clean:

- **`readKeyBundle`'s anti-spoofing check was a tautology at its only real call site** —
  `readKeyBundle(event, event.pubkey)` checks an event against itself, always true. Not
  currently exploitable (a relay can't forge `event.pubkey`, and the real gate was a
  separate `wanted.includes()` check one line later at the call site) but a landmine: a
  future simplification trusting the function's own docstring could have deleted that
  second check as "redundant." **Fixed** — `readKeyBundle` now takes the list of
  acceptable pubkeys directly (`expect: readonly string[]`) and does the real check
  itself, matching what its docstring already claimed it did.
- **No cap or dedup on a sealed message's holder list** — every other list-shaped input in
  `limits.ts` has one; this didn't. A duplicate holder cost nothing to an attacker but
  inflated the relay-visible wrap count a hostile relay can already use to guess squad
  size. **Fixed** — `sealToGroup` now dedupes and caps at `HOLDERS_MAX` (32, generous over
  any real squad).
- **Hybrid wrap-opening recomputes a full ML-KEM keygen and EC exchange per wrap tried**,
  unlike the classical branch, which explicitly caches both. Measured at ~168ms for a
  30-holder group. **Declined, not fixed** — squads here are a handful of phones by
  design, the holder list is locally configured rather than attacker-injected, and the new
  `HOLDERS_MAX` cap already bounds the worst case. Fixing it properly means adding an
  optional-precomputed-keypair parameter to `hybridOpen`'s public signature for a
  performance concern with no live impact — not worth the added surface on the crypto
  boundary.

Verified against real workspace `verify` scripts this time, not just `vitest run` (a
lesson from the previous commit's failed deploy): `@navcom/core` 510 tests, `@navcom/
watchtower` 212, `web`'s full `verify:deploy` including the real `tsc --noEmit`, 456 unit
tests, and the budget check, end to end.

### 1 — what was found, and what happened to each finding

Audited against real tests and traced code, not speculation — the same standard
`verification.md` already holds this project to. What came back solid: all seven numbered
failure modes (`escalation.spec.md`), the publish-failure distinction, the paging budget
under a real flood, and the Merkle/inclusion-proof code. What didn't:

- **The daemon permanently claimed every Distress was unescalated**, even after the executor
  paged someone and they acknowledged in seconds — a comment from before the ladder existed
  ("nothing is attempted and the log says exactly that") had outlived the thing it described.
  **Fixed**, and it's the one that needed a real decision rather than a patch: the executor
  now keeps its own accountability log — a separate file, separate chain, `shared/
  accountability.ts` — since it can't share the daemon's chain without either process
  depending on the other, and can't claim an outcome through a process that doesn't know it.
  **Named limitation, since closed**: an operator's `log-review` now merges in the
  executor's log too, when the daemon is configured with `escalationLogPath` — read
  directly, matching the `drillStatePath` precedent, with no IPC between the two processes.
  It renders as its own honestly-unverified section: nothing publishes that log's root
  anywhere yet, so it can never be `Checked` the way the daemon's own record can, and the
  screen says so rather than implying a transient "come back later."
- **A torn log line crashed the log's own recovery path** instead of degrading like a
  detected tamper. **Fixed** — treated exactly like a truncated tail.
- **An in-memory entry was added before its durable write was confirmed** — a disk-full
  error left memory and disk permanently diverged, misfiling a transient I/O failure as
  tampering on the next restart. **Fixed** — memory now updates only after the fsync
  succeeds.
- **The executor never checked that an incoming Distress was addressed to it** — only the
  signature was verified. **Fixed** — one addressing check, matching the "defence in depth"
  posture `transport.ts` already uses elsewhere.
- **A fast client clock silently dropped real, on-time acknowledgements** — the outbound
  relay filter was built from the client's own clock. **Fixed** — the `#e` tag already
  narrows to exactly one signal's responses, so the clock-derived filter was never
  load-bearing for correctness and could just be dropped.
- **`sendDistress`/`sendSignal` bypassed the payload size cap** that exists in `limits.ts` —
  the real send path never called the check, only the unused builder functions did.
  **Fixed** — the real path now calls it too.
- **Idempotency is per-process, not system-wide.** Not a bug: matches the current
  one-executor-per-watch design, and redundant executors are already tracked as deferred
  work in `build-order.md`. No action.

All fixes verified against real tests (`packages/core`: 506, `packages/watchtower`: 212),
the full web build, and the web unit suite (456) — nothing regressed.
