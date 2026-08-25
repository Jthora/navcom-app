# Operating Brief

NavCom is **the Watchtower**: someone is on watch while operators are out. **One
application, two modes** — you take up the watch, or you go out. The same person does both
on different nights, so it is one app you learn once.

## Four layers, each optional, each useful alone

An operator who has none of the ones below still has a working tool. Nothing is withheld to
push anyone up a layer.

| | | Needs |
|---|---|---|
| **Alone** | Cached directory, your own patrol record, your own person one tap away | Nothing. Open the site |
| **Paired** | Scan a peer's code; you see each other's patrols | Two phones, no watch, no server, no leader |
| **Watched** | Someone answers questions and tells you what is happening | A person or an agent holding watch |
| **Off-grid** | The critical signals move with no cell network | Hardware. Deferred — see [`delivery.md`](docs/delivery.md) |

Two properties cut across all four, and both ship only when the code does, never before:
**post-quantum message confidentiality** (ML-KEM-768 beside the classical exchange), and an
**accountability log anchored to Bitcoin** so a watch cannot quietly rewrite a stretch of
history nobody was watching.

**The default is Alone, and it is not a degraded state.** An operator who knows nobody is
the common case, not the edge one, and the app must never present having no watch as
incomplete setup.

**Peer-to-peer here means trust, not radio.** Everything travels over ordinary relays on
ordinary internet. What makes it peer-to-peer is that nothing readable ever reaches a server
and nobody holds your board — each device draws its own picture from what it can decrypt.

It is **infrastructure for acting without authority while remaining accountable**. Everyone
here works without an institution behind them, so the only thing that can carry belief is
what they can show. That is not a security posture; it is the condition of the work.

Read [`docs/attestation.md`](docs/attestation.md) first. It is the one object this system is
built from, and most rules below are it, pointed somewhere.

Then read [`docs/research/lore.md`](docs/research/lore.md) before proposing anything.

---

## Current scope

Session 1 is **done** — all seven definition-of-done checks pass. The loop is proven: an
operator signs on, the board sees them, `Query` gets an answer.

The shared core is extracted (`packages/core`), and the Status screen ships with the
[capability receipt](docs/watch/the-watch.md) as a panel rather than a paragraph.

**The directory can now be seeded from the field.** An operator can add a place the published
directory does not have (`docs/product/directory-schema.md` §5) — the fix for a cold start
that otherwise waited on a maintainer with local knowledge nobody has. Every region is
prerendered now, including the thirty-five that ship empty, because until this they had no
page at all.

**Build next, in order:**

1. **The remaining Field Terminal screens, onto the panel.** Five of twenty are converted —
   status, watch, sign-on, standing, distress. Doctrine and phases in
   [`docs/design/panel.md`](docs/design/panel.md); **it is a per-screen judgement, not a
   sweep** — a blanket pass was tried, measured and withdrawn, because `.cost` in this
   codebase is a typographic class carrying primary state as often as an aside
2. **Milestone 8**, once **6.9** has real intake rules in it. The gate is not paperwork: a
   person-facing path over scraped skeletons turns somebody away at 11pm with nowhere else
   to be
3. **Nobody is a single point of failure** — 9.4, 9.6, 9.7, 9.8 are all people rather than
   code, and **CI has not run since 2026-08-19** (9.9)

**One decision is open:** typography for the panel (P8). System stack ships today at zero
bytes; a subset face costs 8–25 KB against a script budget at 68%.

Sequence and gates in [`docs/build-order.md`](docs/build-order.md). Surfaces and budgets in
[`docs/delivery.md`](docs/delivery.md).

`navcom.app` runs in parallel and is ungated — it is live, static, zero-JavaScript, and
seeded for the St. Louis metro.

| | Decision | Status |
|---|---|---|
| Field Terminal | PWA at `navcom.app` — try instantly, no install, fully capable | Decided |
| Native mobile | Deprioritised 2026-08-19. Adds three things: locked-screen `Distress` (both platforms — iOS 18 Controls make this possible, contrary to an earlier note), a phone holding the watch overnight (Android only), and silent SMS (Android only). None blocking | Decided, deferred |
| UI framework | Svelte | Decided |
| Watch | A mode of the same app, not a separate Console. A box may hold it all night; a squad without one holds it on a phone | Decided 2026-08-19, reversing "served from the box" |
| Relay topology | Public relays for MVP; self-hosted RelayNode at Mk1 | Decided |
| Node services | TypeScript unless there's a reason — shared payload types with the clients | Decided |

**Escalation executor is a separate process from the agent.** Non-negotiable — see
[`docs/watch/agents.md`](docs/watch/agents.md). A compromised agent must not be able to
impair escalation.

**The install prompt is where every banned pattern would re-enter.** No banners, no "get the
app," no feature withheld to pressure an install. While native is deferred there is nothing
to pitch at all, and the app says nothing. An operator on the web is a complete operator —
that was always the position, and deprioritising native returns to it rather than retreating
to it.

### Two roles the design requires a human for

- **On-call** — reachable when the board can't raise anyone. A phone that might ring, not a
  shift. Currently one person, which is a known risk
- **Log reviewer** — reads drill results and agent logs on a cadence. Minutes per week, and
  it cannot be the agent or verification is theatre

### Not agent work

Directory seed data, field playbooks, and extending the `type` taxonomy need humans with
local knowledge. **Do not generate playbook content.** The Medic's kill trigger is confident
wrong guidance, and plausible-sounding safety content is worse than none.

## Invariants

Never violated, no exceptions, no configuration:

1. **Nothing is recorded about the people being served.** No field, no convention. A rule
   about what the system *offers*; free-text notes can't be enforced, so guide rather than
   pretend
2. **`Distress` terminates in a human, or tells the operator it couldn't.** The ladder may
   fail. It may never fail silently
3. **Duress is always deliberate.** Never inferred from silence, missed windows or inactivity
4. **The watch state is visible before sign-on.** An operator must never believe a human is
   watching when none is
5. **Agents are always identified as agents**, and never the sole responder to `Distress`
6. **Nothing tasks anyone.** There is no dispatch verb. The watch tells you what is
   happening; it never assigns
7. **Panic wipe destroys the Wipeable tier and nothing else.** Burn destroys everything on
   the device. The node-side accountability log is outside both
8. **No legal names anywhere.** Contact details only where an operator opted in for themselves
9. **Volatile data shows its age.** Stale reads "call first"; blank reads "unknown"

## Anti-patterns — you will want to do these

Every one is a conventional solution that is wrong here.

| You'll want to | Don't, because |
|---|---|
| Add a feed or activity stream | Operational tools open into a situation, not a timeline |
| Add notifications | Only `Distress` paging, only to on-call operators who registered a channel. The field terminal is silent |
| Persist the board for history | The board expires. Only the accountability log survives, and it records actions, not positions |
| Let the agent judge or decide | Its authority is bounded so misbehaviour is survivable. Unverifiability is answered by limits, not better tests |
| Put a search box on the field terminal | `Query` goes to the watch. Someone with both hands free does the lookup. That *is* the product |
| Make onboarding engaging | No streaks, badges, prompts or nudges. Ever |
| Escalate on a missed check-in | Overdue nudges. Alarm fatigue destroys the one mechanism where failure means someone is hurt |
| Show a count of anything | Provenance by name. A number invites gaming |
| Build a nice map view | Device floor is a prepaid Android 8 with 400MB free |
| **Write a new rule when you find a gap** | **The rules are already one idea restated many times, and that is why they read as a compliance regime.** Check whether [`attestation.md`](docs/attestation.md) already covers it. Prefer deleting a rule to adding one |
| **Turn every gap you find into work** | A gap has three fates, not two: fixed, deferred, or **declined**. Nobody here has an institution behind them, and an obligation list that only grows is how a volunteer network drowns. Check [`declined.md`](docs/declined.md) before the build order |

## Where things live

| | |
|---|---|
| `docs/attestation.md` | **The primitive.** Read first — most rules are this, aimed somewhere |
| `docs/positioning.md` | What this is and who it's for |
| `docs/declined.md` | **Real problems we are not taking on.** Check before adding to the build order |
| `docs/verification.md` | How this project checks itself, and the layer that was missing |
| `docs/spec/` | **Normative.** Event kinds, state machines, windows |
| `docs/watch/` | The watch model, narrative |
| `docs/product/` | Identity, data tiers, visibility, directory, funding |
| `docs/research/` | Why the design is shaped this way. `lore.md` first |
| `docs/principles.md` | Design rules and conflict resolution order |
| `docs/research/constraints.md` | Index of binding constraints |

Where narrative and spec disagree, **the spec wins** — and the narrative is a bug to fix.

## Verifying work

- Invariants are written as assertions on purpose. They should have tests
- Escalation is safety-critical: test the failure paths, not the happy path
- The device floor is a real target. `npm run verify` in `web/` enforces the bundle budget
- **Prefer a test against the built artifact over a test against the logic.** Three times
  this project has shipped a rule the logic honoured and the output didn't
- **A mechanism nobody can reach is not built.** `panicWipe` had no button for weeks, and
  the position control was absent while sign-on still wrote the setting. Both passed every
  test, because nothing checked that a person could operate them — see
  [`verification.md`](docs/verification.md)
