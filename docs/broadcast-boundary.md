# What a broadcast may say about a facility

Written for anyone producing audio, video or an article that names a place in the directory.
Earth Alliance News and RevNow asked for this before writing a script, which was the right
order, and they were told twice in artifacts they had no reason to re-read. It lives here so
it can be fetched: `/.well-known/navcom-refusals.json` points at it.

**The governing risk is not privacy.** A shelter's address and posted hours are public, and
[invariant 1](../CLAUDE.md) governs people being served, not places. The risk is that a
broadcast makes the next phone call harder — for NavCom, for every other volunteer, and for
the person who needs the bed. *A facility that stops answering the phone is a worse outcome
than a facility described incompletely.* Every rule below is that sentence applied somewhere.

---

## The seven

**B01 — Never characterise who uses a place, or who was turned away.**
This is invariant 1 arriving in disguise. *"They mostly take families"* and *"somebody I know
got refused there"* are statements about people served wearing the grammar of a statement
about a building. Ask what the policy is; broadcast the policy.

**B02 — Never broadcast occupancy, or whether there were beds last night.**
Volatile by nature and stale on arrival — an episode is heard for months. The directory
renders volatile values past their window as **call first**, precisely because a
confident-sounding stale answer sends somebody to a locked door. A broadcast cannot render
*call first*, so it must not carry the value at all.

**B03 — No staff names, ever, including the person who was kind on the phone.**
Naming a helpful staff member routes every future caller to one person and can cost them the
discretion to be helpful. Invariant 8, applied outward.

**B04 — Every claim about a facility travels with its method and its date, or it is not said.**
*"As of the fourteenth, by phone, they said…"* If a producer cannot say how the claim was
learned and when, the sentence is cut. This is the network's derived-confidence rule at audio
bandwidth, and it is the whole reason an episode can be trusted at all.

**B05 — Quote what the place said. Never what an operator concluded.**
The gap between *"they said intake closes at nine"* and *"they close at nine"* is the gap
between an attestation and a fact, and audio erases it silently.

**B06 — No facility is characterised as good or bad.**
The directory routes people; it does not rate. A place described as hostile on a broadcast
that reaches its own staff stops taking the call that keeps its record accurate — and the
people who lose by that are the ones arriving at eleven. Report a rule, not a verdict.

**B07 — When something is unknown, say unknown.**
The directory's blanks are its most honest field, and the temptation in a script is to smooth
them over. *"Nobody has confirmed whether they take dogs"* is a better sentence than any
guess, and it is also the sentence most likely to make a listener pick up a phone — which is
the point of the episode.

---

## What an episode may freely say

That the directory exists. That it is thin. That in the seed metro nine places have a phone
number and nobody has called them. That fixing it takes an afternoon and no qualifications.
That an operator who knows a place the directory does not have can add it from the app.

**The weakness is the story.** None of it requires a single claim about a facility that is not
already public.

## How success is counted

Not downloads. **Directory records in the named metro that gain a `verified_by` and a method
of `phone` or better** — counted by NavCom, reported to the broadcaster, and published in
`/.well-known/navcom-refusals.json` so the before-figure cannot be revised after the fact.

The current metro, callable set and confirmed count are generated from the region data at
build time. They are in that file rather than in this document, because a number written in
prose is a number that goes stale the first time somebody makes a phone call.
