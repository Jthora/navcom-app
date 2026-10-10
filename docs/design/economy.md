# The economy: what is scarce, what is proven, and what we never hold

Three currencies touch things outside this system, and each one asked a question that could not
be answered inside it. Writs need a ledger nobody keeps. Intel needs an oracle nobody is. Money
needs custody nobody wants.

This document answers all three without adding a server, a chain, or a party to trust.

Status: **design.** §1–§5 are decided 2026-10-06. §6 is open and named as such.
Companions: [`missions.md`](missions.md) for the mission model,
[`raw-intel.md`](../product/raw-intel.md) for the observation schema,
[`attestation.md`](../attestation.md) for the primitive underneath all of it.

---

## 1. There is no ledger, and a chain would buy the wrong thing

The architecture forbids a ledger. Nothing readable reaches a server, nobody holds your board,
and each device draws its own picture from what it can decrypt. So **there is no canonical
standing, ever** — two operators compute different Honor for the same person because they can
decrypt different subsets of history. That is tolerable for a record and fatal for a *balance*:
"has this person already spent their writ?" is unanswerable without the thing we refuse to keep.

The question that followed was whether a blockchain solves it. It does not, and the reason is
worth stating precisely rather than dismissively.

**A chain exists to make mutually distrusting parties agree on state that is not otherwise
visible** — specifically, whether a coin has already been spent. That problem exists because a
coin is a bearer secret: nothing public reveals its status, so agreement has to be manufactured.

The Writ problem is not that problem. Make a Writ a ceiling on *outstanding* missions, and
"has this person exceeded it?" becomes **a pure function of public data** — open missions are
public by definition, because they are the thing on the map. Every honest relay evaluating the
same function over the same events reaches the same answer independently: no consensus round,
no protocol between relays, no genesis event, no fees. **Agreement is a consequence of
determinism rather than something negotiated.**

That is also the scaling story. A third RelayNode joins the grid by running the rule. Nothing
registers it, nothing admits it, no state is transferred, because arithmetic over public events
does not have opinions.

### What a chain would have cost

| | |
|---|---|
| **Permanence** | On-chain state is public forever and globally linkable. Every writ, mission and claim becomes a permanent graph keyed to a pubkey — and there is no delete. This project refuses to publish presence; an NFT of a claim publishes it irrevocably |
| **A funded wallet to participate** | The device floor is a prepaid Android 8. Requiring an on-chain transaction to post a mission means requiring money to be useful at all |
| **And it still would not enforce** | A chain can attest that a pubkey holds three writs. It cannot stop a fourth mission reaching a relay. Enforcement stays at the relay or the reader either way, so the chain adds cost without delivering the thing it was for |

**NFTs specifically are the wrong instrument for the clearest possible reason.** An NFT's unique
value is that an asset becomes transferable to strangers and tradeable on an open market. Writs
must be **non-transferable**, or a market exists in the right to task volunteers — which the
anti-patterns table forbids in as many words. The one property NFTs uniquely provide is the one
property this design specifically must not have.

**Bitcoin is already used here, and correctly:** the accountability log is anchored to it. Commit
a hash, prove a stretch of history was not rewritten, pay once, reveal nothing. Going from
*anchor a hash* to *hold state* is the move to resist — not because chains are bad, but because
we would be paying for consensus on data that is already public.

---

## 2. Writs: a ceiling on outstanding asks

**Decided.** A Writ is not a balance and not a token. It is a **ceiling on how many missions you
may have open at one time**, evaluated independently by every relay and every reader.

- Spending is implicit in posting. There is nothing to debit.
- Refund is implicit in the mission closing, expiring or being withdrawn. There is nothing to credit.
- There is no stock, so **there is nothing to inflate** — which answers the inflation question by
  dissolving it rather than tuning it.
- They are **non-transferable**, because a transferable one is a market.

**A body's grant is a signed attestation that raises your ceiling**, not a coin it hands you.
Same primitive as everything else here: a signed statement anybody can verify, revocable by its
issuer, scoped and expiring. "One extra open mission for thirty days" is more expressive than a
token *and* more revocable, and it is why the one-use-token design was folded into this one
rather than chosen against it.

Account setup sets a ceiling of 1 and nothing else, so a new operator can hold one open mission.
**Founding a body costs a multiple of the ceiling**, which makes patience or a body's grant the
gate on creating an institution — and stops the tutorial from producing ten thousand one-person
factions on launch day, which is what "unlisted until it has members" was already defending
against.

### How it fails, which is the right direction

A relay that can only see some of an author's missions **under-counts and admits too many.**
Partition therefore fails *open*: a split grid accepts a few missions too many rather than
refusing legitimate ones, and a reader seeing several relays still renders the true picture. A
design that failed closed would silently refuse honest operators during an outage, which is
worse in every case that matters.

---

## 3. Intel: the refinement is the oracle

**Decided, and the architecture supplied the answer.** NavCom produces **Raw Intel only** —
field, not chair. It does not produce Intel Reports, and it never grades its own output.

So **Intel mints when an observation is refined downstream.** Raw Intel taken up and turned into
a report has demonstrably held up, and that is an event we can already observe because we already
read The Record. No local adjudication, no maintainer gate, and no second-observer rule that
would fail in thin regions — which is most of them.

### Why this is the strong form, in game-theoretic terms

It is a **signalling game with delayed third-party verification**, and it separates:

- A fabricated observation fails corroboration at refinement, so it never refines, so it earns
  nothing. The fabricator pays the cost of fabricating and receives zero.
- Honest and dishonest players therefore have different payoffs, so they behave differently, so
  **the signal carries information**. A separating equilibrium is the only kind worth building,
  and this one arrives for free from the division of labour.

Three consequences follow, and they are rules rather than options:

1. **The producer never grades their own work.** A NavCom operator cannot declare something
   Critical or Actionable because NavCom structurally cannot produce those tiers. Separating the
   reporting role from the valuation role is how grade inflation is prevented, and the
   Starcom/NavCom split does it at no cost.
2. **Any refiner counts, not only Starcom.** Otherwise one desk becomes a gate that starves
   everyone's Intel whenever it is busy, hostile or gone. A second analysis desk must be a
   feature rather than a competitor.
3. **Show both counts, never a ratio.** "4 submitted, 1 refined" and "400 submitted, 1 refined"
   are different pictures and the reader does the division. That defeats volume-flooding with no
   adjudicator — and two counts are *records*, which the anti-patterns table permits, where a
   derived precision score would be the single number it forbids.

**Intel is also the only kind an operator in the Alone layer can earn**, with no crew, no
counterparty and no mission. Since Alone is the default and explicitly not a degraded state, this
is the kind that must ship, not the one to defer.

### The cost of making Intel the most valuable currency

The motto this draws on is *information is power and currency*. Invariant 1 says nothing is
recorded about the people being served. **Raw Intel is exactly where those collide**, because by
the motto's own logic the most valuable field intel is often about people.

[`raw-intel.md`](../product/raw-intel.md) already answers this structurally — an anchor rule, and
a closed vocabulary whose only job is that no descriptor has anywhere to go. That is the right
shape and it must stay the shape. But **promoting Intel to the most valuable currency creates
permanent upward pressure on that vocabulary**, and the defence has to remain structural rather
than motivational, because we are about to start paying people for intel. Naming it here so it is
not discovered in a pull request in six months.

---

## 4. Money: the bounty is a trust game, and it has exactly three fixes

A poster offers B sats. An operator does the work at real cost — fuel, hours, risk. Then the
poster chooses whether to pay.

Backward induction: at the final node, keeping B strictly beats paying B. So the poster does not
pay; the operator anticipates that and does not work. **The unique equilibrium is no trade.** Good
intentions do not change this. They change payoffs only where defection is actually costly.

There are three ways to change the payoffs, and the list is exhaustive:

1. **Remove the poster's final move.** Lock the money before the work, release on a condition
   they cannot veto.
2. **Make the game repeated against a real stake.** Defection destroys future value exceeding B,
   which requires identity to be expensive *and* defection to be observable.
3. **Bond the operator instead.** Rejected: it solves the opposite problem and puts the risk on
   the volunteer, who is already carrying all of the unrecoverable cost.

### The receipt problem is solved, not merely mitigated

[`missions.md`](missions.md) §4 is right that a NIP-57 zap receipt is not proof of payment — it is
a server's claim, forgeable by a compromised server. A **NIP-61 nutzap is different in kind: a
P2PK-locked Cashu token in which the payment itself is the receipt.** It is not a claim about
money, it is the money, locked to the recipient's key. If you hold it, you were paid, and nobody
has to be trusted to say so.

So §4's rule is **upgraded rather than withdrawn**: receipts are still worth nothing, and bearer
tokens are worth exactly their face value. Standing is still never minted from either.

### The escrow, and why it locks at claim time

**Decided: an HTLC locked to the claimant, created when the claim is accepted, with a refund path
to the poster after a locktime.** Cashu NUT-14 supports precisely this — the `pubkeys` tag names
who may spend with the preimage, `refund` names who recovers it, and `locktime` says when.

| Property | |
|---|---|
| The claimant can **verify real money exists and is locked to their key** before spending any fuel | The whole point. A bounty is either visibly funded or visibly not |
| The poster **cannot redirect it** to anyone else once minted | Their remaining power is to withhold the preimage, not to retarget the money |
| Unreleased money **returns to the poster** at locktime | Nothing gets permanently stuck, which is the edge case that would otherwise need a human |
| **Nobody custodies anything** | See §5 |

The insight that drove the timing: **you cannot remove a poster's discretion, but you can
relocate it to a node where the operator has lost nothing.** Locking at claim time moves the
poster's decision to before the operator sets out. The worst case becomes a wasted claim slot
instead of a wasted night, fuel and risk.

Why not simply pay on claim, with no preimage at all — better UX still? Because it inverts the
attack: a fresh key claims funded missions, takes the money and never works. The HTLC keeps the
best property of prepayment (verifiable, irrevocably assigned money, visible before departure)
without handing a stranger the funds up front.

### And the reputation backstop builds itself

Because a locked token is publicly checkable, a bounty carries a **readout — `funded`, `released`
or `withheld`** — which is a readout rather than a score, so it satisfies
[`panel.md`](panel.md). Nobody claims from a poster whose last three bounties read `withheld`.
That is grim-trigger punishment enforced by the interface, needing no arbiter, no dispute process
and no judgement call from us.

### Writs or Zaps, never Writs *for* Zaps

**Decided.** The two gates are **alternatives, not convertibles**: an unpaid mission is posted
against a Writ, a bounty is posted against locked sats. You cannot buy a Writ.

This resolves the contradiction between the anti-patterns table ("nothing purchasable") and
`missions.md` §4 ("granted by a body, or bought") **in favour of the table, without banning
money** — which no other option managed. Funding a bounty costs real money whether or not anybody
takes it, and it never becomes the right to direct unpaid volunteers. Money gets a lane, and it
is not that lane.

**NavCom takes nothing from a bounty.** No fee, no cut, no percentage. That is a design rule
first — a cut would make us a party to every transaction — and §5 explains why it is also the
single most important line for staying a tool rather than an intermediary.

---

## 5. Custody: what removes the liability, and what remains

Not legal advice, and jurisdictions differ. But the engineering question has a clean answer,
because the test that matters is mechanical: **do we ever hold a key that can move someone else's
money?**

| | Can we move the funds? | |
|---|---|---|
| **Poster mints and holds, locked to the claimant** | **No** | Adopted |
| **User-chosen third-party mints** | **No** | Adopted — and it is the same design |
| A federation where we are a guardian | Partially — we hold a threshold share | Declined for us |
| We run a mint | Yes, entirely | Declined |

**The two liability-free options are one design, not two.** The lock is always a Cashu token
locked to the claimant; *where it is minted* is a per-user choice, and NIP-61 already specifies
the mechanism — a `kind:10019` event in which an operator declares the mints they trust and the
P2PK key to lock to. The sender reads the **recipient's** list and mints there.

That direction is the right one and worth stating plainly: **the person taking the risk chooses
the custodian.** An operator who will not accept a mint does not have to, and nobody can be paid
into a mint they do not trust.

**We do not run a mint and we are not a guardian of one.** If relay operators want to stand up a
federation — Fedimint's model is a threshold of guardians, 3-of-4, 5-of-7 or 7-of-10, tolerating
roughly one more fault per three guardians added, where no single guardian can move anything —
that is theirs to run and theirs to carry, and an operator may elect to use it like any other
mint. The line is that **we publish software; we never hold value.**

### What exposure is left, honestly

- **Facilitation.** Software that helps people pay each other is generally a tool rather than an
  intermediary, and the things that erode that distinction are: taking a fee, setting a default
  mint, curating a list of blessed mints, and arbitrating disputes. **We do none of the four.**
  No cut, no default, no blessing, and no judgement — which is also why §4's enforcement is a
  readout rather than a tribunal.
- **Content.** A bounty offered for something illegal is an offer we are hosting. That is the
  moderation exposure the mission system already has, unchanged by money.
- **Disclosure.** The interface must say, where somebody can actually see it, that the money is
  between two parties and that we hold none of it.

---

## 6. Ceilings are conserved, never minted

**Decided 2026-10-06, closing a leak the ceiling design opened.**

Honor is per-body so that a fake body is harmless — its Honor only buys standing with itself. But a
rung raises a **Writ ceiling**, and ceilings are honoured by every relay, so the leak ran straight
through the layer meant to contain it: found a body, post missions to your own members, settle them,
mint Honor, mint ceilings, and the whole grid respects them.

**The rule is a conservation law rather than a check. Nothing creates ceiling except a source, and a
body may only delegate from what it holds.** Account setup is the source; a body with nothing has
nothing to give.

| | |
|---|---|
| **Capacity scales with real membership, with no tuning** | Each person brings their setup grant, so a body of 400 has 400 units and a body of 4 has 4. No cap to revisit as the network grows |
| **Lending has a real opportunity cost** | A body gives ceiling to a member only when that member's mission matters more than one of its own — efficient allocation by people with local knowledge, rather than central rationing |
| **New sources plug in without changing the law** | Verification tiers, vouching, a higher setup bar: each becomes a source. The law stays "bodies only move it" |

Each rejected alternative had a dominant exploit, which is why this was not close:

- **A fixed cap per body** makes founding many small bodies strictly better than growing one. Cap
  arbitrage, and it defeats the "unlisted until it has members" protection directly.
- **Per-relay recognition lists** put relays in competition on permissiveness: operators migrate to
  the permissive ones and the permissive ones get flooded. A race to the bottom, and an operator
  cannot predict whether their own mission will be visible.
- **No body grants at all** removes the main reason to join an organisation, undermining the layer
  this whole design rests on.

**The honest cost: the economy's sybil resistance now equals the cost of account setup.** That is a
feature. It puts the hard problem in one legible place, where the credential and verification work
is the right answer, instead of burying it inside a currency where nobody would look for it.

**Note, 2026-10-09** (decided, not built). Crews and units hold no ceiling, rungs or Honor unless
11.5 designs them as bodies, so a wipe or a removal strands nobody's writs
([`groups.md`](groups.md) §10, [`units.md`](units.md) §4). A unit that posts missions in its own name
is a body under this section. Its offers and orders count against the ceiling its members delegated;
a higher unit holds only what its units delegated, and a unit that leaves takes its delegation back
(units.md §10 and §11). How a body's Honor, rungs and ceiling survive one member's wipe is 11.5's to
settle.

---

## 7. Settlement when the poster has vanished

**Decided 2026-10-06: a report auto-settles after a challenge window, and says that it did.**

Money already self-heals — the §4 locktime returns an unreleased bounty without anyone's help. What
stranded was *standing*: nothing could settle the mission, so the operator earned nothing.

Fairness decides this. **The operator has sunk unrecoverable cost — fuel, hours, risk — through no
fault of their own.** Leaving it permanently unsettled transfers the whole loss to the blameless
party. Requiring a witness fails for solo work, and Alone is the declared default, so that option
systematically penalises the operators this project calls the common case.

The objection is a false report minting standing unobserved. Priced out, the payoff collapses: no
counterparty exists to move Karma, Honor-to-ceiling is bounded by a body that is absent, and what
remains is **Hours, which §4 already calls a record rather than a score.** A small bounded gain
against a large real protection.

One refinement makes it right rather than merely defensible: **the settlement names how it happened.**
*Settled by poster* and *settled unchallenged* are different facts and must not be laundered into one
word. The weaker evidence stays visible, as a readout rather than a score, and a reader judges it.

The window is the **fallback, not the only path**. A witness may settle immediately, and so may the
sponsoring body — a body outlives whoever posted in its name. The claimant's view reads *reported —
settles 20 Oct unless challenged*, and asks nothing further of them.

---

## 8. The challenge, which needs no adjudicator

**Decided 2026-10-06.** A challenge window of **seven days** — long enough for somebody who was
there to notice, short enough that an operator's standing is not held hostage by silence.

**Anyone who can see the mission may challenge it**, and a challenge is a **signed statement under
their own name**, never an anonymous flag. That is the same answer this project gives everywhere:
provenance by name, because a number or a flag invites gaming and a name does not.

And the part that makes it buildable: **a challenge does not get resolved, because nothing is being
adjudicated.** It does not reverse the settlement and it does not summon a judge. The readout changes
from *settled unchallenged* to *settled, challenged by <name>*, both statements stand, and the reader
decides what to make of it. There is no tribunal, no quorum, no vote — consistent with the standing
refusal to let anything here judge, and with there being no authority in this system to appeal to.

---

## 9. The numbers, as first guesses

**None of these can be reasoned to from here.** They are starting values with a stated rationale so
they can be argued with and moved once there is traffic. Recorded rather than embedded in code
comments, so that moving one is a decision rather than a tweak.

| | Value | Why this number |
|---|---|---|
| **Setup grants** | ceiling of **1** | One open mission. Enough to act, not enough to flood |
| **Founding a body** | **5** ceiling, transferred in | Under conservation this is either one person who earned five rungs, or **five people each putting in their only writ** — a body that exists because five humans committed their single ask to it, which self-selects for real groups |
| **Claim concurrency cap** | **3**, raised by rung | A real night in one area might be two or three missions. Fifty is the attack |
| **Karma band** | stable within **−50 to +50** | Ordinary standing does not drift |
| **Karma decay** | **0.4/day** down above +50; **0.2/day** up below −50 | RimWorld's own asymmetry, and the moral shape is right: good standing is harder to hold than a bad record is to escape |
| **Hysteresis** | trusted at **+75** until it falls to **0**; distrusted at **−75** until **0** | Survives one bad night, does not survive a pattern |
| **Challenge window** | **7 days** | §8 |

**What moves Karma, and what must not.** Two events move it *mechanically*, because both are provable
from public data: a **released bounty raises** the recipient's standing with the payer, and a
**bounty left unreleased to its locktime lowers** it — sharply, per the asymmetry above. Everything
else is the counterparty's own judgement, bounded by the band so it cannot become a weapon.

**Abandoning a claim must never reduce Karma.** Invariant 8 says abandoning costs nothing, and a
reputation penalty is a cost. This is the rule most likely to be violated by accident later, because
a stream of abandoned claims looks exactly like something a conduct score should notice.

**Still stands, 2026-10-09.** No Karma is lost for declining anything in a unit, at any authority
level ([`units.md`](units.md) §10). Under the one level where declining an order that names a member may
lead to removal from that unit, the removal touches nothing outside it: no Karma, Hours, Supply,
Intel or Honor. Separately, the claim cap *raised by rung* above is not conserved by §6, and is
recorded as an open item for 11.5 and 11.6 ([`groups.md`](groups.md) §10).

---

## 10. Still open

- **Bounties and unpaid missions share one map**, funded clearly marked and filterable (decided).
  The volunteer research's warning applies and is accepted knowingly: visible pay nearby makes
  unpaid work read as a chore, and the filter is the mitigation.
