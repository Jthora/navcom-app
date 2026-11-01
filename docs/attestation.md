# Attestation

The one object this system is built out of. Everything else is this, pointed at a
different subject.

> An **attestation** is a claim, plus who made it, plus how they know, plus how much that
> is worth — signed, and checkable without anyone's permission.

---

## Why it has a page

It was arriving everywhere independently. The directory derived confidence from method and
age. Identity made endorsements signed statements held by the recipient rather than rows
in a table. Agents were bounded because self-report grants nothing. Drills reported *no
evidence of failure* rather than *verified*. Watch state published `dark` rather than
staying quiet.

Six derivations of one idea, which is why the rules read as a compliance regime: **a single
principle appearing as six unrelated rules feels like six rules.** Named once, most of them
become a sentence.

## The four parts

| | |
|---|---|
| **Claim** | What is asserted. "Intake closes at 21:00." "This person is reliable." "Two on-call are reachable right now." |
| **Author** | Who says so. The name they chose, a node, an agent |
| **Method** | How they know. In person, by phone, from a website, from someone else, by measurement |
| **Weight** | What that is worth, **derived from method and age — never asserted by the author** |

Signed by the author. Verifiable offline, by anyone, without asking a server.

## What falls out of it

These are consequences, not additional rules:

**Weight is derived, never declared.** An author cannot tell you how much to trust them. It
follows from how they know and how long ago. This is why the directory computes confidence
instead of storing it, and why an agent's account of its own status grants it nothing.

**Absence is information.** No attestation is a fact about the world — nobody has
established this — and it is different from a negative claim. A blank intake field means
nobody asked, not that there is no restriction. A missing watch state means Dark, not
unknown.

**Provenance, never a count.** An attestation is weighed by recognising who made it. A
number invites gaming, and a tally of anonymous agreement is weaker than one recognised
name. This is why endorsements show authors and not totals.

**Nothing is verified, only unfalsified.** A passing check means no evidence of failure was
found this time. There is no attestation that ends the question, including one about the
system itself.

**You cannot attest on someone else's behalf.** A credential says *"I vouch for the holder"*
and names only its signer, so nobody can create a record about a person who never agreed to
exist in the system.

## Where it appears

| Subject | The attestation says |
|---|---|
| A place | Intake closes at 21:00 — checked in person, 3 days ago |
| A person | I worked with this operator — signed, scope-tagged, held by them |
| The world | This claim is corroborated by 2 independent sources ([Starcom Finding](ecosystem.md)) |
| A capability | If you send `Distress` now, 2 on-call are reachable — signed at sign-on |
| A mechanism | The escalation path was exercised and nothing failed — published |
| An agent | This agent is bounded to these actions, and says so in every acknowledgement |

One object. Six subjects. Not six subsystems.

## What it is not

**Not consensus.** Nothing is decided by counting agreement. Two operators may attest to
contradictory things and both records stand, with their authors visible.

**Not a ledger or a chain.** No global ordering, no shared state to agree on, nothing to
mine. Attestations are independent statements that happen to be signed.

**Not a reputation score.** There is no number. Weight is per-attestation, derived, and read
by a human who may recognise the author.

**Not proof.** A signature establishes who said something, not whether it is true.

## The convergence

[Starcom](ecosystem.md) arrived at the same object independently — a `Finding` carrying
`claim`, `confidence`, corroboration with a source count and an algorithm version, and a
signature. No shared code, no shared schema, same shape.

Two teams converging is the strongest available evidence that the primitive is real rather
than an aesthetic. It also means interoperation is a **convergence rather than a
negotiation**: the same object, aimed at different subjects.

## Why this is the point

An institution is believed because of what it is. Everyone here acts without one — no
badge, no warrant, no agency behind them — so **the only thing that can carry belief is
what they can show.**

That is the condition of a real-life superhero, a street medic, an outreach volunteer and a
citizen analyst alike, and it is why this system is built out of checkable claims instead of
authority. It is also the whole of the
[ninth tribe](ecosystem.md): not merely people with local ground truth, but people who act
without institutional authority and must therefore carry their own provenance.
