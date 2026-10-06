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
prerendered now, including any that ship empty, because until this they had no
page at all.

**The about page now points at the community's own hubs** — and, where one has been shut down
or taken over, at the Internet Archive's copy rather than the live domain. The list is typed
data (`web/src/lib/community.ts`) with a **six-month staleness rule the build enforces**, not
prose: `therlsh.forumotion.com` already redirects to a squatter and `superheroesanonymous.org`
resolves nowhere, and a page about link rot that rots is worse than none. Doctrine in
[`docs/product/community-continuity.md`](docs/product/community-continuity.md).

**Build next, in order:**

1. **Nothing, until somebody carries it for a night.** The region-detail screen's prose was
   the standing #1; it is **closed on inspection** (2026-09-02). All seventeen blocks were read
   against [`panel.md`](docs/design/panel.md)'s three outcomes and **fifteen are already where
   they belong** — the two that could move are per-record state already rendering as readouts,
   and pushing them through the screen-level component would put header chrome on 254 records
   in Philadelphia. The finding is the ratio: a screen that reads as unconverted because it
   contains prose may be a screen whose prose is load-bearing
2. **Milestone 8**, once **6.9** has real intake rules in it. The gate is not paperwork: a
   person-facing path over scraped skeletons turns somebody away at 11pm with nowhere else
   to be
3. **Nobody is a single point of failure** — 9.4, 9.6, 9.7, 9.8 are all people rather than
   code. CI itself is closed rather than open: declined on 2026-08-24 rather than left as a
   permanently-broken dependency (9.9)
4. **Raw Intel** — the one component the Earth Intelligence Network is specified around and
   nobody builds. Starcom *refines* raw intel; the phrase appears twice in the docs tree and
   both times as its input. Design is complete and normative in
   [`raw-intel.md`](docs/product/raw-intel.md): observation kind `1911`, an anchor rule that
   makes invariant 1 structural, and a closed vocabulary whose only job is that no descriptor
   and no encampment location has anywhere to go. **Gated on the tag vocabulary**, which needs
   local knowledge and is explicitly not agent work — though the schema, anchor enforcement,
   publication split and expiry can all be built against a placeholder first. Crew federation
   (C37) is reversed and sits behind it

**P8 is closed: the system stack stays, and no webfont ships.** It was never a budget
question — 8–25 KB fits inside the terminal's headroom. It is that **a webfont which has not
loaded yet is text that is not there**, and the budget script models a cold first load on a
congested cell at ~3.1s to interactive. `font-display: swap` turns that into a flash of
fallback and then a reflow, and a reflow while somebody is reaching for `Distress` moves the
layout under their thumb at the worst available moment. The service worker would cache it
after the first visit, and the first visit is exactly the case the device floor exists to
protect. The usual counter — glyph legibility in codes — does not apply: everything
key-shaped here is hex, so there is no capital `O` to confuse with `0`.

Sequence and gates in [`docs/build-order.md`](docs/build-order.md). Surfaces and budgets in
[`docs/delivery.md`](docs/delivery.md).

`navcom.app` runs in parallel and is ungated — it is live and seeded nationally — 9,635 records across 1,912 regions, 1 of them still empty.
The root itself is a small, real console (Nav + Com, fused, 60 kB of its own script budget and currently at 53.5)
that searches the directory instantly and shows the network's actual state, with one link
into the full Field Terminal; `directory/`, `docs/`, `status/` and `about/` remain static and
zero-JavaScript.

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

**Revised 2026-10-05.** Missions are now the point of this application, and *nothing tasks anyone*
was holding it back from being one. The reasoning, the research behind it and what each of these
protects is in [`docs/design/missions.md`](docs/design/missions.md) §7. Four anti-patterns were
withdrawn with it — see the table below.

**The first seven protect somebody who never agreed to be here. They are not open.**

1. **Nothing is recorded about the people being served.** No field, no convention, and **no
   mission may be settled by evidence about a person.** They cannot consent and cannot leave,
   which is why this one does not move
2. **`Distress` terminates in a human, or tells the operator it couldn't.** The ladder may
   fail. It may never fail silently. **Nothing in the mission system may borrow this channel**
3. **Duress is always deliberate.** Never inferred from silence, missed windows or inactivity
4. **Agents are always identified as agents**, and never the sole responder to `Distress`.
   More necessary now, not less: agents post missions
5. **Panic wipe destroys the Wipeable tier and nothing else.** Burn destroys everything on
   the device. The node-side accountability log is outside both. Claims, drafts and mission
   history are Wipeable
6. **No legal names anywhere.** Contact details only where an operator opted in for themselves.
   Standing accrues to a persona
7. **Volatile data shows its age.** Stale reads "call first"; blank reads "unknown". An expired
   mission says so

**Changed:**

8. **Nothing tasks anyone *without their asking*.** A mission is an offer. Taking one is the
   operator's own act, abandoning it costs nothing, and **no mission may be assigned to a named
   person who did not claim it**. There is still no dispatch verb
9. **A state is visible before somebody commits to it.** The watch state before sign-on, as
   before — and a mission shows whether anybody is actually behind it before you take it

## Anti-patterns — you will want to do these

Every one is a conventional solution that is wrong here.

| You'll want to | Don't, because |
|---|---|
| ~~Add a feed or activity stream~~ | **Withdrawn 2026-10-05.** The landing page opens into a populated panel, and that is the point |
| Add notifications that demand attention | Still true where it matters: `Distress` paging goes only to on-call operators who registered a channel, and **nothing marks an operator late or absent** |
| Persist the board for history | The board expires. Only the accountability log survives, and it records actions, not positions |
| Let the agent judge or decide | Its authority is bounded so misbehaviour is survivable. Unverifiability is answered by limits, not better tests |
| Put a search box on the field terminal that **asks somebody** | `Query` goes to the watch. Someone with both hands free does the lookup. That *is* the product. **Narrowing a list already on the phone is a different act** and is allowed — it asks nobody, works offline, and the root console has had one since it shipped. The line is whether a person is on the other end of it, not whether there is a text input |
| ~~Make onboarding engaging~~ | **Withdrawn 2026-10-05**, and replaced by a sharper test: a reward that affirms competence or values crowds motivation *in*; one that feels controlling crowds it *out*. Among volunteers, merely mentioning an extrinsic reward measurably reduced it — so recognition by name, yes; payment per task advertised up front, no |
| Escalate on a missed check-in | Overdue nudges. Alarm fatigue destroys the one mechanism where failure means someone is hurt |
| Show one number that sums somebody up | **Several kinds of standing, never a total, and nothing purchasable.** Honor is a relationship with one body, not a level; Karma is conduct; Hours, Supply and Intel are records. One aggregate score is what gets farmed, and what makes two people comparable on an axis they did not choose |
| ~~Build a nice map view~~ | **Withdrawn 2026-10-05.** The landing page is a map and a comms panel, and the prepaid-Android-8 floor was formally raised with it. The map's resolution must still match the data's: coarse placement on a street basemap invents precision nobody has |
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
