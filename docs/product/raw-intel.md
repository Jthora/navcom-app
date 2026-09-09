# Raw Intel — the observation object

**Version 0.1.0. NavCom is the authority for this object.**

Starcom *refines* raw intel; it does not mint it. So the shape of what enters the grid is
defined here and implemented downstream — a consumer conforms to this document rather than
negotiating with it, and changes are announced by version. That is not a claim of seniority.
It follows from where the object is born: only the application with somebody standing in the
actual place can say what being there produced.

A machine-readable form is published at **`/.well-known/navcom-intel.json`**, so conformance
never requires reading prose. It carries the kind, the required fields, the vocabulary, the
obligations on a consumer, and the list of things that will never appear. Its vocabulary and
its status are *derived* — read out of this file and out of `kinds.ts` rather than retyped —
because a declaration maintained by hand is a declaration that drifts.

**Nothing emits kind `1911` yet**, and the declaration says so in those words until something
does. A published contract claiming a capability that does not exist is the failure this
project has already had once, on the status page.

**Normative for the object.** Deliberately *not* in [`docs/spec/`](../spec/README.md): that
set is scoped to the MVP loop plus the safety-critical ladder, and its README is right that
"specs written before the loop is proven are guesses in a more confident format." This
specifies a shape, not a schedule. Nothing here is built.

Sibling of [`directory-schema.md`](directory-schema.md), which is the normative source for
records and corrections. Read that first; this reuses its machinery rather than inventing
any.

## Why this exists

[`ecosystem.md`](../ecosystem.md) specifies Starcom as refining **raw intel** into Intel
Reports and Mission Packages. The phrase occurs twice in the whole docs tree and both times
it is Starcom's *input*. **Nothing in the network produces it.** NavCom is the only
component with people standing in the actual place, and its stated contribution is the
ninth tribe — "what is only knowable by being present."

---

## 1. Observations are not conditions

The distinction is load-bearing and everything below depends on it.

| | Condition | Observation |
|---|---|---|
| Example | "St Pat's closes intake at 20:30" | "On 3 Sept at 23:10 I saw the door locked" |
| Claim about | the present | a moment |
| Over time | **rots** — needs re-checking | **stays true** forever |
| Object | a correction, `30911` | an observation, `1911` |
| Handled by | [`volatility.ts`](../../packages/core/src/directory/volatility.ts) decay | never decays; may expire unread |

Conflating them produces a system that either forgets evidence or trusts stale claims.
A correction says what *is*. An observation says what someone *saw*.

## 2. Kind `1911` — Observation

**Regular** (1000–9999): stored by relays, immutable, never replaced.

Not replaceable (`1xxxx`) and not addressable (`3xxxx`), because both permit an author to
overwrite what they previously published. An evidence record whose history can be quietly
rewritten is the thing the accountability log exists to prevent; the same reasoning applies
one layer down. **An observation is superseded by a later observation, never edited.**

Not ephemeral (`2xxxx`), which is the deliberate opposite choice from `Distress`. A distress
call must leave no queryable history. An observation is *for* the record.

Signed with the **Contact key**. Never the Operational key — the whole point of the split is
that "publishing costs no operational exposure."

**Anonymity here is field-level, not key-level**, and the earlier wording promised both. The
`callsign` field may be the literal `anonymous`; the event is still Contact-key signed. That
is a deliberate limit rather than a shortcut: key-level anonymity would need a fresh throwaway
key per observation, which forfeits `supersedes` entirely, since supersession is scoped to an
author's own account. An operator who wants no linkage at all between two observations must
also accept that neither can correct the other.

**And it is load-bearing for something it was not chosen for.** Because the event is still
signed with one contact key, two `anonymous` observations from the same operator **share a
pubkey and are detectably one source**. Starcom's weight model relies on exactly this: an
anonymous observation is floored rather than excluded, and *cannot corroborate itself*.

Key-level anonymity would break that silently — one actor would present as N independent
sources, and Sybil corroboration becomes free. So this is recorded here rather than left as a
consequence: **a future change that "improves" anonymity to a throwaway key per observation
reopens the correlated-fabrication hole across the whole grid**, in a system whose analysis
layer has been told it can trust source independence.

**And there is a third consequence, which is a cost to the operator rather than a benefit to
the network.** One property, three effects: it preserves `supersedes`, it makes Sybil
arithmetically unavailable — and it means **an operator publishing under `anonymous` is
pseudonymous, not unlinkable.** Every observation they have ever filed joins on that pubkey,
for anyone reading a relay, not only for Starcom.

That is not a small caveat. [The Doxxer](../research/ecosystem-roster.md) correlates timing and
coarse position to unmask an operator, and an `anonymous` observation set is exactly that
material: linkable, timestamped, location-bearing, and *larger* than the operator believes it
to be because they chose the option named after not being identified.

**The name is the defect.** `anonymous` promises something the field does not deliver. It
omits a callsign; it does not sever a history. A value that described the act — no name
attached — would not invite the belief. Renaming it changes the wire format and therefore the
contract version, so it is not done here; it is recorded as the thing to fix in `0.2.0`, and
in the meantime the sentence an operator must actually see is:

> **Anonymous means no name. It does not mean no history.**

This is the same failure as the terminal's signature toggle, which reads `DOCUMENT` while the
mode is low signature: **a control labelled with a promise it does not keep.** Found there by
measurement and here by Starcom, and worth noticing that the project produced it twice.

## 3. Fields

| Field | Required | Notes |
|---|---|---|
| `anchor` | yes | The entity observed. See §5 |
| `observed_at` | yes | When it was seen. Distinct from the event's own timestamp |
| `tags` | yes | One or more from the closed vocabulary (§7). May be `nothing_observed` |
| `method` | yes | `saw` · `told` · `inferred`. Fact, not judgment. See §8 |
| `callsign` | yes | A callsign, or `anonymous`. **Never a legal name** [invariant 8] |
| `precision` | yes | `area` or `exact`. See §4 |
| `supersedes` | no | Event id of an observation this replaces in the author's own account |

**There is no free-text field, and this is the whole enforcement mechanism.** See §6.

## 4. Publication — coarse now, precise later

An observation publishes immediately at `area` precision. The `exact` anchor position
publishes **48 hours later**, as a second event referencing the first.

**Why a delay at all.** Real-time relay traffic naming a precise location tells a watcher
that an operator is standing there *now*. That is the acute threat and a delay defeats it
completely.

**Why 48 and not 24.** A 24-hour delay preserves the daily cycle: an operator who patrols
nightly would have precise positions surface at the same hour every day, and that rhythm is
itself a signal. Forty-eight hours breaks the lock-step while costing strategic analysis —
whose horizon is campaigns and patterns — effectively nothing.

**What the delay does not do.** It does not defeat pattern reconstruction from many
observations over time; the event carries `observed_at`, so nothing about *when* is hidden.
That threat is answered by §9 instead. **Two threats, two mechanisms, and neither substitutes
for the other.**

### The encoding, pinned

| `precision` | Encoding | Cell |
|---|---|---|
| `area` | **geohash, exactly 4 characters** | ±20 km |
| `exact` | full coordinates | — |

**Four characters, stated as a count rather than a distance.** An earlier draft said "coarse
(~20 km)" and gave a five-character example, which is ±2.4 km — an eight-fold disagreement
inside the one field whose entire job is preventing an operator from being located. A consumer
builds against the example, not the adjective. *"Coarse" is not a specification*, and the
privacy claim here is a function of the character count, so the count is normative.

### The refinement replaces the observation. It never adds one.

The `exact` event carries `["refines", "<event id of the area event>"]`, and a consumer
**MUST** treat the pair as one observation: the refinement supersedes the original's position
and **the two never corroborate each other**.

Spelled out because the obvious reading is wrong and dangerous. Dedup on event id is correct
and does not catch this — the two events are genuinely distinct. Without this rule, one
operator reporting one thing once produces two observations ~20 km apart that
**confirm each other**, which is the correlated-fabrication failure arriving through a
mechanism built for privacy.

`refines` is deliberately not `supersedes`. Supersession means *the author changed their
account*; refinement means *the same account, at a resolution that was withheld on purpose*.
A consumer that conflated them would treat added precision as a correction and, worse, treat a
correction as merely more precise.

### Finding one — `g` for the metro, `d` for the place

An observation published with only `refines` is unfindable. Nothing can ask for observations
about a place, or in an area, so the object could be written and never read — which is what
happened: the write path shipped complete and nothing subscribed, stored or displayed one.

Two tags, both borrowed rather than invented, because three neighbouring objects already
settled this:

| | Carries | Asked for as |
|---|---|---|
| `g` | the anchor's region slug | `{ kinds: [1911], '#g': ['st-louis'] }` |
| `d` | the anchor id | `{ kinds: [1911], '#d': [recordId] }` |

`g` is what a **place** already uses, for the same reason and with the same comment: it makes
a region askable when the published directory for it is empty. `d` is what a **correction**
already uses to mean *about this record* — so an observation meaning the same thing by the
same letter is coherent, and the two compose:

```json
{ kinds: [30911, 1911], '#d': [...recordIds] }
```

fetches a record's corrections **and** its observations in one round trip. A client already
sends the first half of that filter.

Kind `1911` is regular, so `d` is not this event's identity and carries no replacement
semantics — it is a query key, exactly as it is on a card. Two observations about one place
are two observations, and neither replaces the other.

**Neither tag says anything the content does not.** The region is a coarsening of a position
already published in the directory, and the anchor id is in `content.anchor`. A tag here buys
a filter, not a disclosure — which is the test any future tag on this object has to pass.

## 5. The anchor rule

> **A report MUST name a thing that is already a matter of public record.**

| | | |
|---|---|---|
| ✓ | St Patrick's | an organisation, on record |
| ✓ | 4th & Vine streetlight | infrastructure, owned by somebody on record |
| ✓ | The lot at 212 Elm | a parcel, on record |
| ✗ | An encampment behind the Home Depot | on no record; constituted by the people in it |
| ✗ | People sleeping under the overpass | the same, said plainly |

### Why this wording, and not the one it replaces

It read *"an entity that could, in principle, respond"*, and that was a proxy dressed as a
principle. **Nothing responds.** A streetlight does not; the city that owns it does. A shelter
does not; the organisation does. Applied honestly the old rule excluded almost everything,
and applied loosely it excluded nothing.

The property actually being reached for is: **does naming this reveal where people are?** An
encampment is *constituted by* the people — remove them and it does not exist. A streetlight
exists regardless of who is standing near it. That is invariant 1 served directly rather than
through a proxy, and it separates the cases without argument.

*Public record* is the schema-checkable version of it. A building, a parcel, a streetlight and
an organisation all have an owner of record; an encampment has none, and that absence is
exactly what makes naming it an act of exposure rather than of description. It also explains
the refuge exception without special-casing: **a refuge is on public record — what is withheld
is its address**, which is §6's job, not this one.

### An anchor is not a place, and routing it through one was a category error

An earlier draft said an anchor may be created through the operator-added place path, and
claimed that path enforced this rule for free. It does not, and the reasoning was backwards.

A *place* carries a `type` from `RESOURCE_TYPES` because the directory promises help and the
type says what kind. An *anchor* only has to identify what an observation is about. Borrowing
the service taxonomy for that inherits a vocabulary built to answer a different question — so
two of the three examples above cannot be filed at all, because there is no directory type for
a streetlight or a parcel, and there should not be: a directory whose meaning is *places that
help somebody at 11pm* does not improve by listing street furniture.

**So anchors need their own object** — a name, a location, and a type from a small closed list
whose only job is that no category describes people. Deliberately lighter than a place: no
hours, no phone, no method-of-knowing about services, because an anchor makes no promise to
anybody. Some anchors coincide with a directory record; most do not.

That object is not built, and its type list needs local knowledge in the same way the tag
vocabulary does. **Until it exists, an observation can only anchor to a directory record that
already exists** — which is a real limit and is stated here rather than discovered later.

## 6. No free text leaves the device

Free text cannot be policed; [`CLAUDE.md`](../../CLAUDE.md) invariant 1 already concedes it
and says to guide rather than pretend. So it is not policed — **it is not published.**

An operator's own notes stay in the **Wipeable** tier, on the device, destroyed by panic
wipe, exactly as now. A published observation is composed entirely of selected values.

This single mechanism carries both hard prohibitions:

- **No physical descriptors.** Race, clothing, build, vehicle — the machinery of profiling,
  and what turned Citizen and Nextdoor into instruments of harm. The observation has no field
  to put one in.
- **No locating vulnerable people.** §5 refuses the anchor; §6 refuses the phrasing.

### The limit, because the claim above has one

**An anchor has a name, and a name is free text.** It has to be — there is no directory
without names — so this is a limit rather than a hole, and it cannot be closed the way
`notes` was. Verified rather than assumed: a place named *"camp behind Home Depot — white
male 30s red jacket"* is accepted today.

So the honest statement of what the schema buys, which is narrower than earlier drafts of
this page claimed:

| | |
|---|---|
| The observation carries no free text | **true, and structural** |
| Nothing anywhere in the chain carries free text | **false** — the anchor it references has a name |
| No *category* exists for locating people | **true** — you cannot file a class of thing |
| No individual can lie in a name field | **false, and unachievable** |

**The schema prevents a system for finding people. It cannot prevent one person lying once.**
That difference is the whole of what is defensible here, and stating the stronger version — as
this document did — is the kind of overclaim that collapses on one adversarial reading.

What answers the residue is not structure: a deceptive anchor name is one signed, attributed,
correctable row rather than a capability, and the additive-only merge means it can be
contradicted but never used to delete anything.

**Cost, stated plainly:** with a closed vocabulary this is not fully *raw* intel. It is
structured field observation, which is the safe subset. Roughly a third of the value of
unstructured reporting lives in the part we are refusing, and all of the harm does.

## 7. The vocabulary — **STUB, needs human authorship**

Not agent work. Extending the taxonomy needs people with local knowledge, and a wrong
vocabulary is worse than a thin one because it shapes what operators think to look at.

Seed below is a *placeholder for correction*, not a proposal:

```
access      fenced · locked · demolished · rebuilt · blocked
service     closed · moved · hours_changed · capacity_full · reopened
infra       light_out · camera_new · barrier_new · transit_changed
artifact    flyer_posted · notice_posted · sticker_qr
threat      scam_targeting_community · predatory_operation
nil         nothing_observed
```

**Failure is safe by construction:** what the vocabulary cannot express does not publish and
stays on the device. Nothing is lost, and nobody is blocked waiting for a maintainer.

### Fetching it — cache **3600 seconds**, and degrade permissive

The list is published at `/.well-known/navcom-intel.json` under `vocabulary.tags`. A consumer
fetches it; it is never vendored into fixtures, because these twenty are a placeholder and the
real list arrives the day somebody with local knowledge writes it.

| | |
|---|---|
| Cache TTL | **3600 s** — it is a static file; refetching is free |
| Stale ceiling | **86400 s**, after which the list must not be enforced at all |
| On expiry or fetch failure | fall back to **shape-only** validation, and say so in the drop reason |

**Degrade permissive, not restrictive, and that direction is the whole rule.** Enforcing a
list you cannot confirm is current rejects *valid* observations and they vanish looking exactly
like malformed input — the worst failure available here, because it is silent and it discards
the thing the network is shortest of. Accepting a tag you cannot verify is a mild correctness
cost that shows up in analysis. Prefer the visible error to the invisible loss.

**Bounds: `ttl_seconds` is never below 60 or above 86400.** A consumer that reads a value
outside them should refuse it and use its own default, because a ttl of zero means *refetch on
every call* — a denial of service against us, published by us. Starcom had to invent that check
unprompted; a contract able to instruct a consumer to hurt its publisher should state what it
will never ask for rather than leaving every consumer to guess a floor.

### Verifying the vocabulary came from us

This file decides what a consumer accepts, so **whoever controls the origin controls their
allowlist** — a compromise here means a consumer enforcing an attacker's list, believing it is
ours. The staleness ceiling caps that at 24 hours. This closes it.

`vocabulary.cid` is a raw CIDv1 (sha2-256) over the canonical bytes, and the same CID is
announced as **kind `30078`, `d: navcom:intel-vocabulary`**, signed by the node key whose
pubkey is at `/.well-known/navcom-node.json`, published to relays the web origin does not
control.

```
1. fetch /.well-known/navcom-intel.json
2. canonical = JSON.stringify(vocabulary.tags) with namespaces sorted,
   members sorted within each, utf8, no whitespace
3. recompute raw CIDv1(sha2-256) over those bytes
4. fetch kind 30078, d=navcom:intel-vocabulary, from a relay
5. verify its signature against the node pubkey — pinned, or learned once
6. the two CIDs must match
```

**Do not take `vocabulary.cid` as evidence of itself.** A hash published beside the thing it
describes proves nothing: an attacker rewriting the vocabulary rewrites the hash in the same
request. The check is only worth anything against the relay copy, which requires the node key,
which the origin does not hold. And step 5 is the one that carries it — a pubkey read from the
same compromised origin is no better than no check at all.

The node key's authority is unchanged and is stated in its own descriptor: *"this key attests
origin, never truth."* It says this vocabulary came from NavCom's build. It says nothing about
whether the vocabulary is any good.

**A vocabulary change does not bump the contract version.** The list is data, the version
covers the shape, and the two move independently — so a consumer that refetches only when the
version changes would never refetch at all. This is the sentence most likely to be assumed
away by whoever wires it up.

## 8. `method`, and why NavCom never grades

`method` is `saw` · `told` · `inferred`. This is a **fact about how the observer came to
know**, requiring no self-assessment, and it is the single most valuable thing a raw report
carries.

NavCom does **not** grade its own operators. Scoring people is a reputation system by
another name, and "let the agent judge or decide" is a standing anti-pattern.

Grading is Starcom's, using the Admiralty two-axis code (NATO AJP-2.1), and the two axes
fall either side of the boundary by their own doctrine — which insists they be judged
independently:

| Axis | Answers | From |
|---|---|---|
| **A–F** source reliability | has this source been right before? | the provenance NavCom attaches |
| **1–6** information credibility | does anything else support this? | corroboration, which is Starcom's function |

`F6` — untested source, unverifiable information — is a **valid grade, not a rejection**.
The doctrine notes such information "may still be accurate, actionable, and valuable." A
first-night operator is F6. **There is therefore no quality bar on submission, ever:** the
grade carries the caveat so the gate does not have to.

## 9. Retention — uncorroborated intel is dropped, not deleted

An observation that is never corroborated and never cited **is dropped from local stores after
90 days**. Corroborated or cited observations are kept.

**This is a retention rule, not a property of the event, and the distinction is not pedantic.**
A regular Nostr event is immutable and held by whatever relay chose to store it; §11 forbids
deletion; nothing here can reach across the network and remove something already published.
An earlier draft of this section said observations "expire", which described something no
relay would honour and no client could enforce — a rule the code could never satisfy.

What is actually specified: devices and nodes drop what they hold, on the shape
`escalation.ts`'s `reap` already uses. A relay that keeps everything forever is not in
violation; it is simply not participating in the part we control. The Doxxer's dataset shrinks
wherever this runs, which is the honest claim, and it is smaller than the one it replaces.

**Why 90.** It reuses the window the Accountability tier already has rather than inventing a
new one, and it is long enough for a second operator to visit the same place in an ordinary
patrol cycle.

One rule doing two jobs: it keeps the pool clean with no moderator, and it shrinks the stored
set to the observations that mattered to somebody. **An observation is permanently true;
permanent retention is a separate choice, and it is the only half of that we can decide.**

Citation pins, so the provenance chain can never break — anything a report depends on is by
definition cited.

## 10. The valve

Refines [`ecosystem.md`](../ecosystem.md)'s table for this object. C35 forbids **operator
records** and permits **patterns**; those are not opposites, and an observation is neither.
A Contact-key observation about an institution is raw *and* is not an operator record, so it
crosses intact — aggregating it first would be NavCom doing Starcom's job badly while
destroying the evidence chain.

| Direction | Crosses | Never |
|---|---|---|
| NavCom → Starcom | Observations, whole, with provenance | Operational-key anything; positions; board state; query text |

**On the callsign, because two published contracts disagreed about it.**
[`navcom-refusals.json`](../../packages/core/src/refusals.ts) says callsigns never cross;
this object declares `callsign` required. Both were shipped on the same night and could not
both be true as written.

The resolution is that they describe different acts. **The valve governs what NavCom
*discloses* — hands over, correlates, answers questions about. It cannot govern what an
operator already published**, because a Contact-key observation goes to public relays and
Starcom can subscribe to those without asking anyone. A rule forbidding the handover of
something already readable is not a protection, it is a fig leaf, and this project does not
get to ship one.

So the control is **operator-side and always was**: `anonymous` is available on every
observation, and an operator who does not want their callsign on a public fact does not put
it there. That is a weaker guarantee than the refusals file implied, and it is the true one.
| Starcom → NavCom | Grades and citations for observations | Anything reaching the Field Terminal; anything as a feed |

**Provenance must survive refinement.** An Intel Report cites the event ids it was built
from. Because observations are public and durable, the chain is walkable by *third parties*
— a journalist can take a published Report back to its F6 sources without asking Starcom or
us. That is the only verification that means anything, and [`ecosystem.md`](../ecosystem.md)
founds the whole network on the failure it prevents: "the tribes exchange conclusions
stripped of their evidence chain, which is why the exchange doesn't compound."

## 11. What this deliberately is not

- **No photographs.** Every threat re-enters through one — faces, plates, EXIF, reflections
  — and an operator cannot see what is in frame at 1am. Deferred, named, not forgotten
- **No evaluation in NavCom.** Not confidence, not triage, not priority
- **No feed.** Submission is an act. Results appear when an operator looks, never as a
  notification; the field terminal stays silent
- **No automatic publication.** The default is that nothing leaves
- **No deletion.** Retraction is a new observation, and a source who self-corrects is *more*
  reliable, not less
- **No reward a reporter can produce alone.** Submissions, streaks and speed are all
  farmable and all banned. Cited, corroborated and stood-up-after-reporting-early are
  conferred by others and cannot be farmed. Incentivised volume does not add noise to an
  analysis layer, it manufactures correlated false signal
