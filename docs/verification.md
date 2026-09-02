# Verification

How this project checks itself, and the layer that was missing.

---

## The count that prompted this

Over one working session, **nine shipped things did not do what they said**, across about
twenty-five commits. Roughly one commit in three was fixing an earlier one. That is not bad
luck; it is a property of how the checking was arranged.

They sort into three kinds:

**Unreachable** — the mechanism exists and no person can invoke it. `panicWipe` and `burn`
had no button for weeks. The position control was absent from sign-on while the setting was
still being written on every sign-on. Setup demanded a Watchtower, so an operator who knew
nobody could not get in at all.

**Uncomposable** — two pieces built to work together that do not. `entriesAbout` produced
exactly the shape `verifyChain` must reject. Peer presence read its relays from the
Watchtower config, so the feature built for people *without* a watch required one. The
escalation ladder stopped on an agent's acknowledgement.

**Unmoored** — a sentence with nothing behind it. The Status screen promised a cached
directory, playbooks and a log; none existed. The status page's component list was wrong on
five of six lines. The manifest said the app was installable with an empty icons array. The
"load-bearing" daily rebuild built an artifact nothing consumed.

## What the tests actually cover

| Layer | State |
|---|---|
| Pure logic | Thorough — 201 tests in core alone |
| Rendered HTML content | Good — assertions run against the built artifact, not the source |
| **Anything a person does** | **Nothing** |

There is no layer that opens the app, operates a control, and checks what happened. A
control can be fully wired, fully typed, imported by the page, and simply not rendered — and
every test passes.

**The nine are not nine bugs. They are one missing layer, appearing nine times.**

---

## Move 1 — Browser-level tests — **done**

Playwright against the built static site, 28 tests in about fifteen seconds. This is the
missing layer, and it is the only one of these that is architectural rather than clever.

**It found a real bug on its first complete run.** Area pages are cached on request rather
than precached, and the mechanism relied on the document being fetched. SvelteKit navigates
on the client, so tapping through to an area fetches its *data* and never its HTML — the
document was never cached, and *"opening an area is what saves it"* was false for the only
path anybody actually takes. Reloading by hand cached it; nobody reloads by hand. The page
now asks the worker to save it, explicitly, once it has rendered.

It also found two failures in itself, which is worth recording because a harness that
quietly undoes the thing under test is worse than no harness. `addInitScript` runs on
**every** navigation, so seeding storage unconditionally erased a patrol between recording
it and navigating to look at it — and the failure looked exactly like the app not saving
patrols. It now seeds once and gets out of the way.

### Shape

- **Chromium only.** WebKit would be closer to the iPhone truth and doubles CI time and
  install size. Revisit if a Safari-specific failure ever appears; do not pay for it up front
- `vite preview` serving `build/`, so the tests exercise **exactly what deploys** — the same
  discipline the HTML assertions already follow
- Tests live in `web/e2e/`, away from `src/**/*.test.ts` so the two runners do not collide
- Device state is seeded with `addInitScript` writing `localStorage` before load. There is no
  server-side state to set up, which makes this much cheaper here than in most apps

### Four files, matching the three failure kinds

| File | Catches |
|---|---|
| `reachable.spec.ts` | Every control a capability claims is on its screen and operable |
| `flows.spec.ts` | Sign on → status shows on station → stand down → the patrol is recorded |
| `independence.spec.ts` | With empty storage and no Watchtower, the app works |
| `offline.spec.ts` | Service worker serves the shell and the directory with the network off |

The offline one needs care in sequencing: load the page, **wait for the service worker to
reach `activated`**, then go offline, then navigate. Going offline before activation tests
nothing and passes.

### Where it runs

**Inside `npm run verify`, not beside it.** A check that only runs in CI is a check nobody
sees fail until after they pushed. If the browser is not installed the suite fails with the
one-line command that installs it, rather than skipping quietly — a skipped test is an
unmoored claim by another route.

CI adds `npx playwright install --with-deps chromium`, roughly two minutes.

### What it also buys

**It automates half of Milestone 0.** "Airplane mode, cold start" and most of "carry it for a
night" become machine-checkable. Two devices on one relay and the daemon-plus-executor run
still need hardware — but they are two items, not four.

---

## Move 2 — A capability manifest — **done**

One small data file. Each user-facing capability declares what it claims, which screen
exposes it, and what it needs.

```ts
interface Capability {
  name: string;
  /** The route that exposes it. */
  screen: string;
  /** Sentences that must appear there — the claim and its limits, together. */
  claims: string[];
  /** A selector for the thing a person actually operates. */
  control?: string;
  /** What must exist for it to work. Empty means it works with nothing. */
  requires: ('identity' | 'watch' | 'peers' | 'network')[];
}
```

Three checks derive from it, and none is written by hand per capability:

1. **The screen is in the build.** Static, cheap, already half-implemented
2. **Every claim appears on that screen.** Static, and this is what caught the cached
   directory that did not exist
3. **`requires: []` is honoured** — two ways. The module does not import the watch or config
   modules (import-graph, already done once for the offline directory page), *and* a browser
   test with empty storage operates the control successfully

**The manifest is the data; Playwright is the engine.** Item 3 is the one that catches
peers-needing-a-watch, and it cannot be done statically.

**Proved by breaking it.** Renaming the position control's id made the suite fail with
`#share is not on terminal/sign-on/` — the exact bug that shipped, caught by the exact
mechanism built for it. A guard nobody has watched fail is a guard nobody should trust.

One consequence worth naming, because it reads as a limitation and is the opposite: **claims
are checked against prerendered HTML, so they cannot sit behind `{#if}`.** Five times this
session an important sentence hid behind a conditional a fresh visitor never reaches. Putting
the claim where the test can see it puts it where the operator can.

---

## Move 3 — A deploy stamp

The build writes `version.json` into its output: the commit it came from and when it was
built. A post-build script, taking the SHA from `VERCEL_GIT_COMMIT_SHA` where it exists and
`git rev-parse` otherwise.

Small, and it fixes two things.

**"What is live" becomes one request with a definite answer.** Right now there is no way to
ask, so the answer was inferred from whether a particular string appeared on a page — which
meant polling production repeatedly, which is what tripped Vercel's bot mitigation and made
the site serve a challenge page. The absence of this mechanism *caused* that.

**The daily rebuild becomes self-reporting.** The status page shows how old the build is. A
stamp three days stale says the scheduled rebuild is not running — which is exactly the gap
found by reading the workflow, and it would have announced itself.

---

## Move 4 — Fold the guards that Move 2 subsumes — **done**

Four hand-written tests are four versions of one idea:

- *never claims a capability that is not built*
- *keeps the relay stack off the offline directory page*
- *every terminal screen is available offline*
- *the status page does not describe shipped things as not built*

Each was written after the failure it now guards. Together they are the manifest, discovered
one incident at a time. Folding them in is a **deletion**, which the rules here prefer to an
addition.

Five folded. Two did not, and the second is the interesting one:

- *"No search box on the field terminal"* is a **prohibition**, not a claim. There is no
  capability to attach it to
- ***"Never claims a capability that is not built"* points the other way.** The manifest
  checks that a **declared** claim appears on its screen. That test checks that a claim made
  **anywhere** has a mechanism behind it — the direction that caught a Status screen
  promising a cached directory, playbooks and a log while none of the three existed.

  Folding it in on the grounds that both are "about claims" would have quietly dropped the
  guard, which is the exact failure this whole page is about. It stays, with a comment
  saying why it looks redundant and is not.

---

## A fifth thing, found by the tests themselves

Not planned. It surfaced while building Milestone 3, and it is the first failure this layer
caught in *itself* rather than in the app.

**Every browser test was racing hydration.** Each terminal screen is prerendered, so its
controls are on the glass — visible, enabled, and wired to nothing — for a moment after the
HTML loads. Playwright fills and clicks far faster than a person does, and landed in that
window. Under load it did so often enough that specs began failing at random: a peers test,
then a patrols test, each looking like a bug in a different screen and each passing when run
alone.

The fix is not a timeout. The terminal layout now sets `data-hydrated` when it mounts, and
the test helper waits for it — waiting for exactly the thing that must have happened, so it
cannot pass early on a fast machine or fail late on a slow one. The suite went from
intermittent to fifty consecutive green, and got roughly twice as fast, because tests were
previously sitting in retry loops against controls nothing was listening to.

Three things worth keeping from it:

- **A flaky test in a suite with `retries: 0` is a broken test**, and re-running until green
  is how a project learns to disbelieve its own failures
- One of the failures was real. Pairing was a `<form>` submit, and a form tapped before
  hydration does a native GET: the page reloads and the typed code is gone. It is now a
  plain button, which does nothing until it works — **inert beats destructive**, and what a
  prerendered screen does before its JavaScript arrives is a design decision
- The suite had been opening WebSockets to `relay.damus.io` on every run. It now stubs
  `WebSocket` dead. A test that can fail because a stranger rebooted a volunteer-run box is
  not a test, and the stubbed state — a pool whose socket never opens — is exactly the phone
  with no signal that most of these tests are about

A second list had also drifted: the offline spec named the terminal routes itself, under a
comment claiming it used `TERMINAL_ROUTES`. Two screens shipped without being added to it —
the precise failure `routes.ts` exists to prevent, defeated by copying it.

## Order, and why

**3 → 1 → 2 → 4.**

The stamp is small, independent, and removes the reason production was being polled. The
browser layer is the substance. The manifest needs the browser layer to check the half that
matters. The folding needs the manifest to fold into.

## What none of this covers

Said plainly, because a verification page that overstates itself would be the joke writing
itself:

- **Two devices on one relay.** ~~Peer presence has never crossed a real relay~~ — **partly
  closed.** `npm run test:relay` starts a NIP-01 relay on this machine and runs two browser
  contexts through it on real sockets: a `REQ` the client composed, `EVENT` frames it signed,
  and presence arriving at a subscription the second device opened before the first had
  anything to send. It also asserts that nothing readable about the operator is sitting in the
  relay's memory afterwards, which every other test could only assert against a stub that never
  had the chance to leak.

  **The watch reaching an overdue operator now runs there too**, and it closes a gap the
  fake socket could not have found. `ReplayingSocket` hands every delivered event to every
  open subscription — it ignores filters entirely — so `overdue.svelte.ts`'s
  `{ kinds, authors, '#p' }` could have been wrong in all three terms and every browser test
  would still have passed. The local relay matches filters properly, so arriving there means
  a real relay agreed with the `REQ` the client composed. Each of the three was broken
  deliberately and each broke the test.

  **A general lesson worth stating, because it applies to every spec in `e2e/`:** a test
  against the stub proves the app behaves when a relay behaves. It cannot prove the app asked
  the right question. Anything whose correctness lives in a *filter* rather than in a handler
  is untested until it runs here.

  What is still open is the half that needs a body: **two phones, two networks, a relay
  somebody else runs.** Public relays differ in filter handling, rate limits and retention.
  Build order `0.2` stands
- ~~**Ten of ten subscription filters.**~~ **Closed**, and the last one was not a gap in the
  tests but a defect in the client. Kept in full because the shape of it is the lesson:

  | | Filter | If it is wrong |
  |---|---|---|
  | ~~`transport.ts` `waitForResponse`~~ | `kinds`, `authors`, `#p`, `#e` | **Done.** All four terms broken one at a time, each breaking a test. `#e` is proven by an *absence* assertion — a response to a different signal must not be read as the answer to this one — and dropping the term makes that test fail, so the absence is examined rather than assumed |
  | ~~`relay.ts` watch state~~ | `kinds`, `authors`, `limit` | **Done.** `authors` broken and the test failed — a terminal reading Dark while a watch is on station is invariant 4 failing quietly |
  | ~~`board.svelte.ts`~~ | `kinds`, `#p` | **Done, and it was broken.** `subscribeMany(relays, filter, params)` takes **one** filter; the board passed two in an array behind an `as never` cast, so the array was wrapped again and the REQ went out as `["REQ", id, [f1, f2]]` — a filter that is itself an array. It has no `kinds`, no `authors` and no `#`-prefixed keys, so every check a relay makes is skipped and it **matches everything**. The board was not subscribing narrowly and wrongly, it was not filtering at all: this device asked a volunteer relay for its entire firehose, on the phone `pool.ts` opens exactly one socket to spare. Nothing downstream was fooled — `readSignal` keeps only what decrypts to this operator — so the cost was bandwidth, battery and somebody else's relay rather than a wrong board. **The withdrawn test was reporting the truth**, and binning it rather than trusting it is the only reason this was ever found |
  | ~~`standing.ts` revocations~~ | `kinds`, `authors` | **Done.** `authors` broken and the test failed. The first version of the test opened the standing screen and failed too — for a different reason, because `standing.start()` runs from `/terminal/` so a holder who never opens that screen still learns. A broken test that reads exactly like a broken filter |
  | ~~`invites.svelte.ts`~~ | `kinds`, `#p` | **Done.** `#p` broken and the test failed. The failure it guards is unobservable from either side: declining is deliberately silent, so an invite that never arrives is indistinguishable from one that was ignored |
  | ~~`pq.svelte.ts`~~ | `kinds`, `authors` | **Done.** `authors` broken and the test failed. The only one of the ten whose failure is a false *pessimism* rather than a false reassurance — which is exactly why it needed driving, since a broken filter here is indistinguishable from the honest starting state |
  | ~~`corrections.svelte.ts`~~ | `kinds`, `#d` | **Done.** The only `#d` filter in the client; broken and the test failed. Without it the whole correction loop is a no-op that looks like it is working |
  | ~~`places.svelte.ts`~~ | `kinds`, `#g` | **Done.** The only `#g` in the client; broken deliberately and the test failed |

  The local relay now **refuses a malformed filter rather than matching everything on it**.
  That guard is what would have saved the weeks: a test relay that quietly matches anything
  for a request it cannot parse turns a client bug into a passing test, which is exactly what
  happened. Matching nothing makes the test fail, which is the point of having one.

  **`waitForResponse` was done first** — the return leg of every signal including `Distress`.
  Watch state and corrections followed, chosen by consequence and because each is a distinct
  filter *shape*: `authors` narrows by who wrote a thing, `#d` by which record it concerns, and
  a relay ignoring either looks identical to one agreeing. The last three were mechanical, as
  predicted. The board was not, and the difference is the whole argument for doing this at
  all: **nine filters were verified and found correct; the tenth was verified and found
  absent.** It had passed every test it ever had, and the only thing that ever contradicted it
  was a test that refused to go green honestly
- ~~**The daemon and the executor together.**~~ **Observed, and the client was losing
  acknowledgements.** Three processes subscribe to `20911` — daemon, executor and pager — and
  the executor publishes responses tagged `["e", distressId]` for the ladder it opened.
  Ladders are keyed by event id, and a client republishes an unanswered `Distress` as a **new
  signed event with a new id**, so each retry opens its own ladder answering its own id.

  Meanwhile the client listened on `'#e': [sent.id]` for the newest signal only. `ackWindowMs`
  is 20s and somebody woken at 3am is slower than that, so the ordinary sequence was: human
  is paged about attempt 1, answers it, and by then the phone is listening for attempt 2 —
  **the answer is filtered out at the relay and the operator is told nothing.** The ladder
  keeps running and at ten minutes says *nobody is answering*, which is false. A second hole
  sat beside it: between windows the loop sleeps with no subscription open at all.

  Nothing could have caught this. The fake pool in `core.test.ts` hands every event straight
  to `onevent` and puts **no `#e` tag on its responses**, so that filter term had never been
  exercised by anything — the same shape as the relay stub that hid the board's missing
  filter. `test/distress-retry.test.ts` matches `#e` the way a relay does, and has a control
  case so a red result cannot be the harness.

  A third thing came out of it, and it was the larger defect. `LadderRegistry` keyed on the
  distress id and its own doc said the design assumed *"a client republishes the same
  event"* — which it does not: `sendDistress` signs a fresh one every attempt. So every retry
  opened a ladder and every ladder paged. At roughly forty-eight attempts an hour against a
  global budget of twenty, **one operator nobody answered spent the whole hour's paging in
  twenty-one minutes**, after which a second, unrelated emergency could wake nobody, and the
  twenty pages it did spend all went to one person about one emergency. The registry now joins
  a retry to that operator's live ladder, aliasing the retry's id so an acknowledgement naming
  it still resolves; terminal ladders do not adopt. The executor test that covered "failure
  mode 7" delivered *the same event* three times — relay redelivery, not a client retry — so
  it had never exercised this; the new one re-signs, and with the join disabled it shows two
  ladders and two pages.

  Fixed in two parts, because the first commit's account of the second hole was **wrong** and
  is corrected here. Listening for a response to *any* signal the Distress has sent fixes the
  late-answer case, and is capped at 64 ids because a relay filter is not unbounded. It does
  **not** fix the gap: `20912` is ephemeral, so relays do not store responses, and an
  acknowledgement published while nothing is subscribed is not delayed — it is gone. There is
  no store to serve it from.

  So the gap needed its own fix: one subscription open for the whole Distress, beside the
  per-attempt one. At steady state the per-attempt wait listens twenty seconds in every
  eighty, so roughly **three quarters of the time a human could answer in had no listener at
  all**, and the executor publishes its ack exactly once, on the ladder's transition. The
  persistent filter is deliberately wider and the narrowing happens in the handler against the
  ids actually outstanding — a filter cannot be widened after it is opened, and what lives in
  a handler can be tested anywhere
- **Carrying it for a night.** Nothing here finds text that is too long to read in the cold,
  a flow with a step too many, or a control in the wrong place
- ~~**iPhone.**~~ **Mostly closed, and it found something.** Chromium is not WebKit, and the
  two differ most in exactly the places this app leans on. The whole suite now runs on WebKit
  (`npm run test:webkit`): **324 pass, 12 skip, none fail.**

  **A WebKit defect was found, and Chromium cannot see it.** An earlier pass through this
  file recorded "no WebKit defect was found"; that was true of what had run, and it is no
  longer true. `body { background: var(--t-ground) }` with an unresolvable property is
  invalid at computed-value time, and an invalid background is `transparent` rather than a
  wrong colour — so the root console painted its near-white ink on the white canvas
  underneath. axe measured the masthead at **1.09**. The live public front door was
  unreadable on an iPhone, while `/terminal/` was fine on the same browser because
  `.terminal` paints its own ground. A literal fallback in the `var()` fixes it, and the
  guard now runs on every project rather than desktop-Chromium only — the falsification is
  the whole argument: without the fix, WebKit fails and Chromium passes.

  It also found that the **storage-quota shim had been silently inert on WebKit** — it
  assigned to `localStorage.setItem` on the instance, which does not stick there — so the
  platform with the tighter quota had never actually tested running out of room. Moved to
  `Storage.prototype`; both engines exercise it now.

  **Offline on WebKit is half closed.** `context.setOffline(true)` plus a navigation crashes
  the driver, so `offline.spec.ts` skips there and `offline-webkit.spec.ts` covers what can
  be covered: the worker controls the page and Cache Storage holds every terminal route with
  the network cut, checked against `caches.match` rather than a status code, because the
  worker answers an uncached path with an offline fallback that is also a 200. **WebKit's own
  navigation path into that cache stays unproven**, and nothing available here can prove it.
  Two phones on two networks — build order `0.2` — is still the honest answer for that.

  The on-call screen has no registration control in an iOS tab, correctly, because Web Push
  needs an installed PWA. That produced four red tests for an app behaving properly, which
  was the manifest failing to describe reality rather than the screen failing to meet it: it
  now declares `needsPush`, and where a browser cannot be woken the check becomes *the screen
  must say so and say what would change it*. `BarcodeDetector` is covered too, and the finding there is that the app is right: Safari does
  not ship the API, so the peers screen's "Scan their code" is simply absent on an iPhone —
  absent rather than present-and-inert, which is the standard the on-call screen meets as
  well. What needed asserting, and was asserted nowhere, is that **the other way in is not
  behind the same gate**: pairing is how the Paired layer exists at all, and a screen offering
  no route to it on iOS would take that layer from every iPhone silently. It is not, and a
  test now runs on both projects and takes a different branch on each. Putting the paste-a-code
  form behind the camera gate fails on WebKit and passes on Chromium — the same signature as
  the ground defect, and the same reason a single-engine suite could never have caught it.

## Two found while building the cold start, 2026-08-23

Both are the same shape as the nine, and neither would have failed a test, because in both
cases the code was correct and nobody could reach it.

**An empty region had no page.** `entries()` prerendered only regions that already held
records, and the directory index filtered the empty ones out — both correct decisions when
the only way to fill a region was a maintainer with a CSV, and both silently fatal the moment
an operator could add a place from the app. Thirty-five of sixty-eight regions were
unreachable, so the person with the local knowledge got a 404. *A mechanism nobody can reach
is not built* now has a fourth instance, and this one was reachable-in-principle by an
operator who typed the URL, which is what made it easy to miss.

The guard is in `e2e/adding-a-place.spec.ts`, and its **first** test is not about the form —
it is that Nashville answers at all.

**This laptop cannot run the suite.** Twenty-eight tests across twelve files fail here with
`crypto.getRandomValues must be defined`, and Playwright refuses to start; the working tree is
clean and CI pins Node 20 while this machine runs 18.16. So the failures are environmental and
long-standing, and the consequence is not:

> Four EIN submissions said every claim rested on one laptop. It is worse than that — **the
> laptop could not execute the suite either.** "1,121 tests" was a true statement about a
> machine nobody had run them on since the billing lock landed on 2026-08-19.

That is the same defect class the EIN round catalogued in all five projects — a verification
claim with no live counterparty behind it — sitting in this repository while its artifacts
described everyone else's. Running under Node 22 gives 395 unit and 269 browser tests green.

Two things follow. Clearing the CI billing lock is not bookkeeping; it is the only environment
that can currently prove anything. And `.well-known/navcom-health.json` reports
`"suites": {"ran": "unknown"}` and `"built_on": "local"` rather than omitting the question,
because a receipt that cannot express *"local, and stale"* is worth nothing.

## A third, from the CAR packer

Smaller than the other two and worth recording because of its direction. The directory packer
carries a comment explaining that `walk()` sorts because a UnixFS directory's identifier
depends on the order its entries were added — so an unsorted walk would produce a different
CID for identical bytes depending on what the filesystem returned.

A test written to *prove* that failed. `ipfs-car` sorts its own entries, so the identifier is
already stable across enumeration order, and the reason given in the comment was wrong.

**The claim was wrong in prose before it was wrong in a test**, which is the direction almost
everything in this file has come from. The test was inverted rather than deleted — it now
asserts the property that is actually true and will notice if a future encoder stops sorting —
and the comment now says why the sort stays anyway: the *file list* published beside the
identifier would otherwise reorder itself per machine.

Worth generalising: a comment explaining why something is load-bearing is a testable claim,
and this project has now been wrong about one twice in a day.

## The browser suite cannot tell a regression from a busy afternoon, 2026-08-25

Found while pushing four commits' worth of this session's work, and it earns its own entry
because the evidence is unusually clean: **the same suite, on two different trees, on the same
machine, in the same hour.**

`verify` failed with three browser-test timeouts. Every failure was a ~30-second wait, never a
wrong assertion, and a different test failed on each retry — `story-new-phone` and
`story-second-holder`, then `standing` twice, then `standing` once more at a different line. That
shape is not a regression; a regression fails the same thing every time. So the four commits were
checked out one at a time against a fresh `packages/core` build, and each built independently —
which ruled out a compile-time break but not a runtime one.

The conclusive test was to stash everything, check out `644604c` — the commit this session
started from, nothing of this session's work applied — and run the full browser suite there:

| | Failures | Passed |
|---|---|---|
| **HEAD**, four new commits | 3 | 266 |
| **644604c**, none of this session's work | **7** | 249 |

The clean tree failed *more* than the working one, on the same class of timeout, including
`standing.spec.ts` in both runs. That settles authorship — nothing in this session's work is
implicated — and it turns up the actual finding: **this suite cannot currently distinguish a
regression from a loaded machine**, and it has apparently been unable to for a while, since
`644604c` predates every commit this session made.

The consequence is sharper than it would have been a day ago. CI is declined (see 9.9) and
`verify:deploy` does not run the browser suite at all, so **nothing exercises these 269 tests
between deploys except a person choosing to run them.** The tests that flake are the ones
covering standing, credential handover and restoring a phone — not the least consequential
corner of the suite.

Not fixed here, because the fix is a real question rather than a quick patch: raise the
per-test timeout, reduce parallel workers, or accept that this machine cannot run the full suite
without contention and treat a red run as inconclusive until repeated. Recorded so the next
person who sees three red browser tests reaches for this entry before reaching for `git bisect`.

## The directory crossed its own horizon at midnight, 2026-09-02

Found by a silence guard, which is the only reason it was found at all.

`rendered.test.ts` counts what each display rule actually examined, because "a guard that
examines nothing passes". At 00:01 UTC rule 1 — *every rendered volatile value carries an
age* — reported that it had examined **nothing**. Not a regression: the newest `last_verified`
anywhere in the directory is `2026-08-19`, the volatile window is fourteen days plus a day of
margin, and at midnight **2,874 volatile fields across the built site went to "call first"
together**. Every page, every region, at once.

That is the display rules working exactly as designed. Nobody has re-checked a place in a
fortnight, and the directory says so rather than showing opening hours it cannot stand behind.

**Two things were wrong, and neither was the behaviour.**

The first is that the only warning was a red test one minute after the fact. There was nothing
at seven days out, or three, or one — and the fix takes a person ringing a shelter, which
needs notice. `community.ts` already enforces this discipline for the community links and
fails the build six months on; the directory operators actually carry had no equivalent, which
is the wrong way round. `check:data` now prints the horizon every build, per volatility class,
with the days remaining — and it says the next cliff too: **seasonal data goes dark in
fifteen days.**

The second is that the silence guard could not tell two very different things apart: *no
volatile value was rendered because none is fresh* (data, and now announced) and *no volatile
value was rendered because the renderer broke* (code, and still a failure). It now accepts
rule 1's zero only alongside proof that every volatile field **was** rendered and deliberately
suppressed. Falsified by pointing the proof at a selector nothing emits: it fails, with "that
is the renderer, not the calendar".

**The general lesson**, which applies to every counter in that file: a silence guard is worth
having and is not free. It fires on real, correct, expected states as well as on breakage, and
when it does the question is which — a guard that cannot say is one somebody will eventually
learn to ignore.

## What `npm audit` says, and what it means here, 2026-09-02

Ten advisories, three of them serious-sounding. All ten were **dev tooling** — `npm audit
--omit=dev` reported zero — and the two loudest were unreachable rather than merely unlikely:

- **CRITICAL, vitest:** arbitrary file read and execute *while the Vitest UI server is
  listening.* `@vitest/ui` is not installed and no script passes `--ui`. The component the
  advisory needs does not exist in this tree.
- **HIGH, vite:** `server.fs.deny` bypass on **Windows** alternate paths. Development is on
  darwin and deploys build on Linux.
- The three moderates all require a running **dev server**. `vite build` and `vite preview` do
  not start one, and every suite here uses `preview`.

**One of the ten was genuinely exploitable, and it was not the one marked CRITICAL.** The
esbuild advisory — *any website can send requests to the dev server and read the response* —
needed no unusual preconditions at all: anybody running `npm run dev` on this repo who then
visited a hostile page in the same browser could have had source read off their dev server.
It is fixed; esbuild is 0.25.12 under vite 6.4.3. Worth recording because the severity labels
pointed at the two that could not fire here and away from the one that could.

Checked at the artifact rather than reasoned about, which is this file's whole argument. The
library does not ship: `build/` has no server directory and no functions, `hooks.server.ts`
only rewrites the HTML shell, no `+page.server.ts` touches the `cookies` API, and there is not
one `document.cookie` in the bundle — state is `localStorage`. The **only** occurrence of the
word anywhere in the built site is this paragraph, rendered as a docs page.

Four independent reasons, each sufficient: nothing of it is deployed; the only execution is at
build time on a trusted machine rendering the project's own routes, with no request from
anyone to smuggle input through; the app never calls the API; and it sets no cookies at all.
For the advisory to matter somebody would have to add a server adapter, write user input into
a cookie name or path, and deploy it — which is a future feature needing its own review, not a
latent hole.

**What was upgraded, and why not further.** The advisories clear at `vite >= 6.4.3` and
`vitest >= 3.2.6`, which is one major each rather than the three and two that `latest` implies.
So: vite 5.4.21 → 6.4.3, vitest 2.1.9 → 3.2.7, `@sveltejs/vite-plugin-svelte` 4 → 5.1.1,
`vite-node` 2 → 3.2.4. Ten became **three, all low**. The bundle budget moved 0.1 kB and the
public site is still zero JavaScript, which was the specific risk in a vite major.

**The root `package.json` declares vite as a devDependency and builds nothing.** That is
deliberate and it is the only thing that works: `overrides` reports itself as applied
(`npm ls` prints `overridden`) and installs the old version anyway, even after regenerating
the lockfile. The override was removed once the direct dependency was shown to be what
actually hoists it — a config line that does nothing is worse than none, for the same reason a
workflow that never runs is.

**The three that remain cannot be fixed and should not be chased.** All are one advisory —
`cookie <0.7.0`, reached through `@sveltejs/kit` — and npm's proposed fix is `@sveltejs/kit@0.0.30`,
which is its solver admitting there is no 2.x that resolves it. It does not ship, the app has
no server, and it sets no cookies. **Expect `npm audit` to stay red at three low**; a red audit
somebody has already read and understood is different from one nobody has, and the difference
is written here so the next person does not start from zero.

## The part that is not architectural

Several of the nine came from editing files by string replacement against text written from
memory. **When the pattern does not match, nothing happens and nothing complains** — that is
how the position control was lost while the rest of the same change applied.

The fix is not in this repository. It is to use an edit mechanism that fails loudly on a
non-match for anything load-bearing, and to reserve scripted replacement for genuinely
mechanical bulk work.

Architecture can compensate — Move 1 would have caught it — but it should not have to.
