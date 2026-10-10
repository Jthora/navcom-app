# Signals

Comms between field and watch are **structured, terse, and defined** — a protocol, not a
chat. Every signal has a shape, a responder, and a response window.

This is deliberate. Structured signals are faster to send under stress, unambiguous to
receive, and impossible to turn into a feed.

---

## The six

| Signal | Meaning | Responder | Window |
|---|---|---|---|
| `On station` | Going out. Area, expected duration | Watch acknowledges | Immediate |
| `Routine` | Periodic contact. Nothing needed | Watch acknowledges | Immediate |
| `Query` | Need information | Watch or agent answers | < 2 min |
| `Assist` | Need another operator or resource | Watch raises others | < 5 min |
| `Distress` | Emergency | **Human, always** | Immediate, escalating |
| `Stood down` | Off duty, home | Watch confirms and closes | Immediate |

## Query — the quiet workhorse

`Query` is what makes the watch worth having on an ordinary night.

You're outside a closed shelter at 10pm with someone who needs a bed. You do not tap
through a database on a cracked phone in the cold. You send `Query: bed tonight, has a
dog`, and someone with a full console and both hands free answers.

That is the Oracle relationship in one interaction, and it's the thing no app-only
product can do — because the answer comes from a person or an agent with better context,
not from a search box.

Queries are answered from the [directory](../product/directory-schema.md). A query the
watch can't answer becomes a gap in the directory, logged as such.

## Assist

Not an emergency. "I need another body," "I'm out of blankets," "there's a situation I
shouldn't handle alone."

Watch raises operators who are out nearby, or on-call operators who could come out. An
`Assist` that goes unanswered is reported back honestly rather than left hanging.

## Distress

The only signal with a guaranteed human terminus. Details in
[`the-watch.md`](./the-watch.md).

- Always deliberate. **Never inferred from silence, missed check-ins, or inactivity**
- Reachable from a locked screen
- Carries last known position if the operator shares position; otherwise last known area
- The escalation ladder runs to completion and reports each step back to the operator

## Overdue

Not a signal — a board state. When an operator passes their expected duration or misses
a routine window, watch marks them overdue and makes contact.

**Overdue nudges. It never escalates on its own.** Alarm fatigue would destroy the one
mechanism where failure means someone is actually hurt, and people are late for ordinary
reasons far more often than dangerous ones. Only a human reviewing an overdue can raise
it further.

## Discipline

- **Terse.** Signals carry the minimum that conveys the situation
- **Acknowledged.** Every signal gets a response, even if it's just receipt. Silence is
  never an answer
- **No threads.** No comments, no replies, no discussion. A signal is a transaction and
  it closes
- **Logged.** Everything lands in the op log automatically, so the after-action writes
  itself

## What this deliberately isn't

No free-text chat channel. No group conversation. No message history to scroll.

*Scoped 2026-10-09* (decided, not built): this is about signals. Crews may keep one Agreed line
and a flat, pull-only log, with no replies and no threads, outside the signal kinds. Anything
time-critical still belongs to `Distress`, or to Signal
([`../design/groups.md`](../design/groups.md) §9).

Teams already have Discord and Signal, and those work well for talking. What they don't
have is a protocol with defined responders and response windows — which is what makes
this comms rather than social software.
