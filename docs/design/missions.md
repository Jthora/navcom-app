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

**`claimed` is the dangerous state.** A claim is a public statement that a named person intends to be
somewhere doing something — which is the pattern the Doxxer reads, and the reason presence was never
published. Three defences, and the design needs all of them: a claim names a mission rather than a
place and a time; a claim may be **private to the poster** at the claimant's choice; and a claim
expires by itself.

**`settled` is where the points come from, so it is where the gaming comes from.** Who settles:

| Model | Works when | Fails when |
|---|---|---|
| The poster says | They care about the outcome | They are absent, or they are the claimant |
| A witness says | Two people worked together | Nobody else was there |
| Evidence says | The thing is public — a shelf, a notice, a shelter list | The evidence would be a person |
| Nobody says | The work is its own reward | Points are attached |

**Evidence must never be a photograph of a person**, and that is not a style rule: it is the one
invariant that protects somebody who never agreed to be in this system. A mission that can only be
settled by proving what you did *to* a person is a mission this network must refuse to carry.

## 4. Standing, in kinds

A single score is the thing that gets farmed, and a single score is what makes two people comparable
on one axis they did not choose. **There is no total. There is no umbrella term.** Each of these
answers a different question, and a reader weighs whichever one their question needs.

| | Answers | Earned by | Spent on |
|---|---|---|---|
| **Honor** | *Whose word do you keep?* | Settling missions for a particular body | Nothing. It is a relationship, not a balance |
| **Karma** | *How do people find you to work with?* | Others' judgement of conduct | Weight when a faction votes |
| **Hours** | *How much have you actually done?* | Time on settled missions | Nothing. A record, not a score |
| **Supply** | *What have you moved?* | Materiel carried and handed out | Nothing, and it is the realest of these |
| **Intel** | *What do you know that the grid did not?* | Observations and corrections that held up | Nothing |
| **Writs** | *May you ask others to do things?* | Granted by a body, or bought | **Posting a mission consumes one** |
| **Sats** | *Did somebody pay?* | Zaps, from whoever chose to | Itself |

**Honor is per-body, never global.** RimWorld gets this right: favour with the Empire is not a level,
it is a standing with somebody in particular, and it buys nothing from anyone else. Honor with the
Tho'ra Clan says nothing about your standing with a mutual aid network in another city, and a design
that adds them together has invented a rank.

**Writs are the one I would not skip.** Every open posting system drowns in postings, and the usual
answers are moderation queues and reputation thresholds. A writ is cheaper and more honest: the right
to ask something of other people is **scarce and granted**, so an organisation's limit is its own, and
a stranger with no standing cannot flood the map. It is also the sink the other currencies lack.

**Sats are offered, never counted.** A zap receipt is not proof of payment — NIP-57's own receipt only
shows that somebody fetched an invoice and that the recipient's server says it was paid, and a
compromised server can fabricate them. So money may be **offered on a mission and paid directly**, and
no standing may ever be minted from a receipt. If payment must be proven, the payer shows their own
wallet's record, out of band, to whoever is asking.

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
