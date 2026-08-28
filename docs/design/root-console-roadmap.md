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

## Pass 3 — Accessibility and resilience audit — partly done

Done, with real Playwright rather than reasoning about it: a keyboard-only tab walkthrough
(`input#lookup → select#region-pick → two Why summaries → the Field Terminal link`, in a
clean, logical order with nothing unreachable or trapped). Also added `aria-live="polite"` to
the Network panel, since Pass 2 made its content change when a region is picked and nothing
told a screen-reader user that had happened.

Still open: a contrast check in low-signature mode specifically (default mode's contrast was
inherited from the existing terminal tokens, already measured elsewhere in this project;
low-signature's amber-on-black hasn't been checked against this specific page), and a full
screen-reader-software pass (VoiceOver/NVDA), which needs a real assistive-tech session, not
just Playwright's accessibility tree.

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
