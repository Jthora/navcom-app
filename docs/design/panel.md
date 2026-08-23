# The Panel

How the field terminal and the watch stop being documents and become an instrument.

This is normative for interface work. It does not add a milestone — it is **how build items 2
and 3 in [`../CLAUDE.md`](../CLAUDE.md) get done**, which are the Field Terminal status screen
and the screens after it. Sequence and gates are at the bottom.

---

## The diagnosis, measured

Taken in Chromium at 390×727 against the built artifact, not the source:

| Screen | Words | Of which prose | Longest paragraph | Screens tall | Controls |
|---|---|---|---|---|---|
| Watch | 302 | **291 · 96%** | 57 words | 1.9 | 4 |
| Status | 150 | 121 · 81% | 39 words | 1.4 | **15** |
| Distress | 62 | **56 · 90%** | 32 words | 1.1 | 3 |

Source is worse, because most of it is behind state: `terminal/+page.svelte` carries **1,003
words across 39 paragraphs and 15 sections**, and `watch/+page.svelte` carries 968 across 35.

**Distress is 90% prose.** That is the screen a person opens when they are in trouble.

### Why it happened, and why it is not a paint problem

`terminal/screen.css` is 66 lines and styles exactly this: `header`, `h1`, `h2`, `section`,
`section p`, `form`, `label`, `select`, `textarea`, `.note`, `.cost`, `.error`.

**It is a document stylesheet.** It offers paragraph furniture and nothing else — no slot, no
readout, no state chip, no panel. So every screen writes paragraphs, because paragraphs are
what the design system knows how to make. There are **two shared components in the entire
application** (`FieldRow`, `RecordSummary`) against 20 terminal routes and 435 lines of
per-page CSS.

The DOM is a document. That is why it reads as a website regardless of what colour it is
painted, and it is why this cannot be fixed by theming.

### The honesty argument, which is the real one

An unread caveat is not a caveat. A 21-word disclosure at 2am on the fiftieth night is
skipped, so **the prose that exists to keep this system honest is what prevents it from being
honest.** Discipline and honesty are the same fix here, not a trade against each other.

---

## The register: bridge watch, not chain of command

[`research/lore.md`](../research/lore.md) refuses rank, clearance levels and command hierarchy
outright — *watch is a post, not a rank*. So the reference cannot be an army.

It is a ship's bridge, which [`positioning.md`](../positioning.md) already says: *"On a ship's
bridge, Navigation and Communications are separate stations. NavCom fuses them into one post."*
Bridge watch discipline is terse, procedural, acknowledged, and **requires no rank to stand
competently**. That is the only register this project's ethics permit, and it happens to be
the one that produces the feel we want.

A bridge at night is quiet, dim and unremarkable, right up until it is not. **Discipline is
what makes the quiet legible.**

---

## Doctrine

Nine rules. Normative.

1. **Nomenclature, not narration.** Every state gets a name, not a description. The panel says
   `DARK`. It does not say "no watch is on station right now, and Distress will page nobody."
2. **Five words for state.** Any readout fits in five words or fewer in a fixed slot. If it
   will not fit, it is not a state — it is an explanation, and explanations live one layer down.
3. **Readout and reason.** Two layers, permanently. The readout is terse and always visible;
   the reason is the existing prose, **kept word for word**, one tap away, marked `WHY`.
   Rule 3 is not optional. If `WHY` is ever cut for space, the doctrine has become the thing
   it was built to prevent.
4. **Fixed slots.** The same fact in the same place on every screen, every time. Nothing
   reflows, nothing reorders, nothing appears only sometimes — an absent value shows its slot
   with `—` in it. Spatial memory is the entire performance gain.
5. **One lit action.** Fifteen controls of equal weight is a menu. A panel has one action lit
   and the rest recessed to a rail.
6. **Silence is a readout.** An empty board reads `NO CONTACT` — a positive statement that
   nothing has been heard, which differs from nothing being wrong and differs again from the
   app being broken.
7. **The alarm channel is sealed.** One colour, one weight, one motion, reserved for
   `DISTRESS` and for a watch state that is lying about itself. **Overdue is amber and rises;
   it never alarms.**
8. **Data type, not prose type.** Condensed for labels, mono with tabular numerals for
   anything compared or counted down, a text face only inside `WHY`.
9. **Nothing decorative survives.** If a rule, graduation, glow or movement does not encode a
   real quantity, it is deleted. This is the directory's own rule pointed at the interface.

### The motion test

**If the static version is equally true, the motion is decoration.**

The clean case is a countdown: a window with forty seconds left is stale the instant it is
painted, so the moving render is the honest one and the number is the lie. Everything that
moves must name what the static version gets wrong.

---

## The layer that does not exist

This is the whole engineering content of the redesign. Screens are not rewritten one by one —
**the missing component layer is built, and then screens are converted onto it.**

### Tokens (`lib/terminal/tokens.css`, extend)

Already good: `--t-ground: #0B0E12`, `--t-raised`, `--t-sunk`, and semantic state colours
`--t-station`, `--t-oncall`, `--t-auto`, `--t-dark`.

| Change | Why |
|---|---|
| Retire `--t-ink: #F2F5F8` as the default | Near-white is what low signature exists to remove. Warm bone default, white only in document mode |
| Add `--t-alarm`, reserved | Rule 7 needs a colour nothing else may use. `--t-dark` currently doubles as a state colour and a warning |
| Add `--sig-*` overrides | The low-signature set, applied at the `.terminal` root |
| Add `--f-cond` | Condensed labels. See the typography decision below |

### Components (`lib/components/`, new)

| Component | Does |
|---|---|
| `Panel.svelte` | The shell: header strip, slot region, one lit action. Rules 4 and 5 |
| `Slot.svelte` | One `KEY / VALUE` pair, fixed width, `—` when absent |
| `Readout.svelte` | The value: state name, tone, optional sub-line. Rules 1, 2, 8 |
| `Why.svelte` | The disclosure. **Takes the existing prose as a slot and changes none of it** |
| `Action.svelte` | The single lit control, plus `hold` variant for thresholds |
| `Window.svelte` | Depleting bar seeded from a real `RESPONSE_WINDOW` |
| `Elapsed.svelte` | Climbing bar with no end mark. Distress only |
| `Heartbeat.svelte` | The one pulse for *unresolved and still retrying* |
| `Board.svelte` | The floor: rows by time, transform-only reorder |

### Stylesheet (`lib/terminal/panel.css`, new; `screen.css` shrinks)

`screen.css` keeps form controls and typography. Everything document-shaped
(`section p`, `.cost`, `.note`) is deprecated as new-screen vocabulary and removed per screen
as each is converted.

### Typography decision — **needs a human**

Rule 8 wants a condensed face for labels and tabular numerals for data. The terminal currently
ships **no webfont at all** (system stack), and the worst page is at **66% of the 220 KB
script budget** with a 260 KB page total.

Three options, and this is a decision rather than a recommendation:

- **System stack only.** Zero bytes. `font-variant-numeric: tabular-nums` works in system
  fonts; a true condensed does not. Labels get letter-spacing instead of condensation
- **One variable font, subset.** ~18–25 KB woff2 for Latin, self-hosted. Buys real condensed
  labels and instrument character. It is a first webfont on a surface that has none
- **Condensed only, subset to uppercase + digits.** ~8–12 KB. Labels and readouts only; body
  and `WHY` stay system

Default if nobody decides: **system stack**, because the budget is a real target and the
doctrine survives without a webfont.

---

## The migration mechanism

Converting prose to readouts risks losing facts. The safety net already exists and it was
measured: **9 test files assert on prose the redesign rewrites** — `page nobody`,
`still works offline`, `ladder ends there`, `nobody is on call`, `call first`,
`listing below is unchanged`, `goes out under your callsign`, and others.

So the migration procedure is:

1. Convert a screen onto the components
2. Run the suite. **Every red test names a fact that must survive**
3. Make it green by putting that fact in the readout or in `WHY` — never by editing the
   assertion to match the new copy
4. Only when a fact is genuinely obsolete does an assertion change, and that gets its own
   commit with the reason

**A test edited to match new copy is the redesign losing information silently.** That is the
one failure mode this plan can produce that would be worse than shipping nothing, and rule 3
plus this procedure are what prevent it.

---

## Phases and gates

Each phase is shippable. Nothing here is a big-bang rewrite, and at every point the terminal
works.

### P0 — The layer · *gate for everything else*

Tokens extended, `panel.css` written, the nine components built with their own tests.

**Gate:** `Panel`, `Slot`, `Readout` and `Why` exist and are used by at least one real screen.
A component nobody uses is not built — see [`verification.md`](../verification.md).

> **The gate lapsed in P1, and was not noticed until P3.** Converting the status screen, I
> hand-rolled `<section class="nc-panel">` instead of using `Panel`, because the screen needed
> `data-*` markers the component did not forward. `Panel` then sat in the tree, imported by
> nothing, while the build order recorded its gate as met.
>
> It is the exact failure this gate exists to catch, and passing a gate once does not keep it
> passed. `Panel` now spreads `...rest` so a screen can mark it, and renders its label as an
> `<h2>` — a screen made entirely of panels with no headings is one a screen reader cannot
> navigate. Both status and watch use it.

### P1 — The shell · STATION + NIGHTHAND

`terminal/+layout.svelte` gains the fixed panel header. `/terminal/` becomes the three-post
panel: **Alone, Out, On Watch** — same geometry, same slot order, one lit action, values and
lit control changing per post.

The hard part is *Alone*: fully lit, fully capable, watch line as a fact rather than an error.
The default is Alone and it is not a degraded state.

**Gate:** status renders in all three posts with no `<p>` outside a `Why`, and the 15 controls
are down to one lit plus a rail.

> **Done.** Posts are **No callsign · Ready · Out**. Holding the watch is not a post here
> because this screen does not know about the watch key — it is the watch screen's state, and
> inventing it would be worse than naming what exists. Measured at 390×727: zero `<p>` outside
> a `Why` in every post, **21–33 words** read without opening anything, and the per-page
> stylesheet down from 38 rules to 3.
>
> **`Why` gained an `open` prop, and that is a correction to this doctrine rather than an
> exception to it.** Rule 3 puts the reason one layer down; it does not say the reason may be
> hidden when the reason *is* the message. An operator with no watch must be told plainly that
> this is a normal way to work — the story test calls it *"the sentence this project cares most
> about getting right for her"* — and a tap is enough to lose it for exactly the person who
> needed it. The same holds for being shown Dark without being told why, a failure this project
> has already fixed once. Terse is the default; it is not the rule when brevity costs somebody
> the point.

### P2 — WHY everywhere · **withdrawn, and here is why**

The plan was to move every prose block on every terminal screen inside a `Why`, verbatim, as a
purely mechanical phase. **It was attempted, measured, and abandoned on evidence.**

The transform ran across 18 screens and produced **96 disclosures**, keyed on `.cost` and
`.note` — the classes that look like explanatory asides. Then the suite ran: **31 browser tests
went red, every one of them asserting that a now-hidden sentence must be visible.**

The reason is in one line of `screen.css`:

```css
.terminal .cost { color: var(--t-faint); font-size: .93rem; }
```

**`.cost` is a typographic class, not a semantic one.** It means *muted, slightly smaller*, and
this codebase uses it for genuine asides, for primary state (`<p class="cost"
data-never-backed-up>` — "You have not made one on this phone"), for unsent-and-retrying errors,
and for instructions. Nothing distinguishes them in the markup, so nothing mechanical can
separate what may be hidden from what may not.

That is not a flaw in the screens. It follows from the house style this project is built on —
*the claim and its limit in one breath* — which puts the load-bearing sentence and the aside in
the same paragraph class on purpose.

**A separate pass before the readouts also found six disclosures that had swallowed an
instruction**, including the Distress screen's *"You have to press send — a web app cannot do
that for you."* Behind a tap, that one lets an operator believe help was summoned when it was
not.

#### What replaces it

Prose relocation is **not a phase**. It is a per-screen judgement, made in P3 alongside the
readouts, with three outcomes per sentence:

| The sentence is | Where it goes |
|---|---|
| **State** — what is true right now | A readout, in a slot |
| **An instruction**, or a thing that will not happen unless you act | Visible prose, unwrapped |
| **A genuine aside** — the reason behind a state | `Why`, closed |

And the rule the six near-misses produced, which is P1's lesson generalised:

> **Prose that tells the operator to do something, or that a thing they expect to happen will
> not happen, stays visible.** Terse is the default. It is not the rule when brevity costs
> somebody the point.

The transform itself is kept — it is useful for finding candidates — but it proposes rather
than decides.

### P3 — The readouts

Convert status, watch, distress, sign-on, standing. The rewrites are drafted:
`WATCH — DARK`, `DISTRESS — NO ADDRESSEE`, `BOARD — NO CONTACT`,
`STAND DOWN — NOT SENT / STILL ADVERTISED`, `GATE — NOT VOUCHED`.

**Gate:** re-measure. Target is **under 40 words and one screen tall** for status and distress,
with every removed word present in a `Why`.

### P4 — Motion that carries state

`Window`, `Elapsed`, `Heartbeat`, `Board` reorder.

`Elapsed` is the safety-critical one: **`distress: null` in `RESPONSE_WINDOW` means Distress
has no window**, so it must never get a depleting bar. A bar that empties implies the signal
resolves itself, and a Distress that appears to resolve itself is the silent failure
invariant 2 forbids. It climbs, with no end mark.

**Gate:** `prefers-reduced-motion` has a real static equivalent for every moving readout,
tested — not "animations off".

### P5 — Low signature

No white anywhere, minimum viable luminance, amber-dominant, with document mode one tap away.
Brightness is a tactical property: every operator using this is outdoors at night and none of
them have a control for it.

**Gate:** contrast checked for low vision in both modes; document mode reachable from every
screen; the choice persists in the accruing tier.

### P6 — The moments

`Handover` (read-back arms the threshold), `Inked` (coming home and being counted, as a
logbook line sealed into the existing hash chain), `Present` (the credential screen laid out
for the *other person* to read at arm's length), `Ladder` (escalation walking its real
`paging → contact → exhausted` states, including failing out loud).

**Gate:** no ceremony outside taking the watch and standing down. A `Distress` control is never
gated behind a sequence, not for one second.

### P7 — Haptic

Three patterns: sent, acknowledged, distress armed. There is currently not one `vibrate` call
in the codebase.

**Gate:** fires only in direct response to a tap the operator made. Never on arrival of
anything, or it has become a notification.

---

## Budgets, enforceable

| Rule | Enforcement |
|---|---|
| `transform` and `opacity` only | Lintable. Nothing animates `width`, `top` or `height` — this is what holds 60fps on the floor device |
| No JS timers for continuous motion | Countdowns and pulses are CSS keyframes seeded once from a real timestamp |
| `prefers-reduced-motion` is a branch | Every moving readout has a static equivalent carrying the same fact |
| Nothing animates on arrival | An operational tool opens into a situation. Motion always means something changed |
| Motion budget under 3 KB | All CSS. None of it spends from the 220 KB script budget |
| The alarm channel stays sealed | One colour, one motion, `DISTRESS` and a lying watch state only |

---

## Refused

Everything already in [`../CLAUDE.md`](../CLAUDE.md)'s anti-patterns, plus, specific to this
work: boot sequences, radar sweeps, holographic chrome, rank and clearance, counts and totals,
notification badges, decorative telemetry, easing flourishes on navigation, skeleton shimmer,
and **motion on directory values** — a field that animates draws the eye to whichever record
changed last, when the eye should go to whichever record is freshest. That is decoration
working against the display rules.

---

## Risks

- **Terse becomes curt-and-wrong.** `CALL FIRST` without its reason is a shorter way to be
  unhelpful. Rule 3 is the mitigation and it is not negotiable
- **Jargon without a legend.** A controlled vocabulary must be taught once, in one place an
  operator can read on a bus — not discovered through tooltips. A term nobody was taught is
  jargon, and jargon is authority without accountability
- **Terseness eating provenance.** *"Wren, in person · 3 days ago"* is not fluff to compress
  into a freshness dot. A recognised name is the thing a number can never be
- **Friction creep.** Ceremony belongs to two acts. Every additional one is a tax on somebody
  standing in the cold

## Decisions needed from a human

1. **Typography** — system stack, one subset variable font, or condensed-only. Default is
   system stack
2. **Low signature default** — on by default for everyone, or opt-in? Argument for default-on
   is that the audience is definitionally outdoors at night; argument against is that first
   contact happens on a couch
3. **Legend placement** — one screen that teaches the vocabulary, and where it lives without
   becoming onboarding, which is banned
