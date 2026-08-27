# Delivery

How NavCom reaches the people who use it. The documents around this one describe what the
system *is*; this one describes how it arrives on a device, and what that constrains.

---

## navcom.app — three surfaces

| Surface | For | Notes |
|---|---|---|
| **The Field Terminal** | Operators | Runs at the URL. Installing is optional, not an upgrade |
| **The public directory** | Anyone | No app, no account. Outreach, medics, mutual aid |
| **Docs and status page** | The Skeptic, the Journalist | The auditable surface the design promised |

The site is not a download page for the app. **The app runs there.**

## Progressive commitment, not capability tiers

An operator can try NavCom instantly by opening the URL, operate from the browser
permanently, or install it. The web surface is **complete** — nothing is withheld to
create pressure.

This serves specific people rather than being a fallback. The Skeptic won't commit
anything to his phone before inspecting it. The Ghost refuses installs on principle. The
Convert has 400MB free and one more installed app is a real cost. All three are full
operators [C1, principle 6].

**Installing and not installing run the same application.** An installed PWA and the same
site in a browser tab share one origin storage — installing adds a launcher and removes
browser chrome. It does not move keys, add features, or change what the app can see.

### What native actually adds — three things, none of them blocking

Deferred deliberately, and the list is shorter and more accurate than it used to be. This
page previously said `Distress` from a locked screen was *"categorically"* impossible on
iOS. **That has not been true since iOS 18**, which lets a third-party app put a Control on
the Lock Screen that fires an action without opening the app. Correcting it here because a
stale impossibility is how a real option gets ruled out for years without anyone rechecking.

- **`Distress` from a locked screen.** [`spec/signals.spec.md`](spec/signals.spec.md) makes
  it a MUST. Achievable natively on both platforms; not achievable in a web app on either
- **A phone holding the watch overnight.** Android only, via a foreground service. iOS will
  not run an app indefinitely in the background whatever you do — so the always-on watch
  stays the box's job, and that is the box's honest remaining pitch
- **Silent SMS fallback when Dark.** Android only. iOS never lets an app send a message
  without the person tapping send

Nothing else justifies a native build. In particular, *"it feels more like a real app"*
does not.

**What the web app already does on both platforms**, and which was underrated here: it
installs to the home screen, runs full screen, works entirely offline, and — since iOS
16.4 — **receives push notifications**. Push is a real paging channel for an on-call
operator, on an iPhone, with no app store involved.

The honest cost of staying web-only on iOS is not capability so much as **discovery**:
Android browsers offer an install prompt, and iOS has none. Somebody has to already know
about Share → Add to Home Screen. That is the strongest argument for eventual store
presence, and it is a distribution argument rather than a technical one.

### The install prompt is the hazard

A try-then-install path is precisely where banners, nudges, and withheld features re-enter
a product whose strongest rules forbid all three [C5, principle 13].

**The only permitted pitch is the true one, stated once, where it is relevant:** installing
adds lock-screen `Distress` and SMS fallback. No banner, no interstitial, no repeat, and
nothing degraded on the web to manufacture a reason.

Priced honestly at that moment, two things genuinely are better installed: the home-screen
entry can carry a discreet name and icon, and browsers may evict a non-installed site's
cached storage under pressure. On a phone with 400MB free, that second one is the
difference between the directory being there at 2am and not.

## What a box is actually for

Three jobs used to justify one. Two of them have moved:

| Job | Needs a box? |
|---|---|
| Hold the list of who is out | **No.** Peers derive their own view from presence events; the watch keeps a board only for the operators signed on to *it*, for overdue detection |
| Wake somebody up on a `Distress` | **No.** A `20911` is visible on the relays without being readable, so a **keyless pager** can do it — several, run by anyone, learning nothing |
| **Answer questions, and tell the operator what is happening** | **Yes.** Both need the key, and one needs a person |

So the box is not infrastructure somebody has to run before anyone can be watched. **It is
the support-class operator's station** — what "the guy in the chair" physically is. The
Oracle in [the roster](research/ecosystem-roster.md) has wanted exactly this from the start:
board time that counts as service, from someone who cannot be in the field.

Off-grid is where hardware earns its place again: a LoRa mesh needs a bridge, a web app
cannot talk to a radio, and a station that already exists is the natural place to put one.
Deferred until there is hardware to put it in.

## Holding watch is a mode of the app, not a second application

**Reversed on 2026-08-19.** This page previously said the Console must be served from the
box and never from `navcom.app`. The reasoning was: signals are encrypted to a key that
lives on the box and never leaves it, so a Console served from a public origin could never
decrypt anything.

That reasoning was sound and its premise was not. **It assumed there is a box.** A squad of
four RLSH has no box, no spare machine and nobody who wants to run one — and requiring one
meant those squads could not have a watch at all. Remove the box and the rule dissolves with
it: the field app already generates a private key in the browser and never transmits it, and
a watch view does exactly the same thing.

So there is **one application**, and holding watch is something you take up in it. The
person at home on the sofa with a phone is the watch that night; somebody else is the watch
tomorrow. See [`spec/bootstrap.spec.md`](spec/bootstrap.spec.md) for where the key lives in
each arrangement.

**The box does not go away — it becomes optional.** Run one and the watch is up all night.
Don't, and the watch is up while somebody is awake and holding it. Same app, same protocol,
same wire format.

### What this costs, said plainly

- **Everyone in a squad can read every signal**, on watch or off, because the payload must
  be readable by whoever picks up the watch next. Acceptable inside a squad that already
  knows who is out. Not acceptable for a wider network, and the box arrangement remains the
  answer there
- **Dark becomes the common case.** A phone-held watch is asleep most of the night. That
  puts the weight on the offline directory and on what a lone operator can do without a
  watch, which is where it belongs anyway
- **The field view must not drift into a dispatch console.** Two applications enforced that
  by accident of architecture; one application enforces it by discipline. There is still no
  verb that assigns anyone to anything

### What does not change

Nothing is served from `navcom.app` that was not already: it delivers code, never keys. An
operator's key and a phone-held Watchtower key are both made in the browser and stay there,
so there is still nothing at the hosting provider to subpoena.

## One shared core

Signal, crypto and board logic live in **one library**, with thin shells over it — web,
Android, iOS. A payload change is then one edit rather than three.

Decide and build this before the first client, not after the second. Retrofitting it means
rewriting every client that already exists.

## Static hosting has a clock problem, and it is handled explicitly

A static site computes staleness **once, at build time, and freezes it into HTML.** Left
alone, a page built today will still say a fact was checked recently long after it wasn't —
and it will keep showing a value whose window has closed. That is the confident wrong
answer [principle 9] arriving by a side door, and it is worse than usual because the page
is wrong *about its own freshness*.

Three things together make it honest:

- **Absolute dates are the primary rendering.** *"checked 14 Aug 2026"* is true whenever it
  is read. *"3 days ago"* is only true while the build is fresh, so it appears as a
  secondary hint and never alone
- **A staleness margin.** Confidence is computed against `now + STALENESS_MARGIN_DAYS`, so
  a field reads **call first** a day early rather than a day late. Erring toward call-first
  is the safe direction, and it makes a stale build fail safe instead of fail confident
- **A daily rebuild**, in `.github/workflows/web.yml`

**The scheduled rebuild is load-bearing, not housekeeping.** The margin is sized for a
daily cadence; it will not save a build that is three months old. Any deployment must run
on the schedule, not only on push.

**The Field Terminal escapes this problem, and does.** It is a running application, so it
recomputes every verdict against the operator's real clock on hydration — a cached directory
page opened three weeks later does not still claim three-week-old confidence. It also shows
how old the cached copy itself is, which is the age no record carries and no rebuild fixes.

## Deploying from a workspace

`vercel.json` at the repo root carries the build settings, so they are diffable rather than
living only in a dashboard. **Vercel's Root Directory must be the repository root, not
`web/`** — the site imports `@navcom/core`, which npm resolves through the workspace, and an
install scoped to `web/` cannot see it.

The build command is `npm run verify --workspace navcom-web`, so a deploy that breaks a
display rule or the bundle budget fails instead of shipping.

## Budgets

Budgets get numbers, and the numbers get a derivation. The old one — *"initial JS under
100KB gzipped"*, justified by a prepaid Android 8 — was never measured, disagreed with the
140KB the build actually enforced, and was measuring the wrong axis. Both are replaced.

**Measured 2026-08-20** — [`research/device-floor.md`](research/device-floor.md) has the
method and the market data:

| | |
|---|---|
| **Design point** | 0.8 Mbps, 6× CPU penalty — a congested LTE cell on a cheap phone |
| **Target** | interactive within **4 s**, cold, first load |
| **Measured cost** | ~1540 ms fixed, plus ~1050 ms per 100 kB |
| **Hard limit** | **220 kB** of JavaScript, worst terminal page, gzipped |
| **Ratchet** | **160 kB** — prints `WARN`, does not fail |

Three things that decided the shape:

- **Bandwidth dominates, not the device.** Doubling the CPU penalty costs 250 ms; halving
  bandwidth costs seconds. The device floor is still real — it is about **storage**, and it
  is why this is a PWA with nothing to install — but it never governed bundle size
- **The cost is paid once.** A repeat visit is ~300 ms on any network and identical offline.
  This number governs a first install, not a night on patrol
- **A budget at 99% forces a crisis rather than a decision**, which is how the last raise
  happened silently. The ratchet fires with room left to think

The root console (`navcom.app/`) carries a third, deliberately much smaller budget: **60 kB**
JS / **120 kB** page total, gzipped, measured at 49.7/66.8 kB the day it shipped. It is a
sibling of the terminal, not nested under it, so it never inherits the identity/storage/relay
stack that gives every terminal screen its floor — and its budget is sized for what it
actually is: a real search over the directory plus the network's own derived state, not the
full application.

The public site's budget is unchanged and is not a size: **zero JavaScript**, failing on the
first byte.
- **The public directory prerenders and works with JavaScript disabled.** Not purity: it is
  the fastest option on a slow phone, the most auditable one for the Skeptic, and the most
  reliable on one bar of signal for the Outpost
- No third-party scripts, no analytics, no fonts from a CDN. Every network call must be
  explainable to someone pointing a proxy at it [H8]

## What the site must never become

A public web presence grows these by default. None of them ship:

- **A directory of Watchtowers.** [`spec/bootstrap.spec.md`](spec/bootstrap.spec.md) is
  explicit — *"a list of Watchtowers is a list of where operators are."* Any "find your
  local watch" feature is forbidden
- **A credential delivery service.** Endorsements are passed operator to operator; the
  system never holds or delivers them [`product/identity.md`](product/identity.md)
- Accounts, signup, waitlists, contact capture
- Analytics, engagement telemetry, or behavioural tracking [H8]

## Known gap: flagging on the public site

Display rule 4 in [`product/directory-schema.md`](product/directory-schema.md) says anyone
can flag a wrong entry in one tap. A static site with no backend has nowhere to put that
write, and every workaround is worse than the gap — `mailto:` leaks an address, a form
service adds a third-party dependency, a code-host issue needs an account.

**Resolution: the public directory is read-only, and flagging lives in the app**, where
corrections already queue offline [C17]. The site says so plainly rather than implying the
rule is met.
