# Build Order

What comes after what, and what must be true first. **Sequence, not permission** — the
scope rule in [`../CLAUDE.md`](../CLAUDE.md) still holds, and nothing below is licence to
start something early.

This page exists so the trajectory survives between sessions instead of being re-derived
or quietly redirected.

---

## The gate model

Two tracks run in parallel, and only one of them is gated.

```
  THE BOX                                    NAVCOM.APP
  ───────                                    ──────────
  Session 1: watch state machine             Static site
  + CLI client, 7 checks                     directory · docs · status
         │                                          │
         │ gate: all 7 pass                         │ ungated — no protocol,
         ▼                                          │ no keys, no relay,
  Shared core extracted                             │ no daemon
         │                                          │
         ▼                                          │
  Field Terminal  ◄─────────── served from ─────────┘
         │
         ▼
  Console (served from the box, not the web)
         │
         ▼
  Escalation ladder — 7 failure tests written first
```

## Now

**On the box.** Session 1 is **done — all seven definition-of-done checks pass** (confirmed
2026-08-18). The gate below is open.

**Here.** The `navcom.app` static site. It has **no dependency on the loop** — no protocol,
no keys, no relay, no daemon — which is what makes it the correct parallel work rather
than a distraction from the build order.

| | Step | Status |
|---|---|---|
| A1 | Scaffold — SvelteKit, static adapter, in `web/` | **done** |
| A2 | Directory core — staleness, confidence, parsing. Pure logic, 30 tests | **done** |
| A3 | Directory UI — all six display rules. Rule 4 is a stated gap | **done** |
| A4 | Docs surface — renders the repo markdown at build time | **done** |
| A5 | Status page — says *"escalation not built, no drills run"* until it isn't | **done** |
| A6 | Deploy — Vercel, static, at `navcom.app` | **done** |

`npm run verify` in `web/` runs type-check, data check, build, tests and budget together.
`npm run check:data` alone answers "is my CSV edit valid" in about a second.

**Measured:** 37 pages, worst page 8.0 kB gzipped, **zero JavaScript delivered** — every
page works with scripting disabled. Budget is enforced by `web/scripts/budget.mjs`, which
measures what a browser downloads for a page rather than what sits in `build/`; those
differ sharply here, because the client build still emits chunks no page ever loads.

**Verified, not assumed.** `npm run verify` runs type-check, build, 45 tests and the
budget. The display rules have regression tests asserted against the **built HTML**, not
only against the logic — a component edited to "simplify" the stale case would otherwise
pass every unit test while shipping the failure the schema exists to prevent. Contrast is
measured against WCAG AA in both themes rather than claimed. The pages have been rendered
and looked at, at desktop and at a true 390px viewport.

**Known and deliberate:** display rule 4 (one-tap flagging) is not met on a static site and
the page says so. The status page's component list is hand-maintained and will drift from
this file. The markdown pipeline is unsanitised, which is safe only because the input is
this repository.

**Live at [navcom.app](https://navcom.app).** Vercel, static output, no serverless
functions — the deploy runs `npm run verify`, so a build that breaks a display rule or the
bundle budget cannot ship. Web Analytics and Speed Insights stay off: both inject a script,
which would break the zero-JavaScript property and H8.

**Data is partitioned by region** — `data/regions/<slug>/` with a manifest carrying country,
IANA timezone, languages and whether anyone has checked it. Done while there was one region,
because it is cheap now and painful once several people are editing one file.

**What is left before this is a real directory:** data. Everything else works.

## One repository

`packages/core` · `packages/watchtower` · `web`. One install, one wire format, one CI run.

The daemon lived in its own repository and built against the self-contained session-one
brief rather than the spec — a summary of a spec is a fork of it. Six divergences resulted:
the state enum, on-call, `last_drill`, provenance, distress position, and a missing callsign
the board needed. **Every one of them became a type error the moment they shared a
package.**

The daemon also found things this side had wrong: a replaceable `10910` outliving its
publisher and reading as a live watch, and the callsign gap. Its runtime validation was
promoted into core, because a client parsing a response needs the same guarantees the
daemon needed.

**One transport, not two.** The CLI had its own send-and-wait and the terminal was about to
grow a second. Two implementations of one wire behaviour agree right up until one of them is
fixed — and the fix that mattered was `Distress` retrying indefinitely, which only one had.
`packages/watchtower/src/client/signal.ts` is now a re-export, and the review findings that
shaped it moved into core **with their tests**: publish-failure reporting, response signature
verification, and not leaving a timer armed when `subscribeMany` throws synchronously. The
CLI's `distress` retries until a human answers and stops only on Ctrl-C.

**A stale `packages/core/dist` produced three phantom type errors** in consumers before it
was made structural rather than remembered: `web` and `packages/watchtower` now rebuild core
in a `pre`-hook before check, build and test. A build step you have to remember is a build
step that gets skipped at the worst time.

## Unblocked — session 1 passed

**Extract the shared core** — **done.** `packages/core` holds the attestation model, keys,
NIP-44 sealing, the four event kinds, the board and the directory library. 88 tests. `web/`
is its first consumer via `file:../packages/core`; the node is the second.

Two rules are now enforced in code rather than only written down: a watch state demotes
`automated-oncall` to `automated` when nobody is pageable or no drill has passed, and hard
expiry can never drop a `distress` entry.

**Field Terminal — connected.** Identity is generated on the device and never leaves it,
the Watchtower pubkey and relays are entered by hand from a person, and Status subscribes to
`10910` and renders what is actually true.

**Verified against real relays rather than argued about.** With the daemon running, a
terminal reads `automated`. With the daemon *killed* and the relay still faithfully serving
its last message, the same terminal renders **Dark** — the replaceable-event corpse, caught
live. A relay answering "nothing here" is read through `oneose`, so absence is a signal
rather than a timeout guess.

**Device storage is tiered** — accruing and wipeable, two keys rather than one, so panic
wipe cannot take the wrong half by accident. Its limits are written where an operator can
read them: a browser has no keystore, and `removeItem` unlinks rather than scrubs.

**Field Terminal — Status screen: done.** Lives at `/terminal/`, same domain and one build,
but in its own route group so it inherits none of the site's chrome, stylesheet or
assumptions. It renders Dark before anything is configured, which is the correct answer
rather than a placeholder, and states the consequence rather than the label.

**Authorship is explicit in the wire format.** `oncall` is a list of authored declarations
rather than a count the node picks; `last_drill` carries an author and an acknowledgements
array; a `20912` names its responder as an author; accountability entries are hash-chained.
None of it requires counter-signing to ship, and all of it makes counter-signing additive
rather than a payload break across three clients and a node.

**Two budgets, and the split is enforced.** The public site delivers **zero** JavaScript
against a budget of zero — it fails on the first byte, because a document must stay readable
with scripting off. The terminal is an application and gets 140 kB; the loop screens bring
its worst page to 84.7 kB.

**Field Terminal — the loop runs through the phone.** Sign on, check in, Query, Assist,
Stand down and Distress are wired to the transport in `packages/core`, so the CLI and the
terminal send the same bytes through the same code rather than two implementations that
agree until they don't.

Three things came out of building the screens rather than reading the spec:

- **`Distress` now ends only on a human.** The retry loop stopped on any acknowledgement,
  including an agent's — which satisfied neither invariant 2 nor invariant 5 while looking,
  on screen, exactly like help arriving. An agent answering is reported as *still looking
  for a human* and the loop continues. A response with **no** `responder.kind` is treated as
  not-human, because guessing is the one wrong guess this loop must never make
- **`assist` carries a required `urgency`.** "I need someone" and "I need someone now" ask
  for different responses, and a watch cannot tell them apart from an absent field. `text`
  stays optional — requiring a reason delays the send at the moment sending matters
- **Every attempt is on screen, including ones that never left the phone.** An operator who
  knows nothing is getting through can act on that; one who believes help is coming when it
  isn't has been misled at the worst possible moment

Sign-on records what the watch said it could do **at the moment of signing on**. It is the
operator's own note, not the node's, and the screen says so — the node-signed version is the
capability receipt, and it lands when the daemon issues one.

**Invariant 7 is reachable.** `panicWipe()` and `burn()` had been written and tested since
the storage tiers landed, and no screen could call either — the one operator action that has
to work in five seconds under duress had no button. `/terminal/wipe/` gives them opposite
shapes on purpose: panic wipe is a hold, because it costs an evening and speed wins; burn
asks the operator to type their callsign, because it costs everything they have built. The
typed gate lives in `storage.ts`, not the template, so a second screen cannot forget it.

The screen says where a wipe **stops**, which is the part worth saying: the watch still holds
your board entry, the accountability log is on the node and is not yours to delete, and a
browser has neither a keystore nor a secure erase. After a wipe it shows nothing at all —
a terminal reporting "4 items destroyed" tells whoever is holding the phone that there was
something to destroy.

**Cached directory — done, and the Field Terminal's screens are complete.** `/terminal/directory/`
is the Dark fallback: something to browse when there is nobody to ask.

**No search box, and a test asserts there is none.** `Query` goes to the watch — someone
with both hands free does the lookup, can ask a follow-up, and can be wrong out loud.
Searching a list one-handed in the cold is the problem the watch exists to solve, so search
here would quietly undo the design.

Three decisions worth recording:

- **Prerendered into the page, not fetched as data.** Caching the page caches the records,
  so there is no second request to fail exactly when it matters — and the records land in
  the built artifact, where the six display-rule tests already scan every `[data-record]`
- **The groups start open**, which is fewer taps in the field and, less obviously, the
  reason the rules are checked at all: a collapsed-by-default accordion would have shipped
  this screen with the records absent from the built HTML and the rules unverified
- **The record rendering is the site's own components, unchanged.** They are the only
  tested implementation of the display rules; a second one styled for the terminal would be
  an untested copy guarding the field where a wrong answer does the most harm. The site's
  tokens are aliased inside `.terminal` instead

**Staleness recomputes on hydration.** A prerendered page freezes confidence into HTML —
that is what the daily rebuild and the staleness margin are for — but the terminal is a
running application and does better: a page cached three weeks ago does not still claim
three-week-old confidence. It also states **how old the copy itself is**, which is the
second age nothing on a record would ever mention.

**Two things this turned up.** Rule 2's regression test compared a suppressed value against
every rendered value *on the page*, which broke the moment many records shared one: a record
with a suppressed `hours` of `unknown` also renders `sex_offender_ok` as the value
`unknown`, a legitimate enum member of a different field. Scoped to the record and field it
concerns. And `burn()` claimed "everything on this device" while leaving the service worker
cache — which now holds the directory. It clears the caches, and the screen awaits it. UI built
against an unproven payload gets rewritten when the payload changes, which is the whole
reason for the gate.

## The accountability log — sprint A done, B/C/D planned

**A — the log is real on the node.** `packages/watchtower/src/daemon/accountability.ts`:
append-only JSONL, fsynced per entry, chain verified at boot, 90-day retention. Actions are
written at one site derived from the response actually sent, rather than a call per dispatch
branch — one branch away from silence is not a property this file can have.

**Two entries record what the watch did not do.** `contact-not-attempted` on every overdue,
because the spec says the node MUST attempt contact and nothing does; `escalation-not-
attempted` on every `Distress`, because the ladder is unbuilt. Neither is
`*-reached-nobody`, which would claim an attempt. They should read badly until they stop
being true.

**Found while planning it: `entriesAbout()` and `verifyChain()` could not compose.** Every
chain link points at the entry before it in the *full* log, which is usually about somebody
else — so a per-operator view can never verify, and an operator is exactly the party who
cannot be handed the whole log. Both functions existed, read as though they worked together,
and returned `intact: false` every time. `CompleteLog` is now a distinct type and the
composition is a **type error**.

That moves the honest claim: chaining closes tampering **for a whole-log reader only**. The
spec's two-row table is now three rows, and the middle one — selective disclosure — is the
load-bearing one.

**Also found: neither package type-checked its own tests.** `fakeConfig` was returning a
`DaemonConfig` missing a required field and nothing complained, which is how a suite drifts
away from the types it exists to exercise. Both now check `src` and `test`.

**B — selective disclosure — done.** RFC 6962 Merkle tree in `packages/core/src/merkle.ts`,
root published as `log_root` on `10910` rather than as a new kind. An operator verifies
their own entries against a root they saw published, holding `log₂(n)` sibling hashes and
nothing about anybody else.

Two properties the obvious implementation lacks, both tested: **domain separation**, without
which an internal node can be passed off as a leaf and membership forged for data never in
the log; and **no duplicated odd leaf**, without which different logs collide on one root.
The suite is weighted towards forgeries — swapped content under a valid proof, a proof from
another tree, a truncated path — because "a valid proof verifies" proves nothing about
whether an invalid one is rejected.

**The client keeps the roots it has seen**, in the accruing tier, surviving a panic wipe. A
replaceable `10910` means a relay serves only the newest root, so without this the watch is
the sole custodian of the evidence against itself. `diverged` — two roots at the same tree
size — is the finding it exists to produce, and it renders **above** the watch state,
because it changes what everything below it means.

**C — retrieval — done.** `log-review` as a sixth `20910` signal type, answered with
`review: { root, entries[{entry, proof}], more }`. `20912` is ephemeral, so the log never
becomes relay-queryable and C27 holds. The request carries **no subject field**, which is
the access control rather than a check that could be forgotten: the node answers about
whoever signed it. Capped at 50, newest first — a response too large for a relay is silence,
and silence is never an answer.

**D — the review screen — done.** `/terminal/log/`.

The hard part was not rendering entries. A response carries entries, proofs **and** the root
they are against, all three from the watch — so verifying them against each other always
succeeds. `checkReview` accepts only a root the device saw published itself, and the screen
says *"marking its own homework"* for the other case rather than showing a tick.

**The limit is stated before the record is fetched, not after.** An operator who has just
read a screen of green ticks is the least likely person to go looking for what the ticks do
not cover — and what they do not cover is omission, which no proof closes.

## Gated on opening past people you personally vetted

**Counter-signed capability.** On-call operators declare their own reachability, drills
carry acknowledgement signatures from whoever woke up, and log entries are counter-signed by
their subjects. The slots exist and are empty; this fills them.

The gate is honest rather than arbitrary. While the circle is people you trust directly, the
node's own account of itself is adequate. The moment the pubkey goes wider, a Watchtower
that vouches for itself is exactly the claim a compromised one has most reason to make.

**Redundant escalation executors.** More than one box able to run the ladder, made
idempotent by distress event id. Duplicate pages are a nuisance; a single executor dying
mid-`Distress` is not. Paging is already specified as parallel rather than serial for the
same reason — in an emergency you want everyone.

This is ranked above decentralising the board on purpose: **a watch going Dark is
survivable and specified. An escalation that never fires is not.**

## Gated on the Field Terminal

**Console.** Served from the box over LAN or localhost — see [`delivery.md`](delivery.md)
for why it cannot be served from navcom.app.

## The escalation ladder — built, unproven, and running with nobody on-call

Invariant 2 had nothing behind it until now: every `Distress` the daemon received wrote
`escalation-not-attempted` to the accountability log. It no longer does.

**The seven failure modes are tests, and they are the interface.** Six are in
`packages/core/test/escalation.test.ts`, numbered to match the spec so a later reader can
check the list is still complete rather than taking anyone's word. The seventh — *node down
at time of distress* — is the one failure the node structurally cannot report on, so it is
tested on the client instead, and its absence from that file is noted there as a decision.

**The executor gets its trigger from the relays, not from the daemon.** A design where the
daemon receives the `20911` and hands it over satisfies "separate process" on paper while
leaving a hung daemon able to take escalation down with it — the requirement failing in
exactly the way it was written to prevent. The cost is two processes holding the Watchtower
key, and it is the right trade against an escalation path that depends on the component most
likely to hang.

**No provider is embedded.** A channel names what was registered; the node runs a configured
command per on-call entry, argv rather than a shell string. Anything else puts a third party
in the one path that must not depend on anybody's uptime but the node operator's own.

**The `responder` field on a transition is load-bearing.** A client stops retrying on a
`human` responder, so a machine saying *"paging"* must not be authored as one — that would
end a `Distress` with nobody on the other side while looking like it worked. Only the
acknowledgement carries a human author, and it carries the actual human's callsign.

**What is still missing, and it is most of the value:**

- **No drills.** `last_drill` stays null, so `automated-oncall` still publishes as
  `automated`. Weekly randomised drills, published to the status page, are next
- **No roster anywhere.** A `Distress` today pages nobody, reaches the end of the ladder at
  once, and says so. That is the ladder working correctly; it is not the ladder helping, and
  the status page says exactly that
- **No node-side emergency contact.** The spec prefers device-initiated anyway, so
  `CONTACT` is currently always skipped — failure mode 5, which is tested

## What is left, in the order it should be done

Four rules govern this, and they exist because a plan fails in ways a feature list does not.

1. **Every item has a fate** — do, defer, or [decline](declined.md). A list that only ranks
   is a list nothing ever leaves
2. **Sequence comes from [`principles.md`](principles.md)**, not from whoever is writing
3. **Every item names an owner** — agent, human, or either. An item with no owner is an item
   nobody does
4. **Every item names what *not* doing it costs.** If that cost cannot be stated, the item
   should be declined rather than deferred

No dates. A volunteer network's capacity is not knowable in advance.

### The thing this ordering is built around

**Most of the remaining safety work is blocked on people, not code.** On-call needs a
person. Intake rules need somebody with local knowledge. Playbooks need a human,
permanently.

So the code that comes first is the code that makes the human work possible or worth doing —
not more machinery around a knowledge layer that is still empty. Twelve invented directory
records means the one part of NavCom that works with no watch, no signal and no peers is the
one part that is useless.

Milestones rather than a ranked list, because each has a state you can be in or not.

---

> **Doing any of these?** [`human-tasks.md`](human-tasks.md) has step-by-step instructions
> for all five, with the real commands, ordered by value per minute rather than by number.

## Milestone 0 — Prove what is already built

**Done when:** every claim below has been true on real hardware at least once.

This one is new, and it comes first because of what a single afternoon of checking turned
up. Two shipped features contradicted their own purpose — peer presence required a
Watchtower despite existing for operators without one, and the patrol record was not cached
offline despite saying it works with no signal. Neither failed a test. Both were found by
reading.

**Nothing here has ever been used.** Not one patrol, not one night. Everything is built for
people who do not exist yet, and the ratio of building to verifying has been wrong for a
while.

| | Item | Owner | Why it is worth an hour |
|---|---|---|---|
| 0.1 | **Carry it for one night** | **human** | Three hours in the field finds more than three days of reading. The text will be too long, a flow will have a step too many, and something will be in the wrong place |
| 0.2 | **Two devices, one relay** | either | Peer presence passes unit tests and has never crossed a relay. If the wrapping is wrong, it is wrong for everybody |
| 0.3 | **Daemon and executor together** | **human — the Jetson** | Both subscribe to `20911`. I have reasoned that the two response streams do not confuse a client, and reasoning is not the same as watching it |
| 0.4 | ~~Airplane mode, cold start~~ | **done — automated** | Playwright drives it: every screen loads with the network off, an area survives a reload, and a patrol can be recorded and read back. It found a real bug — tapping through to an area never cached the document, so *"opening an area is what saves it"* was false for the only path anybody takes |

**Prefer a finding here to a feature anywhere below.** A gap found on real hardware is worth
more than a screen built against an imagined one.

## Milestone 1 — One operator, alone, tonight

**Done when:** somebody patrolling alone in one metro can look up a real shelter with no
signal, and has a record of their own night.

**Everything here is built except the intake rules**, which are human work and always were.

| | Item | Owner | Cost of not doing it |
|---|---|---|---|
| 1.1 | ~~The scraper~~ | **done** | 479 records across 67 metros. Public half only, and it taught that a source which cannot distinguish what matters must not be used for that category |
| 1.2 | **Intake rules for places you know** | **human, local** | The half no scraper produces, and the half the directory exists for. Ten records done properly beats a thousand skeletons |
| 1.3 | ~~Your own patrol record~~ | **done** | Local by default and by design — nothing in it reaches a watch, a relay or a peer. Export carries no coordinates and nobody but the operator |
| 1.4 | ~~Coming home~~ | **done** | Confirmed by name where somebody was watching, and confirmed anyway where nobody was |

Nothing here needs a watch, a box, a peer or a network.

## Milestone 2 — One watch, actually staffed

**Done when:** a `Distress` raises a real human, and `last_drill` is a pass rather than null.

| | Item | Owner | Cost |
|---|---|---|---|
| 2.1 | **One human on-call with a proven channel** | **human — you** | The ladder pages nobody and everything under it is theatre. One config entry and `navcom-escalation --check` |
| 2.2 | ~~Drills~~ | **done** | Randomised weekly, `--drill` fires one now. **Fails every time until 2.1**, which is the finding rather than a gap |
| 2.3 | ~~Web push as a paging channel~~ | **done** | `/terminal/on-call/` and `navcom-push`. The payload is **encrypted to keys only that browser holds**, so the push service relays a blob it cannot read — unlike a topic, where the text crosses somebody's server in the clear. **Delivery is untested end to end** until a real phone receives one |
| 2.4 | ~~Keyless pagers~~ | **done** | `navcom-pager`. **No key anywhere in the file or the config** — not an optional field, not a commented-out one. Run several, anywhere, by anyone: whoever runs one is trusted with nothing because they learn nothing |
| 2.5 | **A way for a paged human to say *"I have this"* from their phone** | agent | Found by audit [`audit-tests.md` 2.S]. `distress-ack` is a defined signal, the spec budgets it at *"10s. One tap, and somebody is waiting on it"*, the executor accepts it, and 2.X made the roster able to identify who sent it — **and no client sends one.** A squad member holding the watch answers from the board, which works; a node's on-call operator has only the console. The hard part is not the control, it is that the ack must name a `distress_id` the paged person's device cannot know: they do not hold the watch key, so they cannot read the `20911`, and the push deliberately carries no payload from the wire. Needs a decision about how an ack names its target before it needs code |

**2.1 is not code and nothing in this milestone is real without it.** Drills run and fail
weekly until somebody is on-call — which is the finding, published, rather than a gap.

## Milestone 3 — Two people who met once

**Done when:** two operators who paired over coffee can see each other patrol, with no watch,
no box and no leader.

**All items built.** Milestone 3 now also covers two operators who have *never* met: a card
makes somebody findable in their metro, and an invite pairs them at a distance. What remains
is 0.2 — two real devices on one relay — which is a human check, not code.

| | Item | Owner | Cost |
|---|---|---|---|
| 3.1 | ~~Peer pairing and presence~~ | **done** | Wrapped in throwaway keys so no relay can see who talks to whom |
| 3.1a | ~~QR pairing~~ | **done** | `@paulmillr/qr` for the code — same author as the curve and hash libraries already here. **No decoder shipped**: the browser's own `BarcodeDetector` where it exists, and the paste field where it does not |
| 3.2 | ~~Findable profiles and invites~~ | **done** | Cards are signed by a **contact key**, never the operational one — publishing costs no operational exposure. An accept is an invite in the other direction, so declining is silence and there is no decline message to write |
| 3.3 | ~~Public presence~~ — a name, never a pin | **done** | Empty content, region tag, contact key. Shipped as `off · listed` rather than the specified four values — see [`product/visibility.md`](product/visibility.md) |
| 3.4 | ~~Live position sharing~~ | **done** | Watch and peers only. Rounded to a grid rather than jittered, and the type has no public setting to choose |
| 3.5 | ~~Buddy pairing between two solos~~ | **done** | `watching` is per-recipient, so nobody learns who watches whom. Nothing escalates from `overdue` |

## Milestone 4 — A squad with no box

**Done when:** four people take turns holding watch on their phones.

**All items built.** What is not built, and is now the top of Mk1: **key rotation.** Every
member holds the watch key, so removing somebody stops them *reading* new signals and does
not stop them publishing watch state — they can still claim, on the public record, to be the
watch. `bootstrap.spec.md` already recorded this; 4.1 makes it reachable, so it is stated on
the screen where somebody joins a squad-held watch.

| | Item | Owner | Cost |
|---|---|---|---|
| 4.1 | ~~Watch as a mode of the app~~ | **done** | `/terminal/watch/`. A member reads the board with their **own** key and needs the watch key only to answer — so listening is not holding, which is what makes handover cost nothing |
| 4.2 | ~~Sealing to several keys~~ | **done** | One encryption, one 32-byte wrap per holder. No pubkeys in the envelope, so a relay never sees the roster. A single-holder watch produces the same shape as a squad, so nobody can sort Watchtowers into "box" and "squad" without decrypting |
| 4.3 | ~~A declaration must not read as a safety monitor~~ | **done** | *"This app does not watch anybody. You do."* Stated above the board, because everything below it looks like a monitor and is not one |
| 4.4 | ~~Handover~~ | **done** | **Nobody hands over a board.** The incoming watch derives its own from operators re-announcing when their phones see the holder change — passing the outgoing holder's picture would make the new watch's board a thing it was told rather than derived |

## Milestone 5 — The properties we have written down

Each is self-contained and none blocks an operator. **None may be claimed publicly before it
ships** — the status page states what is built.

| | Item | Owner |
|---|---|---|
| 5.1 | ~~Post-quantum hybrid sealing~~ — ML-KEM-768 beside the classical exchange | **done** | Key distribution solved by a published `10912` bundle, so the pairing QR is unchanged. Fallback allowed and reported as a note rather than a warning. **Bundle now at 99% of budget** |
| 5.2 | **Anchor the log root to Bitcoin** — OpenTimestamps, daily | **deferred** | Blocked on a trustworthy implementation. See below |
| 5.3 | ~~Saying no to an `Assist`~~ | **done** | A `declined` response — *"nobody is coming"*. Refused for `Distress` in core, so no client can offer a button that ends one with a tap [invariant 2] |
| 5.4 | ~~Weather-activated warming and cooling centres~~ | **done** | **Display rule 7**, not a weather API. The case rules 1–2 miss: the data is fresh and the answer is still wrong. No network call, no third party, no content generated |
| 5.5 | ~~Battery state~~ | **done** | Told to the operator, published to nobody — see [`declined.md`](declined.md). Chromium-only, so absent on iOS, and absent rather than estimated |
| 5.6 | ~~Supplies~~ | **done** | A **request, not a tally**. `resupply` carries no number, so there is nothing to game and nothing to merge. The patrol record stays purely local |
| 5.7 | ~~Never write "anonymous" where "pseudonymous" is true~~ | **done** | Said on the setup screen where the key is generated, not in a policy — the trade is stated at the moment it is made |
| 5.8 | ~~Logical CSS properties~~ so right-to-left scripts are not broken | **done** | Plus `dir` on the document, without which they are inert. Guarded by a test that scans the **built** CSS, since Svelte rewrites styles and a dependency can emit physical properties nothing in `src/` contains |
| 5.9 | ~~Message catalogue~~, one locale shipped, English fallback | **deferred** | See below. It contradicted a decision already recorded in [`product/languages.md`](product/languages.md) |
| 5.10 | ~~Drop `overdue_count` from `10910`~~ — v4 | **done** | The first subtractive version bump. A v3 reader defaulted the missing field to 0 and would render "nobody overdue" for a watch that had stopped saying |

### 5.1 shipped, and the budget is now the thing to watch

Both stated blockers turned out to be wrong, and the real ones were solvable:

- **Key distribution** — solved by publishing the KEM key as a `10912` bundle instead of
  putting 1184 bytes into a pairing QR. The pairing code is byte-for-byte what it was
- **The downgrade policy** — decided, not discovered: a sender whose recipient has published
  no key still sends, and the operator is told. See `signals.spec.md` for the wording rules,
  which are as normative as the mechanism

**JavaScript is now at 139.1 kB of a 140.0 kB budget — 99%.** That is a real constraint doing
its job rather than a problem to route around, and the next addition of any size breaks it.
There is no cheap split available: the crypto sits in the shared chunk and nearly every
terminal screen seals something, so splitting does not move the *worst* page, which is what
the budget measures.

**This needs a decision before the next feature**, and the options are honest ones: re-derive
the number from what a prepaid Android 8 on a slow network can actually afford, or keep 140 kB
as a hard stop that forces something to come out before anything goes in.

### 5.2 — deferred, because an anchor nobody can verify is worse than none

The design in [`spec/watch-state.spec.md`](spec/watch-state.spec.md) is right and unchanged.
The blocker is that there is no implementation this project can honestly ship.

- The one npm package, `opentimestamps`, was last published in 2021 and depends on the
  deprecated `request`, on `bitcore-lib`, and on `fs@0.0.1-security` — a squatted placeholder.
  This project picked `@paulmillr/qr` specifically to avoid taking on a supply chain; this
  would be taking on a worse one, in the daemon that holds the accountability log
- Hand-rolling the OTS serialisation is the alternative, and it is the case the project
  already has a rule about: **a proof we generate that does not verify is worse than no
  anchor**, because the operator believes it. Building the format by hand, with no reference
  implementation to check against, is how that happens

**What unblocks it**, either one: a maintained OTS library, or a vendored minimal serialiser
with round-trip tests against fixtures generated by the reference implementation. The second
is a real afternoon's work and is the likely path — it is deferred, not declined.

Until then the log root is still published and clients still keep the roots they have seen,
which is what closes rewriting **since somebody looked**. Backdating a window nobody watched
stays open, and [`declined.md`](declined.md) already says so.

### 5.6 — how the decision went

**A request, not a tally.**

The Quartermaster wants *"to know what we handed out so I know what to restock"*, and
[`archetypes.md`](research/archetypes.md) asks for **supply signals that tolerate several
people editing offline at once and resolve without a merge UI**.

The merge problem has a clean answer: **a shared count is the wrong shape.** Each operator
records their own handouts, the total is a sum of independent records, and sums commute — so
there is no conflict and therefore no merge UI to design. Making the conflict unrepresentable
rather than resolving it is the move this project reaches for everywhere else.

**What is not clean is where the numbers go**, and there are two rules in the way:

- *"Show a count of anything"* is an anti-pattern here — **a number invites gaming**. Socks
  handed out is inventory rather than a leaderboard, but a per-operator total published to a
  squad is a leaderboard whatever it is called
- The patrol record is **local by default and by design.** Nothing in it reaches a watch, a
  relay or a peer. Aggregating across people means transmitting it, which is a change to
  that promise rather than a feature on top of it

Two versions, and they are genuinely different products:

| | |
|---|---|
| **Local only** | *"What I handed out tonight"* in the patrol record, which is already local. Useful to the operator, tells them what they need to restock, publishes nothing, invites no comparison. **Does not solve the Quartermaster's problem at all** — they still have to ask people |
| **Shared** | Handouts travel to whoever holds the storage unit. Solves the actual problem, and means the patrol record stops being purely local and a per-person number exists somewhere |

**Both were rejected, because the question was the wrong one.** The Quartermaster did not ask
what was handed out; they asked *"so I know what to restock."* That is answerable without a
tally at all.

So `resupply` is a **need, not a report**: *"I ran out of socks."* No number, so nothing to
game. Sparse, because you only say it when it is true. It travels because somebody chose to
send it rather than because the system collected it. And there is nothing to merge, so the
*"several people editing offline"* requirement dissolves rather than getting solved — which
is usually the sign a reframe is right.

Two things fall out of it:

- **The patrol record stays purely local**, untouched. Nothing about what anybody carried or
  gave away is transmitted, now or ever
- The Quartermaster's other half — how fast the shelf empties — is answered by **counting
  their own shelf**, which needs no code, no protocol and no self-reports, and is more
  accurate than self-reports because people forget

It goes to the watch rather than to a named peer, which is a change from how it was first
sketched. Routing it peer-to-peer meant a new stored kind for peer-directed notes, and that
is a general messaging surface — a chat app with one feature so far. The watch is already
whoever is holding things together tonight.

**Its own section on the watch screen, below everything anybody is waiting on.** Putting it
in the same list as *"I need someone"* would make it compete for attention with things that
matter more, which is the alarm-fatigue problem in a quieter dress.

### 5.9 was listed by mistake, and is deferred

[`languages.md`](product/languages.md) sets the order of this work, and step 2 is *"message
catalogue and one-locale bundling, **when there is a second language to hold**"*. Step 3 is
*"a second language chosen because somebody is waiting for it, **not to prove the mechanism
works**"*. Nobody is waiting for one. Building the catalogue now is the mechanism proving
itself, which is the thing that entry exists to forbid.

It would also cost something real. The [capability manifest](verification.md) checks that
claims appear in the **built HTML**, in English. Behind a catalogue, every claim becomes a
key, and the check either follows the copy into one locale — proving nothing about the
others — or it goes. That trade is worth making for a language somebody actually reads, and
not before.

What was genuinely due now was the half of it that belongs to 5.8: `lang` and `dir` on the
document. Without those, logical properties resolve to the left-hand layout regardless of
language, and the work is inert. That shipped.

### 5.10, because the condition it waited on has been met

`10910` is unencrypted, so `overdue_count` announces *that* somebody is overdue to anybody
subscribed. It never says who — but a watcher correlating timing learns something, and that
is the [Doxxer's](research/ecosystem-roster.md) method.

`watch-state.ts` has said since it was written that this should go **once a Console exists**,
because a Console reads the board directly and needs no public field. 4.1 is that Console.
Nothing consumes the field today: the daemon writes it, tests assert it, and no client
displays or reacts to it.

Left for its own change rather than folded into 4.1, because dropping a published field is a
wire-format decision — v3 to v4, the daemon, the spec and the tests — and it deserves to be
visible as one rather than a line in a watch-mode commit.

## Milestones 6–10 — what would make this a network rather than a tool

Drafted 2026-08-20. **Rewritten the same day after critique**, which found a load-bearing gap
in each of the first two milestones and one indictment of the whole thing.

**47 items became 42**, and that is a smaller reduction than it should be. Seven were cut
outright — listed at the end, under *What the rewrite removed* — and five were added
that the critique showed were simply missing: the write-back path without which Milestone 6
reaches nobody, a genesis route so the watch gate does not brick a new squad, a decision
about a wire that does not fit, a spec and a price for a thing being sold, and somebody other
than one person able to deploy.

**Where 0–5 got to:** NavCom is a very good instrument for *one operator's night*. Going out,
being watched, getting help, coming home and being counted are built to a standard worth
defending. What it is not yet is an instrument for the thing the project says it is for.

| | | Depends on |
|---|---|---|
| **6** | Knowledge gets in | — |
| **7** | Standing without permission | 6, partly |
| **8** | The directory serves whoever opens it | **6** — see below |
| **9** | Nobody is a single point of failure | — |
| **10** | Off-grid, and the hardware gets funded | — |

**6 → 7 → 8 is a chain, not three independent tracks.** 9 and 10 are independent of it and of
each other. If only one thing happens, it should be Milestone 6.

---

## Milestone 6 — Knowledge gets in

**Done when:** an operator who was on that block last night can put what they learned into
the directory from the phone in their hand, and the next operator to look sees it.

*"And the next operator sees it"* is the half the first draft missed entirely. It listed nine
ways to capture a correction and **no way for one to reach anybody**. The directory is a CSV
in git, prerendered into the site at build time; a correction from a phone is a nostr event.
All nine could have shipped and changed nothing anybody reads.

### 6.0 — The decision that shapes the rest

**Two directories, not one, and that is the answer rather than a compromise:**

- **Live corrections** travel as attestations and are **merged over the cached directory at
  read time, on the device**. No build, no deploy, no maintainer, no server. An operator sees
  their squad's corrections immediately and offline. This is the one that needs no human
- **The published directory** stays a curated artifact — stable, prerendered, the thing a
  stranger gets on `navcom.app`. Corrections are promoted into it periodically **by a person**

That split is already how everything else here works: live data expires and is derived per
device; durable data is an artifact somebody stands behind. **Build the live half first** —
it delivers the whole milestone's value without waiting on anybody.

| | Item | Owner | Cost |
|---|---|---|---|
| 6.1 | ~~Corrections merge over the cached directory at read time~~ | **done** | The spine. Cached alongside the directory, so a correction is there in the car park with no bars — live when you do not need it and gone when you do would be exactly the wrong shape |
| 6.2 | ~~Flag a record in one tap~~ | **done** | Display rule 4 is true in both halves now. One tap from the record, no form, no account |
| 6.3 | ~~Correct a field from the phone~~ | **done** | **Most corrections are a tap, not typing** — what an operator learns at a door is usually an enum, and the schema already knew that. Free text only where a door genuinely does not open on a vocabulary |
| 6.4 | ~~Corrections are additive and never delete~~ | **done** | **The abuse answer.** A hostile flag adds a claim with an author and an age and removes nothing — tested end to end, from the button to the record still being there |
| 6.5 | ~~The directory says what it does not know~~ | **done** | *"Nobody knows intake, pets. If you are there, ask."* On the record rather than in a list of its own: an errand is done while you are already there; a task list is opened on purpose, which nobody does |
| 6.6 | ~~Capture cold, correct warm~~ | **done** | A line you scribble one-handed, kept on the phone and sent nowhere. **Wipeable**, because the riskiest free text in the system is written here — in a hurry, about something that just happened, which is exactly where a line about a person gets written despite every rule |
| 6.7 | ~~Nothing about a person, guided at the point of writing~~ | **done** | Shown only where text is possible, which is the minority of fields — an enum cannot contain a sentence about somebody |
| 6.8 | **Promotion into the published directory** | **human, periodic** | Still human, and the bottleneck is still the point. `navcom-promote` now fetches, dedupes and groups what is waiting so the reading is short — **it cannot write anything**, because a tool that applied corrections would have quietly removed the person this step exists for |
| 6.9 | Intake rules from the people who know them | **human, local** | Was 1.2. It stays human; 6.1–6.7 are what make it possible from a phone rather than a text editor |

**Never:** a review queue with a decider. Corrections stack, they do not compete, and nobody
adjudicates between two operators [`declined.md`](declined.md).

---

## Milestone 7 — Standing without permission

**Done when:** an operator with no social history and no institution can become visibly
credible through contribution alone — and holding somebody else's watch means something.

### The genesis problem, and the fix

The first draft gated the watch on a `can take watch` endorsement. **That bricks a new
squad**: nobody has standing, so nobody can take watch, so Milestone 4 stops working.

**Founding is self-evident.** Whoever created a watch can always hold it — no endorsement, no
permission, nothing to bootstrap. Everybody *else* needs `can take watch` from somebody who
already holds it. The gate is real, the first holder needs nobody, and a squad grows from
one person outward.

| | Item | Owner | Cost |
|---|---|---|---|
| 7.1 | ~~Endorsements with scope tags~~ | **done** | **A credential names nobody** — *"I vouch for the holder of this"*, a scope and a date and no subject at all. So you can vouch for somebody who has never opened the app, and no map of who-knows-whom exists to breach. The cost is that it is a bearer token, and that is said in the same breath |
| 7.2 | ~~The founder of a watch can always hold it~~ | **done** | Genesis. Founding needs nobody's permission because there is nobody to ask |
| 7.3 | ~~`can take watch` gates joining somebody else's watch~~ | **done** | The spec violation is closed. Somebody handed a key needs somebody who already holds it to say so |
| 7.4 | ~~The gate says what it does not prove~~ | **done** | *"Somebody's word about how you have worked before — not a promise that you will stay awake tonight. Only you can make that one."* Named, never counted |
| 7.5 | ~~Withdrawal~~ | **done** | **The plan was wrong and the spec was right.** It proposed revocation-by-silence via expiry; [`identity.md`](product/identity.md) already specified explicit revocation published by the endorser — which creates no adjudication either, and invents no second rule for staleness. Only the original endorser can revoke, checked against the key |
| 7.6 | ~~Standing lives in the artifacts, not a profile~~ | **done** | Your callsign is on the records people rely on, named on the face of each corrected field. No page, no total, nothing to compare between two operators. **Building it found that corrections were invisible** — a merged record carries one provenance and every corrected field was being read with the base record's age, so a fresh in-person fix rendered as `call first` |
| 7.7 | ~~The trade, stated where it is made~~ | **done** | On the standing screen, in the same words the setup screen uses about the callsign |

**Never:** a score, a rank, or a comparison between two operators. Provenance by name.

**Age rather than expiry.** Nothing lapses on a timer. Somebody endorsed `medic` five years
ago is a fact about five years ago, and this system already has one way of handling that —
show the age and let the reader weigh it, exactly as the directory does. A second rule for
the same problem would be a rule too many.

**Declined, not deferred — resistance to forged endorsements.** A gate creates an incentive
to mint keys that did not exist while endorsements were decoration. We are not building
against it, for the same reason counter-signing is gated: **the circle is people vetted in
person.** When that stops being true this becomes urgent, and it is written here so that
somebody notices the day it changes.

---

## Milestone 8 — The directory serves whoever opens it

**Done when:** somebody looking for a bed tonight can use `navcom.app` themselves, in their
own language, without being an operator or installing anything.

**Gated on Milestone 6.** A person-facing path over 479 scraped skeletons is *worse* than
none: the operator who gets bad data is inconvenienced, and the person who gets it is turned
away at 11pm with nowhere else to be. The first draft listed these as independent, which was
the most dangerous mistake in it.

**8.1 is the exception and can ship today.**

| | Item | Owner | Cost |
|---|---|---|---|
| 8.1 | ~~Print it~~ | **done** | The one artifact here that **cannot be corrected after it leaves**, so the sheet carries its own age, its source, and *"call before you go"* — the instruction that survives being out of date. Forced black-on-white whatever the reader's theme: the screen adapts to the reader, paper adapts to nobody |
| 8.2 | **A path shaped for the person, not the helper** | agent | *"Somewhere tonight"*, *"somewhere with my dog"*, *"somewhere that will not ask for ID"* — every one a filter over fields the schema already has |
| 8.3 | **Lead with what gets you turned away** | agent | A real record says *"Intake closes hard at 21:00 — arriving 21:05 means turned away."* The most valuable sentence in the file, buried in `notes` |
| 8.4 | **No dead ends** | agent | An empty result says what to do instead. Never a blank list — the reader has nowhere else to go |
| 8.5 | **Language, and say which half** | agent | Unblocks 5.9: `languages.md` deferred the catalogue until *"somebody is waiting"*, and a Spanish speaker looking for a bed in St. Louis is somebody waiting. **The interface translates; the records do not.** Translated buttons over English `notes` is half a feature and the page must not imply otherwise |
| 8.6 | **Leave no trace, and say so** | agent | Already true — no account, no session, nothing stored. On a library computer or a borrowed phone that is the property that matters |
| 8.7 | Regional taxonomy that is not a US assumption | **human, local** | `warming` and `cooling` assume a temperate climate and a particular emergency response |

**Never:** anything recorded about a reader. A document cannot watch you back, which is the
whole reason the public surface ships zero JavaScript.

---

## Milestone 9 — Nobody is a single point of failure

**Done when:** the network keeps working for a month with its most active person absent.

Today: one person on call, one box, one directory maintainer, one possible log reviewer, one
deploy account. All the same person.

| | Item | Owner | Cost |
|---|---|---|---|
| 9.1 | ~~Identity recovery~~ | **done** | Operator-held backup and a printed recovery code, per [`identity.md`](product/identity.md). *"No recovery method means no recovery"* is now stated **at persona creation**, not after a phone is dropped when it is only a fact about the past. Social recovery remains unbuilt |
| 9.2 | ~~Move to a new phone~~ | **done** | The same mechanism — a backup you can restore *is* how you move. Carries the accruing tier and **not tonight**, because a backup that carried the wipeable tier would carry the thing a panic wipe destroys |
| 9.3 | ~~Tell operators what is thin — do not publish it~~ | **done** | Rides on the capability sentence, which already goes to somebody at sign-on and nowhere else. **Names the roster rather than counting it** — a number invites gaming, and the names are already on `10910` anyway. Says when the ladder is one person deep, and when no drill has ever passed. **Found: a human at the console was hiding an empty ladder** — the branch returned before it ever mentioned escalation |
| 9.4 | **Somebody else can deploy** | **human** | Named for people and infrastructure in the first draft and missed for shipping. One Vercel account is a single point of failure for the artifact everybody reads |
| 9.5 | ~~The work is paid for~~ | **done** | An address field, never zap infrastructure. **The app stores a string and shows it** — no custody, no keys, no amounts, so a seized phone yields an address rather than a financial trail. No totals anywhere, and the card's field allowlist was widened deliberately rather than casually: the guard that exists to keep a *position* off a public artifact fired, and a payment address is not one |
| 9.6 | **A restore drill** | **human** | The paging drill proves the pager works. Nothing proves a *second person* can stand a Watchtower up from the docs. **It will probably fail the first time, and that is the finding** |
| 9.7 | More than one on-call, and a way to hand it over | **human** | 2.1 gets to one; this gets past one |
| 9.8 | The log reviewer | **human** | Named in `CLAUDE.md` as a role that *"cannot be the agent or verification is theatre"* |

**Mostly not code**, which is the finding rather than an excuse.

**Deferred — RelayNode.** It was in the first draft as a way to remove strangers from the
path. It also **adds** a single point of failure to the milestone about removing them: a relay
only one person runs is worse than two public ones. Revisit when a public relay actually
fails us, or when there is a second person to run it.

---

## Milestone 10 — Off-grid, and the hardware gets funded

**Done when:** a `Distress` reaches somebody with no cell network involved.

### 10.0 — The wire does not fit, and that is measured

| | bytes | LoRa frames at ~222 B |
|---|---|---|
| `Distress`, classical, one holder | 467 | ~3 |
| `Distress`, **hybrid** | **2,644** | **~12** |
| Peer presence | 1,192 | ~6 |

The first draft said *"the link is a relay you can carry, so nothing about the protocol
changes."* **That is false and the numbers say so.** With duty-cycle limits, a hybrid
`Distress` does not fit an off-grid link in any comfortable sense.

So the first decision is not hardware:

**10.1 — Compact frame, or classical off-grid?** *(decision, gates everything below)*
A compact wire format is a protocol change and real work. Classical-only off-grid is a
**security downgrade that must be reported the way the existing fallback is** — a note, in
the operator's language, saying what the link does and does not cover. Neither is free and
one must be chosen before anything is built.

| | Item | Owner | Cost |
|---|---|---|---|
| 10.2 | **Peer presence over LoRa, before any bridge** | agent | A squad at a protest is a few hundred metres apart and already inside LoRa range. **Needs no infrastructure and no cyberdeck** — the cheapest possible test of whether any of this works |
| 10.3 | **Try Meshtastic before building hardware** | agent | An existing open LoRa mesh, phone apps, boards under $30. May remove the blocking item from the only layer that is not standing |
| 10.4 | **The link's state is visible, like the watch's** | agent | A device showing *"link up"* with a dead radio is **invariant 4 in a different costume** |
| 10.5 | **Store and forward, with honest age** | agent | A signal raised out of range arrives when range returns, and says how old it is on arrival |
| 10.6 | Scope discipline | — | `Distress` and presence only. The failure mode of carrying everything is a link carrying nothing when it matters |

### Funding the hardware — NavCom Communicators

Pre-orders are how hardware gets funded without an institution, and they are the sharpest
version of the risk this project spends most of its effort avoiding: a claim about the
future, backed by somebody else's money, with no chargeback.

**Nothing below may be built until 10.7 and 10.8 exist.** The first draft put the page above
the safeguards in the table, which implied the opposite.

| | Item | Owner | Cost |
|---|---|---|---|
| 10.7 | **What happens when it fails, written first** | **human** | Refunds, who holds the key, what a buyer does if the builder goes quiet. **Written while nobody is upset.** Not agent work and not optional |
| 10.8 | **A spec and a price** | **human** | You cannot take orders for an unspecified thing at an unknown cost. The first draft promised to publish both and had no item to decide either |
| 10.9 | **A pre-order is a commitment in both directions** | agent | The buyer commits funds; the builder commits — signed, published, dated — to the spec, a batch floor, a ship window and a refund rule. Checkable afterwards against what happened, like the capability receipt |
| 10.10 | **A batch floor, published** | agent | *"Nothing is built and no money is spent until N orders exist. If the floor is not reached by D, everything is returned."* Stated up front, not decided later |
| 10.11 | **A public address anybody can check** | agent | Escrow without an escrow agent. It proves the money is **unspent** — not that it is safe — and the page must say exactly that |
| 10.12 | **The site never says the deck exists** | agent | Where the Skeptic — *"watched three apps come and go"* — is won or lost permanently |

**Say plainly, in the buyer's language:** crypto payments cannot be reversed; a published
address proves the money is unspent, not safe; **nobody has one of these yet**; and taking
money creates obligations — tax, consumer protection, shipping across borders to allies in
the UK and Australia — that no amount of cryptography addresses.

**Never:** a countdown, a scarcity claim, a tier system, or a photograph of something that
does not exist. Every pattern that makes a crowdfunder convert is one this project already
bans on the install prompt, for the same reason.

---

## What the rewrite removed

`CLAUDE.md`: *"an obligation list that only grows is how a volunteer network drowns"*, and
*"prefer deleting a rule to adding one."* The first draft added 47 obligations to a network
with one active person and deleted nothing. **It failed the project's own test of a plan.**

Cut, and why:

| Cut | Why |
|---|---|
| Visit attestations | Folded into 6.3. A visit *is* a correction with a method of `in_person` — the schema already carries that |
| Corroboration weighting | 6.4 makes corrections additive, so a second operator agreeing already shows as two attestations. A weighting system on top would be inventing a consensus rule nobody asked for |
| `trained with me` as an event | Folded into 7.1. It is a scope tag, not a mechanism |
| Contribution credit across the knowledge layer | 7.6 covers the directory, which is where contribution actually happens. Playbooks are permanently human |
| Image-first navigation | Deferred until 8.2 exists and there is somebody to test it *with*. Designing icons at people we have not met is how a taxonomy ends up assuming exactly what it meant to avoid |
| RelayNode | Deferred — it adds a single point of failure to the milestone about removing them |
| A bespoke cyberdeck as the starting point | 10.2 and 10.3 may make it unnecessary. Build hardware last, if at all |

**One standing rule for this section, going forward: nothing joins 6–10 without something
leaving.** The bundle budget has a ratchet; the obligation list should have one too.

## Deferred, with reasons

| | Item | Why |
|---|---|---|
| — | Counter-signing | Gate holds: not needed while the circle is people vetted personally |
| — | Redundant executors on separate hardware | Blocked on hardware, not code |
| — | **Native apps, both platforms** | Deprioritised. Adds locked-screen `Distress`, silent SMS (Android), and a phone holding watch overnight (Android). None blocking, and the web app stays complete |
| — | Mecha Jono holding the board | Session 2, one function call |
| — | Propagation | Designed, not scope. Endorsements are now 7.1, funding 9.5, recovery 9.1 and RelayNode 9.2 |
| — | ~~Off-grid / LoRa bridge~~ | Now Milestone 10. Still waiting on hardware; nothing in software waits on it |
| — | Playbooks | **Human, permanently.** Not agent work, and now per locale — see [`product/languages.md`](product/languages.md) |
| — | A second interface language | Now 8.2. The deferral was right and **its condition is met**: somebody looking for a bed in their own language is somebody waiting |

### The seven ways people actually work, and who is served

| | Today | Fixed by |
|---|---|---|
| Solo on patrol | Works — callsign, directory, own person one tap away | Milestone 1 completes it |
| Team on patrol, no leader | **Served.** Pair, and each phone draws its own picture | — |
| Team on patrol with a leader | **Served** for seeing each other. No concept of a team, and no dispatch verb — deliberately | — |
| Solo on watch | Well served. This is what got built first | — |
| Team on patrol, watcher at home | **Served.** The watcher holds the board in the app; the list is flat, with no grouping | — |
| **Agent on watch** | Holds the board, answers questions, and **cannot close a `Distress`** — an agent is never the sole responder. A 24/7 agent watch is a query desk, not a safety net | Nothing fixes this, by design. Say it plainly to anyone setting one up |
| Team on watch | **Served.** Handover transfers nothing — the incoming watch derives its own board from operators re-announcing | — |

### Awaiting a decision

**Cannot be given a fate until somebody can describe it:** nothing. `presets` turned out to
be the Ghost / Team / Open visibility presets in
[`product/visibility.md`](product/visibility.md) — not a missing feature, an unbuilt one.
Deferred until Milestone 3 gives it something to configure.


## Declined, not deferred

Some real problems are not on this page at all, on purpose — see
[`declined.md`](declined.md). Everything below is **deferred**: designed, sequenced, and
waiting. The difference matters, because a page where every gap becomes future work is a
page that only grows.

## The multi-holder Watchtower — no longer deferred

**A multi-holder Watchtower** — signals sealed to a set of keys rather than one, so several
nodes hold the same board — is a real option rather than an impossibility, and the earlier
claim that "the watch cannot be decentralised" was wrong. What cannot be distributed is
*who is accountable*: one name, because diffused responsibility means nobody acts. The board,
query answering and escalation can all be held by more than one party.

It was deferred on a cost rather than a principle. Sealing to M keys means M parties hold
the operational picture, and the threat model here is doxxing — so it widens exposure while
narrowing dependence. That trade needed a reason.

**The reason arrived: a squad with no box.** Four RLSH who patrol together have nobody
willing to run a machine, and requiring one meant they could not have a watch at all. Inside
a squad the exposure is not new — all four already know who is out. That is what being a
squad means. Outside one it would be, which is why the box arrangement stays.

Everything deferred above is designed, and none of it is scope. A spec written before the
loop is proven is a guess in a more confident format — [`spec/README.md`](spec/README.md)
says so about itself.

## Open decisions

| | Blocks |
|---|---|
| Node service language for the box | Session 1 — TypeScript unless there's a reason |

## The seeding rule

Recorded here because it is the easiest way to do real harm quickly, and it governs A2–A3.

**Seed structural facts. Never seed intake rules.**

Name, address, type, phone and published hours are public and checkable, and
[`product/propagation.md`](product/propagation.md) explicitly endorses seeding them from
public sources at `method: website`, low confidence, visually distinct [C21].

`sobriety`, `pets`, `id_required`, `referral_required`, `sex_offender_ok`, `curfew` and
`belongings` are the fields the directory exists for, and they are absent from public
listings precisely because nobody maintains them. **They start `unknown` and stay `unknown`
until a human with local knowledge verifies them.** A plausible guess in those fields is
the Medic's kill trigger and the fastest way to end the project.
