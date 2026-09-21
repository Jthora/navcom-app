# Notices

What happens when somebody tells whoever maintains navcom.app that a card shown there is
unlawful, or sends a legal notice about it.

**There is no address yet, and `/notice/` prints none.** This procedure describes what happens
once an alias exists; until then there is no way to trigger it, which is a hole rather than a
decision — stated here because an earlier version of this line said the address was already on
that page, and a document claiming a channel that does not exist is worse than one admitting it
has none. What comes out of this procedure is an entry in `web/src/lib/hidden.ts` — see [`profiles.md`](profiles.md) §3 for that list and its
limits. It is written down before anybody is upset, for the same reason
[`build-order.md`](../build-order.md) 10.7 says a refund policy has to be.

**Why it exists at all.** Several of the protections a site showing other people's words can
have depend on two things: somebody could tell you, and you acted once told. The UK's
website-operator regulations, Australia's digital-intermediary defence, Quebec's IT framework
act and New Zealand's safe harbour all turn on that, and none of them asks for a legal name.
This is not legal advice, and it is not a promise of any outcome beyond the one stated under
*The clock*.

**Why it is shaped against its own misuse.** A way to make a card disappear on request is the
lever somebody patient would most like to hold — whether by capturing whoever operates it, or by
sending notices that are not what they claim. So nothing it produces is permanent, an unchecked
notice buys a fortnight rather than a silence, the author is told, and the public record says
only that a decision was made, never what anybody did.

---

## What qualifies

- **A legal notice** naming a specific card — a court order, a lawyer's letter, a regulator's
  request
- **Content that is unlawful** where navcom.app is read — a threat against a person, or somebody's
  legal name and home address published about them

A notice that does not say which card, or does not say why, gets a reply asking for both. The
clock starts when it arrives complete.

## What does not

- **A dispute between operators.** NavCom holds records, not verdicts — see
  [`declined.md`](../declined.md)
- **One card impersonating another.** Two cards can carry the same callsign; the key print beside
  each is what tells them apart. A complaint must never be how the second Raven removes the first
- **A claim that is wrong, unproven or distasteful** — including a claim that some piece of gear
  protects against something. That claim is its author's to answer for, and the key print and
  the notice page say so
- **A request to identify an author.** NavCom holds no identity to give. An order for what little
  exists goes to whoever holds it — a relay, the host — not through this address

## Only cards

The list covers cards and nothing else. **A place or correction somebody publishes from the field
cannot be hidden by it.** Something unlawful in the *published* directory is removed from
`data/regions/` by a person, the way any record is corrected; something unlawful in a live
correction on a relay is beyond this project's reach, and the reply to the sender says so.

## The clock

**48 hours from a complete notice to the card no longer being shown.** That equals the shortest
window that applies — the UK's and New Zealand's 48 hours where the author cannot be reached —
and is well inside Australia's seven days, so one clock covers all of them.

1. **Acknowledge** the notice from the alias, the day it arrives
2. **Find the card by its key.** The print on screen is the first sixteen characters; the full
   key is in the card's link
3. **Decide** against the two lists above:
   - it clearly qualifies — add it as `confirmed`
   - it clearly does not — reply saying so, and change nothing
   - **it cannot be checked inside 48 hours** — add it as `provisional`. It stops being shown
     for **at most 14 days** and then lapses on its own, on every phone, unless step 6 confirms it
4. **Deploy**, with the entry holding only a key, a state and a date
5. **Tell the author**, through any contact their card lists, or a Nostr direct message to the
   card's key. **NavCom's own app does not display direct messages**, so do not treat one as
   delivered, and say in the reply to the sender which of the two was tried. Their own card
   screen also says the card is not shown. Tell them whether the hide is provisional, and where
   to answer
6. **Within the fortnight, for a provisional hide:** confirm it — change it to `confirmed` with
   today's date — if it holds up, or remove it if it does not. Doing nothing lets it lapse, which
   is the safe default for a claim nobody could check
7. **Reply** to the sender saying what was done: the card is no longer shown on navcom.app, relays
   may still carry it, and other apps may still show it
8. **Keep the notice** wherever correspondence is kept. Not in the repository

## Every ninety days

**The build refuses to ship while a confirmed entry is more than 90 days old.** Re-date each entry
whose reason still stands, and remove the rest. A hide cannot persist because nobody remembered
it was there, and the list cannot quietly accumulate.

## Many notices at once

Each notice is judged on its own card. **A batch of notices from one sender about cards that share
nothing but a cause is itself a reason to slow down**: they are provisional at most, they lapse,
and nobody is obliged to confirm a claim they could not check.

## What is recorded where

| | Where | Public |
|---|---|---|
| Key, state, date | `hidden.ts` | Yes |
| The notice, who sent it, the reasons | The maintainer's correspondence | No |
| A notice that did not qualify, and why | The maintainer's correspondence | No |

The public record says a decision was made and its state, never what anybody did: a reason or
an accusing label would be an accusation about a pseudonymous person, published by the one party
who cannot check it, and git history keeps it after the entry is gone.

**Notices are kept indefinitely**, because they are the evidence that this procedure was followed
if anybody later asks whether it was. The cost is stated rather than managed: a file of
accusations about pseudonymous people that only grows, and that a subpoena or a breach could
reach.

## One person on a clock

The alias is watched by one person. **A notice that arrives while they are away can miss the
window**, and that is the real cost of a project with no institution behind it. Somebody else
able to deploy is [`build-order.md`](../build-order.md) 9.4, and it matters here as much as
anywhere.
