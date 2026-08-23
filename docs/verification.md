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

  What is still open is the half that needs a body: **two phones, two networks, a relay
  somebody else runs.** Public relays differ in filter handling, rate limits and retention.
  Build order `0.2` stands
- **The daemon and the executor together.** Both subscribe to `20911`; that they do not
  confuse a client is reasoned, not observed
- **Carrying it for a night.** Nothing here finds text that is too long to read in the cold,
  a flow with a step too many, or a control in the wrong place
- **iPhone.** Chromium is not WebKit, and the two differ most in exactly the places this app
  leans on — service workers, storage eviction, and `BarcodeDetector`

## The part that is not architectural

Several of the nine came from editing files by string replacement against text written from
memory. **When the pattern does not match, nothing happens and nothing complains** — that is
how the position control was lost while the rest of the same change applied.

The fix is not in this repository. It is to use an edit mechanism that fails loudly on a
non-match for anything load-bearing, and to reserve scripted replacement for genuinely
mechanical bulk work.

Architecture can compensate — Move 1 would have caught it — but it should not have to.
