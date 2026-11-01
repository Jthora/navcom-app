# Opt-Ins

Everything the system could hold about you, in one place, with what it buys and what it
costs. Nothing here is on by default.

## The line

**An operator may waive protections for themselves. Nobody may waive them for a third
party.**

That's the whole distinction. Your own contact details are yours to trade for
capability — you're an adult, it's your data, and you can weigh it. Information about the
people being served is never yours to trade, because they aren't users, never consented,
and aren't in the room to choose. See [`principles.md`](../principles.md) rule 5.

## What you can turn on

| Opt-in | Buys | Costs | Held where |
|---|---|---|---|
| **Emergency contact** | Escalation reaches someone when you can't act | A number exists that a court order could reach | Encrypted on the box, decryptable only at escalation |
| **Paging channel** | You actually get woken when on-call | Metadata to a push provider, or a stored number | Your device registers it; box holds only the token |
| **Recovery method** | A lost phone doesn't erase your standing | Something exists that can restore your identity | Encrypted backup, or shares held by endorsers |
| **Position sharing** | The watch knows where you are | Location precision, per session | Live tier, expires |
| **Lightning address** | Support without a donation platform | A public string on your card | Accruing tier |
| **Discoverable card** | Operators you meet can find you | Presence beyond your team | Your choice of scope |

## Rules that make this safe

**1. Fully functional without any of it.** Not degraded, not nagged, not second-class. An
operator with everything off is a complete operator, and nothing in the interface implies
otherwise.

**2. Honest at the point of choosing.** *"This means the box holds a number a court order
could reach."* Stated where the decision is made, not buried in a policy page.

**3. Encrypted and scoped.** A stored contact is decryptable only when an escalation
actually fires, is used only for escalation, and is never available for anything else.

**4. Actually revocable.** Remove it and it is gone — verifiably, not flagged.

**5. Auditable.** Every one of these is observable on the wire. Point a proxy at it and
confirm the data goes exactly where this page says and nowhere else.

## Never optional

- **Anything about the people being served.** No field, no convention, no exception
- Asking for an operator's legal name — nothing in the system needs it, so nothing asks. An
  operator who wants to go by it types it as their name, as any name (2026-11-01)
- Third-party analytics, engagement telemetry, or behavioural tracking
- Selling, sharing or aggregating any of the above

## One honest wrinkle

**Your emergency contact is a third party who never agreed to be in NavCom.**

It's a small version of the rule above, and it isn't disqualifying — storing an ICE
contact is a normal thing people do. But it's why the number is encrypted until an
escalation fires rather than sitting readable on the box.

**Tell whoever you list.** They should know what this is, and that a message from it means
something real.

## Being on-call is different

**A paging channel is a condition of the on-call role, not an option within it.**

Being on-call means being reachable — that's the entire content of the commitment. An
operator who wants the role registers a channel they will actually answer. One who doesn't
want to register a channel simply isn't on-call, which is a completely legitimate choice.

This is the one place where opting in is required, and only because the alternative is a
promise that can't be kept.
