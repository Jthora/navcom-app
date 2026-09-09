# Profiles

A card is the one artifact an operator chooses to be findable by. This is what it may say,
who may find it, and the two places where the obvious design would have been a lie.

Normative source for the event itself: [`spec/signals.spec.md`](../spec/signals.spec.md).
The object is `KIND_CARD = 10911`, built in `packages/core/src/events/public.ts`.

## 1. Registration is publishing a card

There is no sign-up, no account and no approval. An operator who publishes a card has
registered; an operator who has not is complete without one, and the app works identically.
That is not a simplification of a registration system — it is the absence of one, and it is
why there is nothing to revoke and nobody who could revoke it.

**Anyone may publish a card.** A card is therefore a claim by its holder and nothing more.
No entry on any board has been checked by anybody, and every surface that renders one must
be as plain about that as the directory is about its 8,430 unvisited records.

## 2. What rides where, and why it matters

| | Lives in | Enforced by |
|---|---|---|
| callsign, region, `doing`, `lightning` | `content` | `CARD_FIELDS`, refuse-not-trim |
| where else to find them | `i` tags | dropped individually, never fatal |
| what they do | `t` tags | closed vocabulary, dropped if unknown |
| who can find it | presence of the `d` tag | the relay's own filter |

The split is not tidiness. `CARD_FIELDS` is enforced **refuse-not-trim**: `readCard` returns
`null` for a card carrying a field it does not know, which is correct for content — the field
somebody will eventually try to add there is a coordinate — and catastrophic for anything new.

Adding a `links` field would mean every client running an older build reads a card with links
and gets nothing. Not a card without links: **no card**. The operator would silently vanish
from their region's board for everyone who had not updated, and this ships as a PWA behind a
service worker, so "everyone has updated" is not a date anybody picks.

`readCard` never reads `event.tags`. Everything added from now on therefore arrives beside
the content rather than inside it. See `events/links.ts` for the full argument.

## 3. Two visibility tiers, because two of them are true

The obvious design is **public / internal / private**, where internal means *only people who
registered can see this*. NavCom cannot offer that, and must not appear to.

There is no account, no server and no gatekeeper anywhere in this system. A card is an event
on public relays, and a relay serves what it likes to whoever asks. Anyone may connect to the
same relays with any client and read every card on them. A setting labelled "internal" would
change nothing about who can read a card — it would only change what an operator *believes*
about who can, which is invariant 4's failure pointed at visibility instead of the watch.

So the tiers are:

| | Means | How |
|---|---|---|
| **On the board** | Anyone browsing your area finds you | the `d` region tag is published |
| **Address only** | Only somebody you give your address to | the `d` tag is absent |
| *Sealed* | Only people you have accepted | **not built** — see §7 |

**Address-only is real, and the mechanism was already here.** Kind 10911 is replaceable, keyed
by pubkey and kind — the `d` tag is not part of its identity, it is a query filter, and
`buildCard`'s own comment said so before any of this: tagged by region *"so a client can ask
one relay for one metro"*. The board subscribes `#d: [region]`.

A card published without that tag **cannot match any board's filter**, while staying readable
by anyone who fetches it by author key. Delisting is the absence of a tag rather than a flag
some other client has to honour, which is the only kind of visibility claim worth making here.

The region still travels in `content`, so somebody holding your address still learns your
metro. Address-only means *not on a board*. It does not mean secret, and no screen may say
otherwise — the copy says *"your card is still published"* out loud, and a test asserts it.

## 4. The names, and why not the other names

Two rules decided these.

**Name the audience, not the category.** A category name can be believed to mean more than it
does — "internal", "restricted" and "members only" all invite a reader to imagine a wall that
is not there. A sentence about who can see something cannot be misread the same way. So every
choice carries its audience beside it, and the audience sentence is the load-bearing part;
the label is only a handle for it.

**Use the system's own noun.** "The board" is already what this app calls the place cards
appear. A setting named after it makes the mechanism visible instead of abstract: you are
choosing whether to be on the board, which is exactly what the `d` tag decides. Options that
were considered and dropped — *Listed / Unlisted* (accurate, but borrowed from a video site
and says nothing about where), *Public / Private* (the second word is false here), *Findable
/ Hidden* (worse: "hidden" is the claim we cannot make).

## 5. What an operator says they do

`t` tags, from a closed vocabulary, at most three.

**The vocabulary in `events/profile.ts` is a placeholder and needs a person.** Extending a
taxonomy here needs local knowledge and is explicitly not agent work; the terms shipped are a
working set so the mechanism could be built and tested, not a considered answer. The schema,
the cap, the refusal and the rendering are real. The words are not final.

**Every term describes an activity, never a qualification.** This is the rule that matters. A
card is self-asserted and nobody checks it, so a tag reading `medic` would be an unverified
competence claim, and somebody picking a "medic" off a roster at 2am is the Medic's kill
trigger — confident wrong guidance, which this project holds to be worse than none. `firstaid`
therefore means *carries a kit*, not *is trained*, and says so in the picker.

Vouching for competence is what [`endorsement.ts`](../../packages/core/src/events/endorsement.ts)
is for. A credential is checkable and a tag is not, and the two must never be made to look
alike.

Three is the cap because a card claiming nine things says nothing, and an unbounded list is
how a self-asserted vocabulary becomes a keyword-stuffing surface.

## 6. Qualifications, and the three rungs of checkability

A qualification claim is only worth anything if the reader can check it. That single rule
sorts everything here, and NavCom already has two rungs of it:

| | Says | Checked by | Where |
|---|---|---|---|
| Activity tag | *carries a kit* | nothing — it is not a qualification | `events/profile.ts` §5 |
| Peer credential | *I vouch for the holder as a medic* | a signature, offline | `events/endorsement.ts` |
| **Institutional** | *RN, licensed by this board* | a public lookup | **not built — see below** |

The activity vocabulary deliberately never claims competence, because it is self-asserted and
self-assertion is not a check. `SCOPES` already includes `medic`, vouched by a peer and
verifiable by anyone holding the credential. The third rung is the one that does not exist.

### The existing primitive cannot carry it, and not for a small reason

A NavCom credential is a **bearer token**: *"I vouch for the holder of this"*, carrying a scope
and a date and no subject at all, binding to whatever persona claims it. That is right for peer
vouching — you hand it to the person, and the absence of a subject is why no social graph of
this network exists to breach.

It is wrong for a licence. **A licence that transfers to whoever holds it is not a licence.**
Making one subject-bound needs a subject identifier, which needs a legal name or a DID, which
is invariant 8 and the whole bearer design at once. This is a shape mismatch, not a gap.

### A licence number is a legal name with extra steps

The obvious workaround — store the issuing body and the number, never the name, let the reader
look it up — sounds like it respects invariant 8 and does not.

*RN, Missouri, #12345* published on a public relay resolves in one free public hop to a legal
name, a city of record, disciplinary history and often an employer. Describing that as "we
store no name" is true about the field and false about the effect. It is the same error as
calling an address-only card private: **judge a field by what it reveals, not by what it
literally holds.**

Invariant 8 already carries one opt-in exception — *"contact details only where an operator
opted in for themselves"* — so the honest framing is that institutional credentials would
**widen that exception from contact details to identity documents.** That is a real widening
and has to be decided as one, not reached by a clever reading of the letter.

### Three questions, none of them technical

- **Does invariant 8's opt-in clause widen to identity documents?** See above.
- **Does displaying credentials pull NavCom toward coordinating care?** A roster showing a
  verified clinician invites *"get the clinician"* — dispatch by social pressure rather than by
  button, against invariant 6. And the Medic's kill trigger is confident wrong guidance; a
  credential makes guidance more likely to be sought here, which is a direction this project
  has refused elsewhere by declining to write playbook content.
- **Is NavCom *for* people without an institution, or merely usable by people with one?**
  `CLAUDE.md` says *"everyone here works without an institution behind them, so the only thing
  that can carry belief is what they can show"*, and describes the whole system as
  infrastructure for **acting without authority**. Institutional credentials are the
  presentation of authority. Not fatal — a nursing licence does not authorise street outreach
  either — but it is positioning, and positioning is not an engineering call.

### What is actually being asked for is narrower than it looks

**Nobody is blocked.** A social worker, a street medic or a lawyer can publish a card, record
patrols and file corrections today; none of that is gated on being RLSH. The only missing
capability is *proving an institutional qualification*, which is presentation, not access.

### Two costs, if it is built anyway

- **It ends pseudonymity permanently, and more completely than a handle does.** A handle links
  an operator to an account they control; a licence links them to a government record they do
  not. The warning has to be at least as blunt as the handle join's, and it is a larger step.
- **It must never render as a tier.** An operator working pseudonymously cannot obtain
  institutional credentials by definition, so a badge would rank them permanently below a
  credentialed professional for reasons unrelated to the work — against the board's standing
  refusal to rank anything. Same treatment as activity tags: no badge, no checkmark, and no
  way to sort or filter by it.

### Recommendation: write it down, do not build it

`declined.md` set this exact test for crew federation — *"there is no allied agency; building
federation before anyone asks is designing against an imagined counterparty"* — and that entry
was **reversed on 2026-09-03 the day Archangel actually asked**, with the counterparty real and
the shape designable against them. The test works.

No credentialed professional has asked for this. When one does, the shape they need will be
decided by who they turn out to be, and this section is what they will be designed against.

**Meanwhile the cheaper thing already works:** a nurse who does three nights with a crew can be
vouched for by that crew, on the existing peer credential, checkable by signature, naming
nobody. It measures demonstrated competence in this context rather than institutional training
in another — which is arguably the better signal here, and needs no invariant changed.

## 7. Open

- **Sealed cards.** A genuinely private card is an encrypted one, addressed to a holder set —
  the machinery `transport.ts` already has for signals. Named here so the gap stays visible
  and nobody adds a third radio button that does nothing.
- **The activity vocabulary.** §5. Needs a person, same as the Raw Intel tag vocabulary.
- **Whether a card can be a group.** `crew` is currently one term among the activities, which
  is a placeholder for a structural distinction that probably deserves its own field. Deciding
  that is taxonomy work, so it waits for the same person.
- **A global roster.** Cards are only ever subscribed one region at a time
  (`{kinds: [10911], '#d': [region]}`). There is no "everyone on NavCom" view and no way to
  ask for one, which is a deliberate absence to re-decide rather than a gap to fill.
- **Institutional credentials.** §6. Written down, not built, and reversible the day a
  credentialed professional actually asks — the test `declined.md` set for crew federation and
  which that entry passed on 2026-09-03.
- **Handle proofs.** `i` tags carry a NIP-39 proof field and almost nothing fills it, because
  verifying one means fetching it and most platforms refuse unauthenticated reads. Until then
  a handle is a claim, and is rendered as one.
