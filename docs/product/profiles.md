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
| *Sealed* | Only people you have accepted | **not built** — see §6 |

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

## 6. Open

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
- **Handle proofs.** `i` tags carry a NIP-39 proof field and almost nothing fills it, because
  verifying one means fetching it and most platforms refuse unauthenticated reads. Until then
  a handle is a claim, and is rendered as one.
