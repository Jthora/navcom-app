# The Root Console — Roadmap

Where `navcom.app/` (`web/src/routes/+page.svelte`) came from, what shipped, and what's next.
Written down for the same reason [`build-order.md`](../build-order.md) exists: so the
trajectory survives between sessions instead of being re-derived or quietly dropped.

---

## Pass 1 — the console exists

`/` stopped being a redirect and became a real, interactive page: a search over the actual
directory (Nav), the network's real derived state (Com), one link into the full Field
Terminal. Reused the existing console — `tokens.css`/`panel.css`/`screen.css`, the
`Panel`/`Slot`/`Readout`/`Why` components — rather than a fourth visual language. Budget
measured and enforced (`web/scripts/budget.mjs`), not guessed.

Two defects found and fixed after shipping, both by describing what was actually on screen
rather than trusting that it rendered: `$lib/terminal/tokens.css` never reset `body { margin:
0 }` (a bug every `/terminal/*` screen had silently carried), and "The Watchtower" had been
used as product branding across three surfaces when the term is precise elsewhere in this
project for a specific node's keypair — never the product's own name.

## Pass 2 — the fusion made literal

Roster item 5 — *"a single instrument where the callsign/area you're about to adopt and the
place you'd actually go tonight are the same screen, same glance"* — wasn't built in Pass 1
despite being recommended. The two panels sat side by side structurally but neither reacted
to the other.

Fixed: a `focusedRegion` derived from whichever region a search result, a manual pick, or
geolocation resolves to. When set, the Network panel switches from global figures to that
region's own — records, freshest check, and how many are `confirmedByPerson` (reusing
`isSeeded()` from `@navcom/core`, matching `BROADCAST.measure`'s own published definition
rather than a new metric) — plus a "help verify this" prompt reusing the exact copy already
on the public record page, and a generic, hypothetical explainer of what holding watch would
mean, using only vocabulary already in `docs/watch/the-watch.md`.

**The one hazard, and how it was avoided.** This project hard-refuses any directory or map
tying a Watchtower to a region — `docs/spec/bootstrap.spec.md`: *"a list of Watchtowers is a
list of where operators are."* Confirmed in code: no field anywhere relates the two. So the
watch-explainer Slot never claims coverage, presence, or absence of a real Watchtower for the
focused region — it explains the mechanic in the abstract and says plainly that nothing here
discovers one. If a future pass touches this Slot, that boundary is the one thing not to move.

Also fixed in passing: `corrections.svelte.ts` has always accepted a correction with no
callsign (`verified_by: 'anonymous'`, no gate, no relay required) — `docs/product/directory-
schema.md` names anonymous contribution as a first-class, designed-in choice. The UI copy on
three pages said "goes out under your callsign" as though that were required. Corrected to
say what's actually true either way.

## Pass 3 — Accessibility and resilience audit

Not yet started. Needed: contrast check in both signature modes (default and low-signature),
a keyboard-only walkthrough of search → result → correction flow, a screen-reader pass on the
Network panel's region-reactive Slots — content that changes after typing needs an `aria-
live` decision, not silence.

## Pass 4 — Real visual verification infrastructure

Not yet started. Every check across Pass 1 and Pass 2 was structural — grep the built HTML,
because this machine's Node 18.16.0 is below Playwright's minimum (20+) and no headless-
browser screenshot was possible. That's a real gap in confidence, not a cosmetic one: a
layout can be structurally correct and still look wrong, and nothing this session could catch
that class of bug. Fixing the Node version (or finding another screenshot path) is
infrastructure that pays for every future pass, not just this one.

## Pass 5 — Operator self-published presence

Not yet started, and not lightly scoped. `bootstrap.spec.md` carves out one adjacent thing
the Watchtower-directory refusal does *not* forbid: *"a person choosing to be findable is a
different thing... a published profile says 'I exist and you may write to me.' It does not
say where anyone is."* An operator's own opt-in `Card`/region disclosure could extend the
fusion further than Pass 2's generic explainer — genuinely showing that *someone* has
published presence near a searched region, never a Watchtower's coverage. Bigger, more
sensitive, and needs its own explicit design pass and sign-off before building — nothing here
should be read as pre-approval.

## Pass 6 — Formal build-order tracking

Not yet started. The console exists entirely outside `build-order.md`'s tracked "A" track —
it was reactive work in response to a live complaint, not planned work. Once Pass 3–4 land,
it should get a real entry there, the same way A1–A6 do, so it stops being invisible to the
one document whose job is tracking trajectory.

## Pass 7 — Multi-language

Not yet started. `Region.languages` already exists (`packages/core/src/directory/region.ts`)
and the console doesn't use it at all. A low-friction locale hint on search or results is a
plausible, low-risk extension once the higher-priority passes above are done.
