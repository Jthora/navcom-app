# The Watch

Someone is always on watch. That's the whole system; everything else attaches to it.

Not "notifications are enabled." A named party — human or agent — has accepted
responsibility for the operators who are out, for a defined shift. When you signal,
something answers.

---

## Roles

**On watch.** Holds the board. Sees who's out, where roughly, how long, when they last
made contact. Answers signals. Looks things up. Raises other operators when needed.
Works from the [Console](./console.md).

**In the field.** Signs on before going out, signals as needed, stands down at the end.
Works from the [Field Terminal](./field-terminal.md).

**On call.** Not at the console, but reachable — the escalation target when watch needs
a human.

An operator can hold more than one role over time. Someone who never patrols can be one
of the most important people in the network by taking watch, which is the point: this
gives support-class operators a real post rather than a spectator seat.

## Watch states

**An operator must know what is actually behind them before they go out.** The Field
Terminal displays the current state at all times, and states it plainly at sign-on.

| State | Meaning |
|---|---|
| **Station** | A named human is at the console, actively watching |
| **Automated + on-call** | [Agent](./agents.md) holds the board; a named human is reachable |
| **Automated** | Agent holds the board; no human has committed to on-call |
| **Dark** | No watch. Field Terminal runs standalone on cached data |

**Automated is a normal operating state, not a failure.** With a small roster it will be
the most common one. What is never acceptable is an operator believing a human is
watching when none is.

## The escalation guarantee

**A `Distress` signal must terminate in a human, or tell the operator it couldn't.**

This is the one rule automation does not get to relax. The agent's job in an emergency is
to raise someone, not to handle it.

**The ladder only works if someone can actually be woken.** A paging channel is therefore
a *condition of the on-call role* — being on-call means being reachable, and that's the
whole content of the commitment. An operator who won't register a channel isn't on-call,
which is a legitimate choice. See [`../product/opt-ins.md`](../product/opt-ins.md).

1. **Page every on-call operator at once**, through the channel each registered. Parallel,
   not serial — in an emergency you want everyone, and walking a roster one at a time
   wastes the only resource that matters. No triage, no filtering, no assessment
2. **No acknowledgement inside the window** → the operator's own emergency contact, if
   they set one. Device-initiated where the phone is responsive; from the box where the
   operator opted into storing the number
3. **Nothing left** → say so plainly: *"couldn't reach anyone."* Never silence
4. **Report every step to the operator as it happens** — "paging 2 on-call", "no answer,
   trying your contact", "couldn't reach anyone"

Acknowledgement means a human explicitly accepting. Delivery receipts and app-opens don't
count — someone whose phone buzzed is not someone who woke up. Full state machine in
[`../spec/escalation.spec.md`](../spec/escalation.spec.md).

An operator in trouble who knows nobody is coming can act on that. One who believes help
is en route when it isn't isn't merely unhelped; they're misled at the worst possible
moment.

**An operator with no emergency contact and an empty roster still gets the truth.** The
ladder is allowed to fail. It is not allowed to fail quietly.

## What the watch actually promises, in writing

**The watch state is [an attestation about capability](../attestation.md)** — a claim about
what would happen if you signalled right now, made by the node, checkable by you.

That is why it is published rather than assumed, and why `dark` is stated rather than
inferred from silence. A word like *Automated* is not enough on its own: what an operator
needs before going out is the consequence.

**At sign-on the node issues a signed capability receipt** — what escalation existed, at
that timestamp, in numbers:

> *2 on-call, both SMS-reachable. Last drill passed 3 days ago.*

or

> *0 on-call. `Distress` will page nobody and tell you so within 300 seconds.*

The operator's device keeps it. Both sides hold the same record of what was and was not
promised.

**What it proves, precisely.** The receipt is signed by the node, about the node — which is
a self-report, and [`agents.md`](agents.md) says self-report grants nothing. So it does not
establish that the watch is real. It establishes **what the Watchtower claimed, at that
moment, in writing it cannot later deny.** A false claim becomes attributable and
checkable-against-reality afterwards, rather than impossible.

That is a smaller property than *proof* and it is still worth having: the alternative is a
word like "Automated" and no record of what it was taken to mean.

**What would make it evidence** is the party with the knowledge signing for themselves — an
on-call operator declaring their own reachability rather than the node counting on their
behalf. The payload already carries the slots for it. That ships before the Watchtower opens
to anyone who has not been personally vetted; inside a circle you trust directly, the node's
own account is adequate.

A watch whose ladder is empty is still a watch worth signing on under — cached directory,
local logging, a duress fallback. What is never acceptable is not knowing.

## Duty

**Taking watch.** Explicit and ceremonial. You go on station, the board is yours, and
everyone out can see your callsign. Signing on means something — that's not decoration,
it's what makes the responsibility real.

**Holding the board.** Watch the timers. Answer signals. Take `Query` requests so the
operator in the cold doesn't have to search a database one-handed. Notice when someone's
overdue.

**Handover.** Watch is handed to a named successor or explicitly dropped to Automated.
Never silently abandoned. The incoming watch inherits board state, open signals, and
anyone currently overdue.

**Standing down.** Confirm everyone out has stood down, or hand over with them still
active and flagged.

## Qualification

Not everyone should take watch. It requires someone who will stay awake, stay reachable,
and answer.

Qualification is an [endorsement scope](../product/identity.md) — `can take watch` —
granted by operators who have worked with you. It uses the standing model already in
place rather than introducing a rank.

There is no hierarchy here. Watch is a **post**, not a rank. Whoever holds it has the
board; when they stand down they don't outrank anyone.

## When nobody has watch

Dark is survivable and the Field Terminal must stay genuinely useful in it:

- Cached directory, fully available offline
- Duress falls back to SMS to the operator's own contact
- Everything logged locally, synced when a watch comes back up

> **Field playbooks were on this list, and they do not exist.** They are designed and
> unwritten: de-escalation, first aid and overdose guidance need people with real expertise,
> and [`declined.md`](../declined.md) refuses generated content for exactly that reason. Listed
> as though they worked, they were the one item an operator in Dark would reach for and not
> find.

**Design rule: safety independence, not capability independence.**

Running Dark must never leave an operator worse off than carrying no app at all — the
safety kit and the cached directory still work.

It does leave them substantially **less capable**. `Query` is the central value of the
watch and it requires a watch; without one the terminal is a cached directory searched
one-handed in the cold, which is exactly the problem the watch exists to solve. Say that
honestly rather than implying Dark is equivalent.

## Watch accountability

The watch is the highest-privilege position in the system: it sees who is out, where, and
when. That access is granted on trust, and trust needs a check.

- **Watch actions are logged and reviewable by the operators they concern** — acked,
  answered, marked overdue, contacted, escalated, and the inaction where an overdue passed
  untouched
- The log records **actions, never positions**. Reviewing a watch shows *"acknowledged
  your sign-on 21:04, answered your query 22:41, no escalation"* — not a movement history
- **An operator may decline to sign on under a specific watch**, silently, without
  explanation, and without the watch being told

Tier detail in [`../product/data-tiers.md`](../product/data-tiers.md).
