# Constraints

What the [archetype](./archetypes.md) stress tests demand. Requirements to build against,
not a scope boundary.

**Numbers are stable** — the specs cite them. Where a constraint is one application of
[the attestation model](../attestation.md), it says so in a line rather than deriving the
idea again.

---

## Hard constraints

Non-negotiable. A design that violates one is wrong regardless of its merits.

| | Constraint | Source |
|---|---|---|
| **H1** | No data about the people being served — no field, no convention, no exception* | Medic, ethics |
| **H2** | Panic wipe destroys the wipeable tier completely; identity survives | Protest Medic |
| **H3** | No legal names anywhere. Contact details only where an operator opts in for themselves | Skeptic, Convert |
| **H4** | Duress is always deliberate, never inferred from silence | Heart |
| **H5** | Volatile data displays its age; stale reads "call first" — *weight from method and age* | Medic |
| **H6** | Runs on a prepaid Android 8 with ~400MB free | Convert — **measured 2026-08-20, see [`device-floor.md`](device-floor.md)**: the constraint is real but it is about *storage*, and the CPU is not what makes the app slow |
| **H7** | Knowledge layer fully usable offline | Outpost |
| **H8** | Every network call auditable; no third-party analytics. No push except opt-in `Distress` paging | Skeptic |

\* **H1 is a rule about what the system offers, not something software can enforce.** Field
notes are free text. What the design guarantees is that no field, schema or feature ever
invites it. Claiming enforcement we don't have would be the overclaim this project keeps
catching.

---

## Attestation, applied

**One idea: [an attestation is a claim, its author, how they know, and what that is
worth](../attestation.md).** These are its instances. Read the page once; each line below is
a consequence, not a separate principle.

| | |
|---|---|
| **C3** | No central social graph. Attestations are held by their subject, never indexed |
| **C13** | Endorsements carry scope tags, never free text. A claim has a shape |
| **C14** | A credential names only its signer — *"I vouch for the holder"* |
| **C20** | Provenance by name, never a count. Recognition beats a tally |
| **C21** | Seeded entries look visibly different. Method must be visible, not merely recorded |
| **C23** | Watch state visible before sign-on. Capability is attested, not assumed |
| **C25** | Agents are always identified as agents. Authorship is never ambiguous |
| **C29** | Unannounced escalation drills, results published. A mechanism attests to itself |
| **C30** | Agent capability assigned externally and re-checked. Self-report grants nothing |
| **C31** | No agent is exempt from screening, including ours |
| **C32** | Passing means "no evidence found yet," never "verified." Nothing ends the question |

## No number that invites gaming

Related, and the reason is the same: a tally can be manufactured, a recognised author
cannot.

| | |
|---|---|
| **C5** | No streaks, badges, leaderboards or absence commentary |
| **C16** | Funding is independent of visibility, and totals are never shown |
| **C22** | The recap discloses no team size or collective activity, and makes no impact claims |

## Consent is per-person and revocable

| | |
|---|---|
| **C1** | Every social feature has an off switch, and the app works with all of them off |
| **C15** | Presets set switches, never override them. No preset is visible to anyone else |
| **C34** | An operator may decline to sign on under a specific watch, silently |
| **C38** | An operator may waive protections for themselves; never for a third party |
| **C39** | Every opt-in is off by default, honestly priced, encrypted, scoped, revocable, auditable |

## Safety mechanics

Distinct machinery, not restatements.

**C4 — Missed check-in nudges; it never escalates.** Alarm fatigue kills the one feature
where failure means someone is hurt.

**C24 — `Distress` terminates in a human, or reports that it couldn't.** No triage, no
filtering, no agent assessment. Every step reported back.

**C40 — A paging channel is a condition of the on-call role.** Without one the ladder is a
promise that cannot be kept. Declining is legitimate; it means not being on-call.

**C41 — Engagement notifications are banned; safety paging is not.** Conflating them once
left the ladder unable to wake anyone.

**C42 — The escalation ladder may fail, but never quietly.** An empty roster and no contact
still produces *"couldn't reach anyone."*

**C33 — Watch actions are logged and reviewable by the operators they concern.** The watch
is the highest-privilege position in the system.

## Memory has opposite rules

**C27 — The board is Live, never stored.** No queryable history of who was out where.

*Resolves against C33 by separation:* the **board** expires; the **accountability log**
records what the watch did — actions, never positions, areas or query text.

**C9 — Export everything.** Nothing holds an operator captive.

**C26 — No cloud inference on operational data.** Local inference only.

**C36 — Node operators see routing metadata only.** Board contents never legible to a relay.

## Knowledge

**C8 — Flagging is always easier than fixing.** Most people only ever have the first half.

**C17 — Correction works offline and queues.** Discovery happens at the worst moment for
connectivity and the most urgent moment for action.

**C18 — Design for the minority who maintain; free-riding stays costless.** A directory
demanding reciprocity gets abandoned by the people it most needs.

**C12 — No city starts empty.** Thin and obviously imperfect beats a blank screen.

## Reach and growth

**C2 — Standing accrues on two independent axes.** Contribution requires nobody's
permission, so deep knowledge with no social history still builds real standing.

**C7 — Presence shows the wider network, not just the local one.** For an isolated operator
an empty local map reads as *you are alone*.

**C19 — Team presence and network presence are separate features.** Team works at three
operators; network needs density that doesn't exist early.

**C11 — Growth follows existing trust paths.** No referral rewards, invite quotas, contact
upload or proximity pressure.

**C6 — Give the Public Face something designed to leave the app.** Absent one, he
screenshots something with a teammate's callsign in it.

**C10 — Offline is a normal state, not an error.** Degrade visibly; never fail silently.

**C28 — Watch is shareable.** Answering questions must not require holding the whole board.

**C35 — Field data crosses to analysts as patterns, never as operator records.**

**C37 — Allied interop is time-boxed and op-scoped.** Federation without membership.
**Declined, not deferred** — see [`declined.md`](../declined.md). This constraint describes
the shape it would have to take *if* the decision were ever reversed; it is not a commitment
to build it, and reading it as one is how it ended up on the deferred list by mistake.

---

## Known conflicts and their resolutions

**Team oversight vs. operator autonomy** → visibility is granted by the operator, never
claimed by the lead.

**Durable records vs. seizure risk** → split by tier. There is no position history to
subpoena because none is retained.

**Publicity vs. pseudonymity** → solved by provision, not restriction. Give him a scrubbed,
shareable artifact.

**Accuracy vs. coverage** → accuracy wins. Thin and correct beats comprehensive and rotting.

## Open questions

- **Sybil resistance is weak by choice.** Every countermeasure worth having needs identity
  or history, which excludes the operators with the most valuable knowledge. The answer is
  provenance over count (C20) and out-of-band verification where infiltration is the real
  threat.
- **Directory maintenance** — still the largest unproven assumption in the project.
- **Presence density** — the threshold at which a live count stops being depressing is
  untested.
- **Seeding quality varies by region.** Public data is good in some metros and nearly absent
  in others.
