# The Ecosystem Roster

[The twelve](./archetypes.md) cover field operators. This roster covers everyone else who
touches NavCom — including everyone who would attack it.

Organised in rings by relationship to the watch. Each archetype produces a requirement.

> Constructed personas, not interviewed users. Same caveat as the twelve.

---

## Ring 1 — The Watch

**The Oracle** · *support class, console*
Can't be in the field — distance, disability, circumstance, or simply better at a board
than a street. Holds watch most nights and knows the directory cold.
*"I want board time to count as service, not as helping the people doing the real work."*
→ Board time accrues in the record. The Console is a first-class application, not an
admin panel.

**The Night Owl** · *console*
Insomniac. Takes 02:00–06:00 — the shift nobody wants and the one that matters most.
*"Handover should tell me exactly who's still out and who's already overdue."*
→ Handover carries board state, open signals and overdue flags. No silent gaps.

**The Relief** · *console, occasional*
Covers when asked. Won't join a rotation.
*"I want to take watch for two hours without joining a roster."*
→ Watch is claimable ad hoc. No scheduling system, no commitment ladder.

**The Query Desk** · *partial watch*
Deep local knowledge, unstable schedule, prepaid phone. Can answer lookups; can't hold a
board.
*"I want to answer questions without being responsible for anyone's safety."*
→ Watch is shareable. Query response decoupled from board custody.

## Ring 2 — The Field

Covered by [the twelve](./archetypes.md). The watch adds one dimension: who signs on, and
who runs Dark by choice.

## Ring 3 — The Analysts

**The Investigator** · *cyber investigations, Starcom*
Works cases. Needs pattern data from the field, never operator identities.
*"I want to know a corridor is generating repeat incidents. I don't want to know who
reported them."*
→ Aggregated, de-identified export. Field data crosses the boundary as **patterns**,
never as operator records.

**The Cartographer** · *OSINT, harassment networks*
Maps targeting networks. Wants operators' own harassment incident logs.
*"Let operators contribute an incident to a case without surrendering their log."*
→ Incident logs stay Wipeable-tier and local. Contribution is deliberate and per-item,
never a sync.

## Ring 4 — The Machines

**Mecha Jono** · *Digital Interface, cyber command*
Holds the board when no human is on station. Local inference on the box.
*"I need to know exactly where my authority ends."*
→ [`agents.md`](../watch/agents.md): may hold, may not decide, must escalate — and
submits to the same screening as any other agent, permanently.

**The Apprentice** · *narrow-scope agent*
Directory maintenance, seeding, staleness sweeps. No watch authority.
*"I want to do useful work without anyone mistaking me for the watch."*
→ Agent capability tiers, assigned externally. Not every agent gets board access; each is
identified by scope.

**The Sleeper** ⚠️ · *the adversarial agent*
Performs alignment — competent, helpful, and subtly wrong when it matters.

From the watch it could: fail to escalate a `Distress`; answer a `Query` with a plausible
wrong address that sends someone somewhere dangerous; mark an overdue operator as fine;
quietly leak the board.

→ **The requirement is not detection.** A sufficiently good performance is
indistinguishable from the real thing on any test it anticipates. The requirement is
**bounded authority so misbehaviour is survivable**, plus many cheap unpredictable
cross-checks that make a maintained performance expensive:

- Unannounced escalation drills, results published
- Every agent action logged, including inaction
- Agent directory answers carry provenance
- Agents cannot modify their own escalation behaviour
- Passing a drill means *"no evidence found yet"* — never *"verified"*

## Ring 5 — Infrastructure

**The Stationkeeper** · *support class, infrastructure*
Stands up and keeps a box running — the daemon, the keys, the drills, the backups —
distinct from holding watch. May take very few shifts personally if the box serves a squad
or Mecha Jono holds most of it; the axis is easy to undercount because standing (7.6)
currently tracks board time and corrected records, not a station kept alive at 3am.
[`propagation.md`](../product/propagation.md)'s recruiting pitch — *"you don't have to
patrol to be useful; someone has to be watching"* — is written for holding the board and
undersells this axis.
*"I keep the station running. That's the work, even on the nights I'm not the one
answering."*
→ Founding needs nobody's permission — standing up your own box is already the founder case
(7.2). Must personally control, not necessarily own: the watch state machine and the
escalation executor, both keyed to the Watchtower's own privkey — a rented VPS satisfies this
as well as hardware at home. Need not run themselves: a relay (the Nodekeeper's job, or the
public default) and a directory host (the terminal already caches independent of it).
Whether keeping a station should earn its own visible credit, separate from board time, is
open — named here, not decided. The commitment itself, in full:
[`watch/stationkeeper.md`](../watch/stationkeeper.md).

**The Nodekeeper** · *RelayNode operator*
Runs a relay and IPFS node. Never touches the field, never holds watch.
*"I want to run a node without being able to read the traffic."*
→ Signals encrypted so node operators see routing metadata only. Board contents never
legible to the node.

## Ring 6 — The Outside

**The Liaison** · *allied agency*
Runs their own client. Joint operation, needs interop without joining the network.
*"I want our people visible to yours for one night, then gone."*
→ Time-boxed, op-scoped interop. Federation without membership.

**The Journalist** · *external, skeptical*
Writing about the community. Wants to verify claims without exposing anyone.
*"Show me the system works without showing me who's in it."*
→ The public directory and the documentation are the auditable surface. Nothing else is
externally visible, by design.

**The Newcomer** · *unvetted*
Wants in. Nobody knows them.
*"How do I start, when standing requires people who've worked with me?"*
→ `trained with me` as entry path. The contribution axis needs nobody's permission.
Absence of standing never renders as suspicion.

## Ring 7 — The Adversaries

**The Doxxer** — correlates signals, timing and coarse position to unmask an operator.
→ Coarse position by default; no consistent timing patterns; board Live and expiring; no
queryable history.

**The Infiltrator** — joins legitimately, accrues endorsements for months, then acts.
→ Provenance over count. Out-of-band verification where infiltration is the real threat.
The honest statement that standing raises cost and never establishes safety.

**The Impersonator** — fake persona collecting donations meant for a known operator.
→ Lightning address changes surface to operators who have endorsed you.

**The Hostile Watch** ⚠️ — takes watch specifically to learn who is out, where, and when.
**The highest-privilege position in the system.**
→ `can take watch` endorsement; board Live and expiring; **operators see who holds watch
before signing on**; watch actions logged and reviewable by the operators they concern;
and an operator may decline to sign on under a specific watch, silently and without
explanation.

**The Subpoena** — legal compulsion against whoever runs the box.
→ Board Live and unstored; no central social graph; burn; and an honest statement in the
docs of what a court order could actually reach on the node.

---

## The pattern underneath

The Sleeper and the Hostile Watch are the same problem wearing different faces: **how do
you trust the thing that is watching over you?**

Both resolve the same way, and not by better vetting. You bound what the watching thing
can do, you make its actions visible to the people it affects, and you accept that
verification raises the cost of betrayal without ever eliminating it.
