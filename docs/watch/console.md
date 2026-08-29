> **Superseded in part.** The Console is now a **mode of the same app** — `/terminal/watch/`
> — not a separate surface served from a box. The premise of the original plan was that a box
> exists, and for a squad with no hardware it does not. What follows still describes what
> holding a board involves; where it describes a separate application, read it as the watch
> mode instead. Decided 2026-08-19, built 2026-08-20.

# The Console

Where watch is held. Desktop-shaped, information-dense, built for someone sitting down
with both hands free — the opposite of the [Field Terminal](./field-terminal.md) in
every respect, because it serves the opposite situation.

---

## The board

The primary view, and mostly it is calm.

- **Who's out** — callsign, area, signed on at, expected duration, last contact
- **Watch state** — who holds it, who's on call
- **Open signals** — anything awaiting response
- **Overdue** — anyone past their window, surfaced but not alarming
- **Conditions** — weather triggers, cold or heat emergencies affecting tonight

No feed. No activity stream. The board shows **current operational state**, and when
nothing is happening it says so quietly.

## Query handling

The console holds the full [directory](../product/directory-schema.md) with real search,
filters, and map view — everything the field terminal deliberately doesn't have.

An incoming `Query` arrives with context: who's asking, where they are, what they need.
The watch answers in seconds because they're sitting at a desk rather than standing in
the cold.

**When a query can't be answered, that's a directory gap** — logged automatically, and it
becomes the highest-value correction to make. The knowledge layer improves fastest at
exactly the points where it failed someone in real time.

## Raising operators

`Assist` requires reaching people. The console can raise operators who are out nearby,
operators who are on call, or the wider on-call roster — and reports honestly when
nobody answers.

## Handover

Watch is handed to a named successor with board state intact: who's out, open signals,
anyone overdue, anything unresolved. Or it's explicitly dropped to
[Automated](./the-watch.md), which is a normal and acceptable end to a shift.

Never silently abandoned.

## The box

The console is not only software. **It runs on a dedicated always-on node**, which is
what makes continuous watch possible at all.

Reference deployment is a Jetson Orin AGX running:

| | |
|---|---|
| **RelayNode** | Nostr relay + IPFS — the network the field terminals reach |
| **Mecha Jono** | Local inference, holding watch when no human is on station |
| **Directory host** | Canonical copy; terminals cache from here |
| **Watch state machine** | Board state, timers, signal routing, escalation ladder |

One node, and the whole system works for a small roster. That's the bootstrap.

**This is the reference deployment, not the minimum one.** Only two of these four need the
Watchtower's own key, and therefore must run on hardware the **Stationkeeper** — whoever
keeps a station running, [named in the roster](../research/ecosystem-roster.md) — personally
controls: the watch state machine and the escalation ladder. A relay can be the public
default or somebody else's RelayNode; a directory host is a convenience the terminal doesn't
depend on, since it already caches the public directory on its own. See
[`../build-order.md`](../build-order.md), Milestone 9, for the split and why it matters as
more than one person runs a box.

**Local inference matters beyond convenience.** Operator signals, positions and queries
never leave the box for a third-party model. A cloud agent would put the network's
operational picture in someone else's datacentre, which fails the privacy posture
everything else here is built on.

## Console operators are operators

Whoever takes watch is doing the work, not supporting the people doing the work. Board
time counts in their record. `can take watch` is an endorsement scope like any other.

This matters more than it sounds: it makes a genuine post for people who can't be in the
field — through disability, circumstance, distance, or simply being better at a console
than on a street. The network needs them more than it needs another body on patrol.

**Holding watch and keeping a station are different axes.** This section is about the
first — whoever is at the console tonight. The Stationkeeper, above, may hold very few
shifts personally if the box serves others; standing (7.6 in
[`build-order.md`](../build-order.md)) currently credits the first axis and not the second,
which is named as an open question there rather than settled here.
