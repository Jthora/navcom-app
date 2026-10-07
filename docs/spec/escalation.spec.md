# Escalation — Spec

Normative and **safety-critical**. Test the failure paths, not the happy path.

The guarantee: **`Distress` terminates in a human, or the operator is told it couldn't**
[C24, C42, invariant 2]. The ladder is allowed to fail. It is never allowed to fail
silently.

## Ownership

**The watch state machine owns the ladder. The agent is not in the path.**

The executor MUST be a separate process from the agent, and MUST NOT call it, wait on it,
or route through it. A degraded, hung, or hostile agent MUST NOT impair escalation in any
way — this is what makes the safety guarantee structural rather than a promise from an
entity whose alignment is unverifiable.

### A pager does not need the key

A `20911` is addressed to the Watchtower, so **anyone watching the relays can see that a
Distress arrived without being able to read a byte of it.**

That means the *wake somebody up* half of escalation can be run by a process that holds no
key at all — a cheap always-on machine anywhere, run by anyone, learning nothing about any
operator, any position or any question. Several MAY run at once; duplicate pages are a
nuisance and a missed page is not.

A keyless pager is a **supplement, never a replacement.** It cannot tell the operator
anything, and invariant 2 requires that they be told. Reporting stays with a keyed executor.

**And the keyed executor MUST get its trigger from the relays, not from the daemon.** A design where the
daemon receives the `20911` and hands it to the executor satisfies "separate process" on
paper while leaving a hung daemon able to take escalation down with it — the requirement
failing in exactly the way it was written to prevent. The executor subscribes on its own.

The cost is that two processes hold the Watchtower key, doubling where it lives. That is
accepted: the alternative is an escalation path depending on the availability of the
component most likely to hang. Run them under **separate supervisor units** — sharing one
means a crash loop in either restarts the other, and the separation becomes a comment.

## Trigger

Only a `20911` Distress event. Never a timer, a missed window, an overdue, or an agent's
assessment [invariant 3].

Escalation is not a decision. No component — human or agent — chooses whether to run the
ladder; receipt of the event runs it — unless a human already acknowledged that operator
inside the hold window, when receipt re-sends that acknowledgement instead (see *An
acknowledged Distress, sent again*, below).

## The ladder

```
                    ┌─────────────┐
  distress ────────►│   PAGING    │ page ALL on-call, in parallel
                    └──────┬──────┘
                           │ 300s, no ack
                           ▼
                    ┌─────────────┐
                    │   CONTACT   │ operator's emergency contact, if set
                    └──────┬──────┘
                           │ 300s, or none set
                           ▼
                    ┌─────────────┐
                    │  EXHAUSTED  │ tell the operator plainly
                    └─────────────┘

  any state ──ack──► ACKNOWLEDGED (ladder stops; human has it)
```

**Paging is parallel, not serial.** Every on-call operator is paged simultaneously. In an
emergency you want everyone, and a serial walk down a roster wastes the only resource that
matters.

## States

| State | Action | Window |
|---|---|---|
| `PAGING` | Page all on-call via each registered channel | 300s |
| *(skipped)* | An empty pageable roster MUST go straight to `CONTACT`, and with no contact either, straight to `EXHAUSTED`. Waiting out a window with nobody on the other end is five minutes the operator does not have, and it looks identical to a ladder that is working | — |
| `CONTACT` | Operator's emergency contact — device-initiated where the phone responds, node-initiated where opted in | 300s |
| `EXHAUSTED` | Report failure to the operator | terminal |
| `ACKNOWLEDGED` | Stop. A human has it | terminal |

*Windows configurable.*

**Acknowledgement** means a human explicitly accepting — a tap, a reply, an answered call.
Delivery receipts, read receipts, and app-open events MUST NOT count. Someone whose phone
buzzed is not someone who woke up. On the wire this is a `distress-ack` signal
[`signals.spec.md`](signals.spec.md).

An acknowledgement from outside the on-call roster MUST be refused and logged. Strictness is
the safe direction here: a ladder that keeps paging is survivable, and one stopped by
somebody who is not coming is not.

A ladder that has already reached `EXHAUSTED` still accepts an acknowledgement. Somebody
arriving late is still somebody arriving.

### An acknowledged Distress, sent again

**Decided 2026-10-07, reversing "terminal ladders do not adopt".**

For `ack_holds_seconds` after a **human** acknowledged an operator's ladder (default 1800), a
new `20911` from that operator MUST NOT open a ladder or page anyone. The executor answers it
with the acknowledgement it already has: a `20912` authored by the same human, with ladder state
`acknowledged`, whose `e` tags name **both** the new `20911` and the one the human acknowledged.
Its text says when the acknowledgement was given, that the executor has not escalated the new
attempt, and when the watch will treat it as new — only what the executor knows: a keyless pager
beside it may still page for the attempt, so it does not say nobody was paged. It sends that
again, freshly signed, about ten seconds later. It records a re-sent acknowledgement in its
accountability log (`acked`) once per attempt, when the outcome is settled, never a second
escalation. Once the window closes, a new `20911` opens a new ladder as before. A clock that steps
back past the moment of the acknowledgement closes the window too: the hold fails toward paging.

**A held acknowledgement that no relay takes on either send ends the hold.** A first send that no
relay takes is sent again ten seconds later like any other, and the hold stands until then: a
refusal is often a moment's — the daemon's agent acknowledgement on the same key a millisecond
earlier, under a relay's rate limit, or a blip on a box with one relay — and ending the hold at it
opened a ladder in the same breath and paged a person who had already answered. When the second
send reaches no relay either, and nothing from the hold has reached a relay meanwhile, the operator
was told nothing, so nothing is being held for them: the hold ends, and the operator's next attempt
opens a ladder and pages — the hold fails toward paging, as it does for a restart or a clock step.
The next attempt rather than this one, so a phone that heard through a relay that never said OK,
and stopped, is not paged for. The `acked` record is `acknowledged` once a relay takes either send,
and `ack-not-sent` once neither did — including a second send that never went because the hold
ended first or the executor stopped.

**A phone tells an acknowledgement of this `Distress` from one of an earlier `Distress` by its `e`
tags, read against what the watch has told it.** This `Distress`'s ids are the ones it sent, and
the ones the watch's ladder reports name beside them: a `Distress` started again while the first
one's ladder is still paging — the app reopened or evicted, the phone wiped and the `Distress` sent
again — has its attempts joined to that ladder, and each report to them names the attempt and the
ladder's own id. A person's answer that names only this `Distress`'s ids, or names a ladder this
`Distress` is part of — one it opened or joined — is an answer to this one, and it ends: the person
paged answers the id their page carried, which a restarted `Distress` never sent. Otherwise — it
names an id this `Distress` never sent and was never told it joined, and no ladder it is part of —
the `Distress` started after the answer: the app was reopened or the phone wiped once that ladder
was over, or this is a new emergency, and a person answered an earlier `Distress`. The phone MUST
say so, with who and when, and MUST NOT present it as an answer to this one; it keeps sending,
because only a person answering this `Distress` ends it [invariant 2]. Once the window closes, its
next attempt is escalated as new. Only a ladder's own report says what an attempt joined, never a
person's answer: that is the difference between a restarted `Distress` and one the watch is
repeating an earlier answer to.

The reason is a phone that missed the acknowledgement — its connection dropped at that moment.
It keeps sending, because only a human answer ends a `Distress` on the phone, and every new
attempt used to page the whole roster again for an emergency somebody was already answering.

Both ids, and the second send, because of how a phone listens. It accepts an answer only to an
id it has recorded, and a client before 2026-10-07 recorded an attempt only once the publish had
settled on every relay — up to about seven seconds when one of them is slow — so an answer
naming only the new attempt, sent the moment it lands, arrived first and was discarded, on every
attempt, for the whole window. A current client records the attempt before sending it; the
executor still covers the older ones, which stay cached on phones. The acknowledged id is one a
phone still in the same `Distress` has held since it sent it; a phone that started its
`Distress` again holds neither, and the second send arrives after it has recorded the new one.

**The cost: a genuinely new emergency from the same operator inside the window is read as the
old one until it closes.** The executor tells nobody about it — not the person who acknowledged,
and not the rest of the roster. The operator's phone is told who acknowledged the earlier one and
when, and that the watch has not escalated this one; a current phone shows that as an answer to
an earlier `Distress` and keeps sending, so its first attempt after the window is paged for. Two
things outside the executor still see the new `20911`: the watch's board marks the operator in
distress again, so whoever is holding the watch on a console sees it; and a keyless pager, which
cannot know a `Distress` was acknowledged, pages as it always does. An `EXHAUSTED` ladder holds
nothing — nobody answered it, so a new attempt pages as before.

The ladder state machine in core is unchanged. The hold is the executor's, applied before it
would open a ladder, and **it is kept in memory only**: an executor that restarts inside the
window has no hold, and the next attempt pages as before. That fails toward paging, which is the
direction to be wrong in.

## Reporting

The operator MUST receive a `20912` on **every** transition [C42]:

- `"paging 2 on-call"`
- `"no answer — trying your emergency contact"`
- `"couldn't reach anyone"`
- `"Raven is responding"`

**And on every attempt.** A retry that joins a live ladder pages nobody again, and MUST be answered
with the ladder's current report — its state, and whatever the node has added to it, such as that a
channel failed — naming the retry and the ladder's own `20911`. A report is ephemeral, and a phone
that missed one (a connection that dropped, a `Distress` started again) otherwise heard nothing
from the watch until the ladder ran out. Naming both is also how a `Distress` started again learns
the id the person paged will answer: the one their page carried.

**A client MUST hear every one of these, as it arrives.** On a box the daemon acknowledges every
attempt at once, as an agent, so the first answer to an attempt is usually an agent's; the
ladder's report follows by a round trip and its correction — nobody could be woken — by one more.
A client that took the first answer to each attempt and stopped listening showed "an agent
answered" until the ladder ran out five minutes later. It listens for the whole `Distress` instead
([`signals.spec.md`](signals.spec.md), `20912`).

`EXHAUSTED` MUST reach the operator's own device even with no watch and no network — a
local fallback message. An operator who knows nobody is coming can act on that.

**This one is the client's job, and it is the only part of the ladder the node cannot report
on**, because the case it covers is the node being gone. The client concludes it from time
alone: past the ladder's whole budget (`paging + contact`, 600s by default) a working watch
would already have said something, so silence means there is no working watch.

It is a **message, not a state**. The client MUST keep retrying — only the operator ends a
`Distress` — and MUST say it once rather than repeating it.

## Paging channels [C40]

Registering a channel is a **condition of the on-call role**. An operator without one is
not on-call.

| Channel | Notes |
|---|---|
| SMS | Node-initiated. Requires a stored number [opt-in] |
| Push | Third-party provider. Metadata exposure disclosed at registration |
| Voice call | Node-initiated. Requires a stored number [opt-in] |
| Console-open | Only counts while the console is actually open and focused |

`console-open` MUST NOT be offered as a sole channel to someone going to sleep. If it is
the only registered channel, the node treats the roster as empty for paging purposes and
says so.

**A channel names what was registered; the node owns the mechanism.** No provider is
embedded — the node runs a configured command per on-call entry, as argv rather than a shell
string so nothing in a payload can become a command. Embedding a provider would put a third
party in the one path that must not depend on anybody's uptime but the node operator's own.

Registering a channel is a **condition of the role**, enforced at startup: an on-call entry
with no way to wake anyone is refused rather than paged into nothing and then reported as
paged.

**A dispatch that failed MUST be reported as a failure, the moment it is known.** A command
exiting non-zero — a dead gateway, a missing binary — means nobody was woken, and the operator
MUST NOT be left believing `"Paging Wren."` when that happened. The ladder's first report goes out
as the pages are dispatched, not after them: a command may take thirty seconds to fail, and the
operator is owed the watch's first word before then. So `"Paging Wren."` can precede the outcome,
and the node MUST follow it, as soon as the commands return, with what only it knows — the
ladder's own sentence describes the state machine, which cannot see a command's exit status.
Where nobody was woken, that report replaces the ladder's sentence rather than following it with
one that takes it back; where some channels failed, it names who was paged and who was not. Every
attempt after that is answered with the corrected report, never the ladder's sentence alone.

## Paging budget

A watch MUST bound how many pages it will dispatch in a window.

The watch's address is **meant to be handed out**, so anybody holding it can publish a signed
`20911` from a key created a second ago. Unbounded, this pages a real person once per event —
and a pager that has cried wolf four hundred times is not answered on the night it is real.
Alarm fatigue is the failure mode that destroys escalation outright, so it is bounded here
rather than left to a relay or an operator's patience.

Past the budget the node MUST still open the ladder and MUST still report to the operator,
and the report MUST say plainly that nobody could be paged. The budget is therefore taken before
the ladder's first report, and that report is the one that says it. **The ladder is allowed to
fail; it is never allowed to fail silently** [invariant 2]. Refusing to page while reporting
`"Paging Wren."` would be the invariant failing in exactly the way it forbids.

The bound is global rather than per-key: a flood already arrives from one fresh key per
event, so a per-key limit is free to defeat. Defaults are deliberately generous — 20 pages an
hour — so that a real night never reaches the limit and a flood passes it immediately.

Live ladders MUST NOT be dropped at any age. Terminal ladders MAY be dropped after a
retention window, which must be long enough that a late duplicate `20911` still finds the
finished ladder rather than starting a second one.

## Emergency contact

- Encrypted at rest; decryptable **only** during an active escalation [C39]
- Used for escalation and nothing else — never notifications, never verification
- Revocable, verifiably
- **Device-initiated preferred**: the terminal sends it from the operator's own phone, so
  no number need be stored anywhere. Node-initiated is the opt-in fallback for when the
  operator can't act

## Drills [C29]

Unannounced, scheduled, and published.

- Frequency: weekly, randomised within the window
- Exercises `PAGING` end-to-end with a clearly-marked test payload
- Records: paged count, acknowledgement count, time to first ack, result
- **Published** to the public status page

A drill MUST be distinguishable from a real distress by the recipient. Producing alarm
fatigue in the name of testing would defeat the purpose.

**A watch that cannot demonstrate a passing drill is presumed broken**, and the watch
state degrades until one passes. Concretely: `10910` carries `last_drill`, and
`automated-oncall` publishes as `automated` while the last drill failed or none has run.
See [`watch-state.spec.md`](./watch-state.spec.md).

Result language: `no evidence of failure` — never `verified` [C32]. A passing drill means
the path worked this time.

## Failure modes to test

Not optional — these are the point of the spec:

1. No on-call registered → straight to `CONTACT`, then `EXHAUSTED`, operator told
2. On-call registered, nobody acknowledges → `CONTACT`
3. Acknowledged then nothing happens → ladder stopped; **known limitation, documented**
4. Node down at time of distress → device-local `EXHAUSTED` message fires
5. Operator has no emergency contact → `EXHAUSTED` reached faster, still reported
6. Agent degraded → escalation MUST still fire; it is the one path that cannot depend on
   agent health
7. Duplicate distress → single ladder, not two
8. Flood of `20911` from unknown keys → paging bounded, **every** operator still told, and
   what they are told — first, not after "Paging Wren." — is that nobody could be paged
9. Every paging channel fails → operator told nobody was woken the moment the commands return,
   in a report that replaces `"Paging Wren."` rather than adding to it, and every attempt after
   that is told the same — including on a box whose daemon answers every attempt first
10. Operator sends a new `Distress` inside `ack_holds_seconds` of a human acknowledgement →
    the acknowledgement again, naming the new id and the acknowledged one, and heard by the
    phone's own loop when one of its relays is slow to say OK; nobody paged. A phone whose
    `Distress` started after the acknowledgement says a person answered an earlier `Distress` and
    keeps sending; one whose attempts joined that ladder while it was paging ends on the person's
    answer to it. A held acknowledgement that no relay takes on either send ends the hold, and the
    next attempt pages; one the second send gets through does not.
    After the window, or once the clock has stepped back past the acknowledgement, a new ladder
