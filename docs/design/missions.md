# Missions, Standing and the Grid

**A proposal, not a build.** It exists because the maintainer reversed invariant 6 on 2026-10-05:
*nothing tasks anyone* has been holding the product back from being a product, and a directory with
no reason to return is a bulletin board. Missions are the reason to return — something to do, and a
record of having done it.

Nothing here is implemented. Nothing in `CLAUDE.md` has been changed. §7 proposes what the invariant
list becomes, and that is the maintainer's to accept, line by line, before any of it is true.

## 1. What is actually changing

| | Before | After |
|---|---|---|
| The landing page | A search box over a directory | A map and a comms panel, populated on open |
| The unit of work | A record somebody corrected | A mission somebody takes, does and reports |
| Who may ask | Nobody. There was no dispatch verb | A person, an organisation, a faction, or an agent |
| What accrues | Provenance on records, by name | Standing, in several kinds, per context |
| Who decides | The maintainer, for everything | Whoever has jurisdiction, and votes where nobody does |

The directory stays, because it is what the missions stand on: a mission to check a shelter's hours is
only possible because the shelter is a record. **The watch stays**, because somebody has to be
reachable when a person out there is in trouble, and that was never the part that needed changing.

## 2. Users, organisations, factions, alliance

Four tiers were sketched; **a tree is the wrong shape** and the sketch already broke it. The Tho'ra
Clan sits outside the Earth Alliance while Archangel Agency umbrellas the Archangel Knights, and an
agent operates inside two contexts at once. A hierarchy cannot hold that without lying.

**Model it as overlapping sets that each carry their own rule for consent.** A key belongs to any
number of them; each decides for itself who may post in its name and who approves what. The Alliance
is one such set that happens to contain many others, not a root that owns them.

| | What it is | Who decides |
|---|---|---|
| **Operator** | A key with a card | Themselves, always |
| **Crew** | A handful of people who work together | Whoever founded it, or everyone in it |
| **Organisation** | A standing body with a name others recognise | Its own leadership, declared |
| **Faction** | A banner several bodies work under | Its own rule, which may be a vote |
| **Alliance** | A set of factions that accept one charter | The charter, and only inside it |

Nostr already has two shapes for this and they make the trade explicit.
[NIP-29](https://nips.nostr.com/29) puts a relay in charge: membership and roles are enforced by the
relay, which is strong access control and **a server back in charge of who exists**.
[NIP-72](https://nips.nostr.com/72) defines a community as an event with a moderator list, which keeps
it on the open wire and is marked unrecommended in favour of 29.

**Neither is right as-is**, because both answer *who may post* and this network's question is *whose
word counts*. The primitive we already have answers it: a credential is *"I vouch for the holder of
this"*, handed over rather than indexed, and a claim binds it to a persona. **Membership is a
credential, not a row in somebody's table** — which means an organisation can exist without a relay's
permission, and nobody can enumerate its members from outside.

## 3. Missions

Three kinds of mission, and the difference is who may approve them:

- **Personal.** One operator's own: a thing they intend to do, published or not. Nobody approves it.
- **Open.** Posted for anyone to take. The poster approves what counts as done, or delegates that.
- **Sponsored.** Posted in an organisation's or faction's name, under its rule.

And a fourth that already exists: **foreign** missions, read from elsewhere. Archangel publishes 90
Mission Packages on their own relay today, 14 of them marked `t=navcom_mission` for work needing
somebody physically present. We read those; we do not own them.

### The lifecycle, and where it can lie

```
drafted → open → claimed → reported → settled
                     ↘ abandoned        ↘ disputed
```

**A claim is exclusive, and you may hold only a few at once** (decided 2026-10-05). Exclusivity is
what makes a claim mean anything, and it is also an attack: one person claims everything and lets it
all expire, denying the map to everybody. Charging for abandonment would violate invariant 8, which
says abandoning costs nothing — so the defence is a **concurrency cap** instead. Walking away stays
free; holding fifty does not happen.

**`claimed` is the dangerous state.** A claim is a public statement that a named person intends to be
somewhere doing something — which is the pattern the Doxxer reads, and the reason presence was never
published. Three defences, and the design needs all of them: a claim names a mission rather than a
place and a time; **visibility is asked at the moment of claiming**; and a claim expires by itself.

**Asked each time, not set once** (decided 2026-10-05). A preference buried in settings is a decision
somebody made in a different mood about a different mission, and the whole risk here is that the two
are not alike: taking a daylight supply run in your own neighbourhood and taking a 2am welfare check
across town are the same verb and nothing else. So the claim control carries two options and one line
each saying who will see it — *the poster only* or *everyone* — and no default is preselected. The cost
is a decision at the moment somebody is trying to move, which is the worst time to ask; the answer is
that the question is one tap wide and the options are two, so the ask is smaller than the exposure it
prevents. A mission still reads as taken on the grid either way: **what a private claim withholds is
who, never that.**

**An agent may claim too, where the poster allowed it** (decided 2026-10-06): only an objective whose
`takers` includes `agent`, shown marked as an agent's and counted like any other claim. The mark is
invariant 4; the wire form is in the interchange spec, §4.7.

**Four rules for a claim, worked out as a game** (decided 2026-10-06). The players are the claimant,
the other operators, the poster, and three adversaries — a griefer who claims to lock, a doxxer who
reads claims, a sybil whose identities cost nothing — with the people served bearing the cost of
work left undone. Each rule is the one under which honest play costs least and the adversary gains
least.

- **A lease, not a lock: a day, or the mission's end if sooner, renewed with one tap.** An unbounded
  lock pays the griefer and strands a forgetful operator's task; a day caps the griefer at three tasks
  a day per persona, caps how long a public claim says where somebody intends to be, and keeps the
  poster's "is anybody behind it" true to within a day. Lapsing costs the honest operator nothing,
  because a report is accepted if any claim came before the mission's end.
- **Letting go is the same for public and private claims: a `released` label, open or sealed.** If a
  private claim could not be withdrawn, privacy would carry a hidden price, and the rational choice
  would be to claim in public to keep the option. The griefer gains nothing either way.
- **The poster publishes how many are taking part — operators and agents apart, never names.** Only the
  poster can see private claims, so any count a device made would leave the private claimants out and
  distort exactly the coordination it exists for; it would also send every visitor to public relays.
  The poster already reads every claim and has every reason to report it truly. Until it does, the
  count reads unknown.
- **Sign on before taking part.** Both kinds of identity are free, so this is not about sybils. Every
  mission here is field work, and nobody should set out without `Distress` in their pocket; signing on
  asks for a callsign and nothing else, and the mission reopens when they come back.

**`settled` is where the points come from, so it is where the gaming comes from.** Who settles:

| Model | Works when | Fails when |
|---|---|---|
| The poster says | They care about the outcome | They are absent, or they are the claimant |
| A witness says | Two people worked together | Nobody else was there |
| Evidence says | The thing is public — a shelf, a notice, a shelter list | The evidence would be a person |
| Nobody says | The work is its own reward | Points are attached |

**Images are carried only where the poster asked for them** (decided 2026-10-05). A mission declares
what settles it, and images are off unless that mission opted in — which puts the choice with
whoever defined the work and spreads it across many people rather than one blanket rule. The ban
below is not one of the things a poster may opt into.

**Evidence must never be a photograph of a person**, and that is not a style rule: it is the one
invariant that protects somebody who never agreed to be in this system. A mission that can only be
settled by proving what you did *to* a person is a mission this network must refuse to carry.

## 4. Standing, in kinds

A single score is the thing that gets farmed, and a single score is what makes two people comparable
on one axis they did not choose. **There is no total. There is no umbrella term.** Each of these
answers a different question, and a reader weighs whichever one their question needs.

| | Answers | Earned by | Spent on |
|---|---|---|---|
| **Honor** | *How far have you come with them?* | Settling missions for a particular body | **Rungs, which raise your Writ ceiling** |
| **Karma** | *Will they work with you again?* | Conduct toward one counterparty | Nothing. It is a condition, not a balance |
| **Hours** | *How much have you actually done?* | Time on settled missions | Nothing. A record, not a score |
| **Supply** | *What have you moved?* | Materiel carried and handed out | Nothing, and it is the realest of these |
| **Intel** | *What do you know that the grid did not?* | Raw observations that were refined downstream | Nothing |
| **Writs** | *May you ask others to do things?* | Granted by a body, or by setup | **Caps how many missions you have open** |
| **Sats** | *Did somebody pay?* | Zaps, from whoever chose to | Itself |

### Honor and Karma are a consumable and a condition

**Revised 2026-10-06, and it resolves a real objection.** These two were previously both accumulating
scores, which made them substantially the same measurement double-entered: settling one sponsored
mission raised Honor with the body *and* earned Karma from the body's delegate, one event incrementing
two counters. Reading RimWorld's two systems properly supplied the distinction, and it is structural
rather than cosmetic.

**Honor is vertical: rank inside one hierarchy, and it is spent.** RimWorld's royal favour is a
currency, held per-pawn, exchanged for *titles* — and a title grants **permits**, which are the right
to call in aid on a cooldown. That is a Writ, arrived at from the other direction. So Honor buys
**rungs** with a body, and a rung raises your Writ ceiling with that body. It is per-body and never
global: Honor with the Tho'ra Clan says nothing about your standing with a mutual aid network in
another city, and a design that adds them together has invented a rank.

**Karma is horizontal: a condition, per counterparty, and it is never spent.** RimWorld's goodwill
runs −100 to +100 *with each faction separately*, and four of its properties are worth taking for
reasons this document already needed:

| Property | Why we want it |
|---|---|
| **Bounded range** | There is nothing to farm past the cap. Everyone decent converges at the top, so it reads as a status rather than a rank — the cheapest possible answer to farming, needing no detection and no adjudication |
| **Decays toward neutral** | Standing must be maintained, which answers the early-joiner's permanent advantage without a display-windowing hack |
| **Losses larger than gains** | Trust is slow to build and fast to destroy. This is the missing ingredient in the bounty game: a withheld bounty must cost far more than a paid one earns |
| **Hysteresis** | RimWorld makes you an ally at +75 and keeps you allied until 0. A relationship survives one bad night and does not survive a pattern |

**It is per-counterparty including individuals**, which closes the gap that made deleting Karma
impossible: an operator who works only with people and never joins a body still accrues standing with
each of them.

**Governance weight is Honor rank within the body being voted in**, not Karma. A global number
weighting a vote inside one body imports standing earned somewhere else, and rank conferring privilege
is what titles already do.

Two consequences, both accepted. **A new operator is at neutral, not at a deficit** — the UI reads *no
history with you* rather than a score of zero. **Karma is not a safety mechanism and must never be
rendered as one**; what protects somebody from a person who behaved badly is the account of what
happened, carried by whoever was there.

**A rung's obligations are the body's to set** (decided 2026-10-06). RimWorld titles make demands —
apparel, a throne room, a refusal to do menial work — and that cost is what gives rank weight. Here
each body declares what its own rungs expect, so a disciplined crew may be demanding and a loose one
need not be. It is compatible with invariant 8 because the obligation is stated before the rung is
accepted and the rung is never assigned. The accepted cost is that the same rank means different
things in different bodies and nothing is comparable across them — which is the same property Honor
already has, and the same one that makes it a relationship rather than a level.

**Writs are the one I would not skip.** Every open posting system drowns in postings, and the usual
answers are moderation queues and reputation thresholds. A writ is cheaper and more honest: the right
to ask something of other people is **scarce and granted**, so an organisation's limit is its own, and
a stranger with no standing cannot flood the map. It is also the sink the other currencies lack.

**They are a ceiling, not a balance** (decided 2026-10-06). This architecture keeps no ledger, so a
balance is unverifiable — but a ceiling on how many missions you have *open* is a function of public
data, which every relay and every reader can evaluate independently and identically. Spending is
implicit in posting and refund is implicit in the mission closing. Full reasoning, including why a
blockchain would buy the wrong property, is in [`economy.md`](economy.md) §1 and §2.

**Sats are offered, never counted.** A zap receipt is not proof of payment — NIP-57's own receipt only
shows that somebody fetched an invoice and that the recipient's server says it was paid, and a
compromised server can fabricate them. So money may be **offered on a mission and paid directly**, and
no standing may ever be minted from a receipt.

**Updated 2026-10-06, and the rule got stronger rather than weaker.** A NIP-61 nutzap is a
P2PK-locked Cashu token *in which the payment is the receipt* — not a claim about money but the
money itself, locked to the recipient's key. So payment can now be proven without trusting
anybody: receipts are still worth nothing, bearer tokens are worth their face value, and standing
is still never minted from either. The escrow this makes possible, and why it locks at claim time
rather than at posting, is in [`economy.md`](economy.md) §4.

**Writs are not purchasable, and the way money gets in is a separate lane** (decided 2026-10-06,
resolving a contradiction with CLAUDE.md that this table carried for a day). An unpaid mission is
posted against a Writ; a bounty is posted against locked sats. They are **alternatives, not
convertibles** — so money never becomes the right to direct unpaid volunteers, and it is not
banned either. [`economy.md`](economy.md) §2 and §4.

## 5. Gamification, against the evidence

The research does not say *do not gamify*. It says something sharper and more useful.

- **Rewards that affirm competence or values crowd motivation *in*. Rewards that feel controlling
  crowd it *out*.** The same badge does either depending on whether it reads as *you are good at this*
  or *do this to get the thing*.
- **Among volunteers specifically, merely mentioning extrinsic rewards reduced intrinsic motivation**,
  and obligation-flavoured motives correlate with lower participation, not higher.
- Points, levels and leaderboards by themselves were found in at least one controlled study to raise
  performance without touching autonomy or intrinsic motivation. They are not poison. They are not
  the mechanism either.

What that buys us, concretely:

**Build:** mission progress and objective tiers, because a mission with primary, secondary and
tertiary objectives is a structure people already enjoy. Honor as visible standing with a body you
chose. Streaks that are **yours to define and yours to see**. Named recognition — provenance by name
has been this project's answer since the beginning and it is also, by the research, the
crowding-*in* shape.

**Think hard before:** leaderboards that rank people against each other, and public per-person
totals. The maintainer has chosen the full stack including comparison, and these are the two that
carry a cost nothing else here does: a public ranked list of who did the most street work in a city
is **a target list sorted by commitment**, and the project already names that adversary. If they ship,
they should be **opt-in**, **per-body rather than global**, and should rank *missions and crews* more
readily than individuals.

**Do not build:** anything that pays per task in points *and* says so up front, which is the exact
shape the volunteer research warns about; or any aggregate score across the kinds in §4.

## 6. Approval, and why votes are not the default

The maintainer's instinct is right and the data supports it: **73% of DAO proposals get under 10%
participation, 41% under 5%**, and quadratic voting amplifies a sybil's weight by between 1,172× and
4,039× without a proof-of-personhood layer nobody here has.

So a vote is an **escalation**, not a gate. The ladder:

1. **The poster decides.** Their mission, their call. Covers personal and most open missions.
2. **Jurisdiction decides.** A mission in a body's name goes by that body's declared rule — a leader,
   a council, or a vote if the body says so.
3. **Optimistic by default.** A mission goes live on posting and stays unless challenged inside a
   window by somebody with standing in that context. This is what makes it possible to not be
   bothered: approval is silence.
4. **A vote settles a challenge**, weighted by membership and conduct rather than by anything
   purchasable, and only among the body concerned.
5. **An agent approves its own.** Mecha Jono settles the missions it posted, as its own publisher,
   because `done` is already the publisher's view in its design and no human should be in that loop.

## 7. The invariant list, proposed

The maintainer asked for a new list rather than a patch. Here it is, with what each protects and who
loses if it goes — the three groups being **the people served**, **the operators**, and **the project**.

### Stays, unchanged — these protect somebody who never agreed to be here

1. **Nothing is recorded about the people being served.** No field, no convention. *Loses: the people
   served, who cannot consent and cannot leave.* A mission settled by evidence about a person is
   refused by this rule, which is why §3 says what it says.
2. **`Distress` terminates in a human, or tells the operator it couldn't.** *Loses: an operator in
   trouble.* Missions do not touch this and must not borrow its channel.
3. **Duress is always deliberate.** *Loses: an operator being coerced.*
4. **Agents are always identified as agents.** *Loses: everyone, when a machine's word is taken for a
   person's.* More necessary now, not less: agents will post missions.
5. **Panic wipe destroys the Wipeable tier and nothing else.** *Loses: an operator whose phone is
   taken.* Claims, drafts and mission history are Wipeable by default.
6. **No legal names anywhere.** *Loses: an operator.* Standing accrues to a persona.
7. **Volatile data shows its age.** *Loses: somebody at a locked door.* Applies to missions too: an
   expired mission says so.

### Changed

8. **Was: nothing tasks anyone.** **Becomes: nothing tasks anyone *without their asking*.** A mission
   is an offer. Taking one is the operator's act, abandoning it costs nothing, and no mission may be
   assigned to a named person who did not claim it. *What the old rule protected: an operator being
   dispatched by a screen. What the new one keeps: the claim is always theirs.*
9. **Was: the watch state is visible before sign-on.** **Unchanged in force, extended in scope:** a
   mission shows whether anybody is actually behind it before you commit to it. The same honesty, one
   object over.

### Withdrawn

- **No feed.** A populated panel on open is a feed, and that is now the point. *What is kept: no
  notifications that demand attention, and nothing that marks you late.*
- **No count of anything.** Replaced by §4's rule: many kinds, no total, nothing purchasable.
- **No map.** Withdrawn by decision on 2026-10-05, with the device floor formally raised.
- **No streaks or badges.** Withdrawn, with §5's distinction replacing it: affirm competence, never
  control.

### What I would not withdraw yet, and why

**Escalation stays a separate process from everything in this document.** A compromised mission
system must not be able to impair the thing that wakes a human when somebody is hurt. That is the one
piece of the old architecture whose reasoning missions do not touch.

## 8. What this costs, measured where measurable

- **The root console's budget.** 80.6 kB of 95 kB of JavaScript today, 96.1 kB of its 120 kB page
  budget. A vector map and a live panel do not fit; the floor was raised by decision, and the budget
  numbers need rewriting with it rather than quietly exceeded.
- **Tiles are bandwidth.** The CDN allowance hit 81.7% in a single day two days ago from crawlers
  alone. Vector tiles for a national map are the largest recurring cost this project would have, and
  they belong on somebody else's CDN or in a paid tile account, not on the deployment that serves the
  directory.
- **Moderation.** Open posting plus points equals spam with an incentive. Writs (§4) are the structural
  answer; a reporting path and somebody who reads it is the human one, and that is a role this project
  does not have.
- **The claim surface.** Everything in §3 about `claimed` is a new public-behaviour signal that did not
  exist before. It is the single biggest change to what this network leaks.
