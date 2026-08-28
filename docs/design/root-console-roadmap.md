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

## Pass 4 — Real visual verification infrastructure — done

Node 22.23.2 was already installed via `nvm` on this machine the whole time — just not the
shell default (`node --version` gave 18.16.0). `nvm exec 22.23.2 npx playwright test` runs
clean, browsers were already cached. No system change, no new install, no default touched.

This immediately found a real bug static inspection never could: the white-margin fix from
Pass 1 was incomplete. `body { background: var(--t-ground) }` compiled correctly and *looked*
fixed in every grep — but `--t-ground` was declared inside `.terminal`, which is `body`'s
**descendant**, not its ancestor, so the variable was out of scope on `body` and silently
resolved to nothing. Moved the token's declaration (default and low-signature override both)
to `:root`, where both `body` and `.terminal` can actually see it. A new spec,
`e2e/root-console.spec.ts`, runs against a real `desktop` Playwright project (added to
`playwright.config.ts`, scoped to this one file — the console is the one screen meant to be
seen on a desktop monitor first, unlike everything else here) and pins this regression, the
bridge's actual side-by-side rendering, and the fusion mechanism end to end.

Real screenshots taken for the first time this session confirmed the fix and the bridge
layout visually, not just structurally — and confirmed the fusion (Pass 2) actually looks
right when a region is picked, not just that the right elements exist in the DOM.

## Pass 3 — Accessibility and resilience audit — done

A keyboard-only tab walkthrough came back clean (`input#lookup → select#region-pick → two Why
summaries → the Field Terminal link`, nothing trapped or unreachable). `aria-live="polite"`
added to the Network panel, since Pass 2 made its content change on a region pick with nothing
announcing it.

Then `@axe-core/playwright` got wired in — the **first automated accessibility pass this
codebase has ever had** — and it found real, systemic defects, not edge cases:

- **Every screen's content sat outside any landmark region.** `terminal/+layout.svelte` had no
  `<main>`, and neither did this page. Fixed at the shared layout (benefits all 20 terminal
  screens, not just this one) and here.
- **`--t-faint` failed WCAG AA everywhere it was used as actual text** — every `Slot` key,
  every `Readout` sub-line, every `Panel` label, in both signature modes. `tokens.css`'s own
  comment had called it "for labels only, never for reading," but WCAG doesn't carve out an
  exception for label text — this affected the five already-shipped panel-doctrine screens
  too, not just tonight's work. Raised via computed WCAG contrast math (not guessed) to the
  minimum that clears 4.5:1 against every background it actually sits on, in both modes,
  while keeping it the dimmest tier below `--t-muted`.
- **The signature toggle's resting `opacity: 0.75` failed contrast on its own**, independent
  of the token fix — dimming via opacity washes out effective text contrast, and the button
  would have needed ~0.94+ to clear AA, which stops being meaningfully "recessed." Removed the
  opacity; position, size and tone already carry that intent without it.
- **This page never read the signature preference at all** — a real gap, not an axe finding:
  an operator who set low signature inside `/terminal/` and later landed back on `/` silently
  lost it, because only `terminal/+layout.svelte`'s `onMount` ever applied it. Wired in here
  too, plus the same reachable-everywhere toggle button.

Full suite re-verified after each fix: 456/456 unit tests, 296/296 e2e (including the new
axe checks passing clean in both signature modes), nothing regressed by touching shared
layout/token files.

Still open: a full screen-reader-*software* pass (VoiceOver/NVDA) — Playwright's accessibility
tree and axe-core catch a great deal, but not everything a real assistive-tech session would.

## Pass 5 — Operator self-published presence

Not yet started, and not lightly scoped. `bootstrap.spec.md` carves out one adjacent thing
the Watchtower-directory refusal does *not* forbid: *"a person choosing to be findable is a
different thing... a published profile says 'I exist and you may write to me.' It does not
say where anyone is."* An operator's own opt-in `Card`/region disclosure could extend the
fusion further than Pass 2's generic explainer — genuinely showing that *someone* has
published presence near a searched region, never a Watchtower's coverage. Bigger, more
sensitive, and needs its own explicit design pass and sign-off before building — nothing here
should be read as pre-approval.

## Pass 6 — Formal build-order tracking — done

`docs/build-order.md` now carries a B1–B7 table for the console, the same shape as the site's
own A1–A6 — B1–B5 done, B6 (this pass) marked partial for the same reason it's partial here,
B7 not started. It stops being invisible to the one document whose job is tracking
trajectory.

## Pass 7 — Multi-language — done

`ConsoleRegionFigures` now carries `languages` straight from the region's own manifest, and
the focused region's "Records" slot shows it as a sub-line — "English, Spanish" rather than
raw ISO codes, via the browser's own `Intl.DisplayNames` (no lookup table to maintain, and a
code it doesn't recognise degrades honestly to the raw code rather than guessing — confirmed
live: Navajo's `nv` doesn't resolve in this engine's data and falls back exactly as designed).
