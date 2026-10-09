# Data Tiers

Four tiers with genuinely different rules. Getting these confused is how a tool becomes
either useless (nothing accumulates) or dangerous (everything is retained).

| Tier | Lifetime | Location | Panic wipe | Failure mode |
|---|---|---|---|---|
| **Accruing** | Permanent | Device + operator-held backup | Survives | Losing it |
| **Live** | Minutes to hours | Relay, ephemeral | N/A — already gone | Persisting it |
| **Wipeable** | Until wiped | Device only | **Destroyed** | Retaining it |
| **Accountability** | 90 days | Node, append-only | Survives | Recording positions in it |
| **Collective** | Permanent | Shared, public-ish | Survives | Going stale |

---

## Accruing — the thing you build

Your persona, standing, endorsements, contribution credit, op history.

- Stored on device; exportable so a lost phone isn't a lost decade
- Endorsements are signed attestations **you hold and present** — no central graph
- Contribution credit is attached to a callsign, never to a person
- **Panic wipe does not touch this tier.** Losing a seized phone should not erase six
  years of standing. Recovery is via operator-held backup, not an account on a server.
- **Endorsements are association data** — each names its signer, so a collection maps who
  has worked with whom. They are **not** encrypted at rest today: like everything on the phone
  they sit in the browser's storage as plain text, so an unlocked phone shows them to whoever holds
  it (corrected 2026-10-09; [`../declined.md`](../declined.md), *Protection from someone holding
  your unlocked phone*). Only **burn** destroys them. Panic wipe protects against a phone being searched; burn is
  what exists for compulsion. See [`identity.md`](./identity.md).

Design test: *after a year of use, what does an operator have that they didn't before?*
If the answer is nothing, this tier is broken.

## Live — the thing happening now

The watch board, signals in flight, who's signed on, positions during an op, overdue
state, duress alerts.

**The board is Live, not stored.** When a shift ends, board state hands over or expires —
it is never a queryable history of who was out where. What survives into the record is
the operator's own op log, on their own device.

- Ephemeral by construction — published to relays as non-stored events, not written to a
  database
- Opt-in per session; sharing starts when you clock into an op and stops when you clock
  out or the session expires
- Visibility levels: **off · team only · city · network** — set by the operator, defaults
  to team only
- Position resolution is coarsened by default; precise sharing is a deliberate act
- Nothing here is queryable after the fact. There is no position history to subpoena
  because there is no position history.

Design test: *if a relay operator kept everything they received, what would they learn?*
The answer must be "who was roughly active, roughly when" — and nothing more.

## Wipeable — the thing that must vanish

Incident logs documenting harassment aimed at *you*, local caches of op detail, drafts,
anything about tonight.

- Device only. Never synced, never backed up automatically
- Not encrypted at rest: plain text in the browser's storage, like every tier (corrected
  2026-10-09)
- **Panic wipe deletes this tier** — the browser's own deletion, not a flag. It unlinks rather than
  scrubs, so it is not a secure erase against somebody patient and equipped
  ([`../declined.md`](../declined.md), *Protection from someone holding your unlocked phone*)
- Exportable deliberately, by the operator, before it's needed

Design test: *if this phone is taken, what does it give up?* Ideally nothing beyond the
existence of the app.

## Accountability — the thing that keeps the watch honest

What the watch and the agent *did*. Append-only, retained 90 days by default, and
deliberately separate from the board.

```
timestamp · actor · actor_kind · action · subject · outcome
```

- Records **actions, never positions.** No areas, no query text, no movement
- Each operator can review entries where they are the subject
- Agent inaction is logged too — an overdue that passed without contact is an entry
- **Survives both panic wipe and burn.** It lives on the node, not the device, so no
  operator action reaches it — and that is deliberate rather than a limitation. A log the
  watch could cause to be erased would not be a check on the watch [C33]. It expires on
  its own retention clock and nothing else

**Why it exists:** the watch is the highest-privilege position in the system, and an
operator who signed on under someone should be able to see what that someone did with the
board. Without this, "trust the watch" is an assertion rather than a check.

**Why it isn't the board:** the board expires because a queryable history of who was out
where is the artifact most dangerous to this community. Actions can be retained safely;
positions cannot.

## Collective — the thing everyone builds

Resource directory, field playbooks, local knowledge notes.

- Shared, replicated, cached offline in full
- Contributions attributed to callsigns — visible expertise without identity
- Carries verification metadata and staleness (see
  [`directory-schema.md`](./directory-schema.md))
- Assume it is readable by anyone. Never put operational or personal detail here.

Design test: *is this more accurate than it was last month, and can you tell who keeps
it that way?*

---

## Where features land

| Feature | Tier |
|---|---|
| Persona, callsign, emblem | Accruing |
| Endorsements, standing | Accruing — encrypted, burn-only |
| Board time on watch | Accruing |
| Lightning address | Accruing |
| Watch state, board contents | Live |
| Signals in flight | Live |
| Op history, ground covered | Accruing |
| Contribution credit | Accruing |
| Who's out tonight | Live |
| Team positions during op | Live |
| Check-in status | Live |
| Duress alert | Live (delivery), Wipeable (local record) |
| Incident log | Wipeable |
| Cached op detail, drafts | Wipeable |
| Resource directory | Collective |
| Field playbooks *(designed, not yet written)* | Collective |

## The rule that ties it together

**Panic wipe destroys the Wipeable tier and nothing else. Burn destroys everything.**

An operator who wipes under duress loses tonight and keeps their decade. One who burns
loses everything deliberately, because the situation demanded it. That balance is the
entire reason these tiers exist separately — and it's why a single blanket retention
rule, in either direction, is the wrong answer.

State the boundary plainly to operators. Someone who believes panic wipe is total when
it isn't is worse off than someone who knows exactly where the line sits.
