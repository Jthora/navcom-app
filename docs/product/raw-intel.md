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

## 5. The anchor rule

> **A report MUST name an entity that could, in principle, respond.**

| | |
|---|---|
| ✓ | St Patrick's — an organisation |
| ✓ | 4th & Vine streetlight — infrastructure with an owner |
| ✓ | The lot at 212 Elm — a parcel |
| ✗ | An encampment behind the Home Depot |
| ✗ | People sleeping under the overpass |

This is invariant 1 — *nothing is recorded about the people being served* — reaching a case
it had always covered and nobody had noticed: **an encampment location is information about
people being served, expressed as coordinates.** Geography is a descriptor when the subject
is a population.

It is also the ethical asymmetry made structural. An institution can dispute a report about
itself; a patch of ground cannot, and neither can the people on it. **So institutions are
reportable and ground is not.**

**The anchor path must not carry `notes`.** The rule above is enforced by there being no
free-text field to put a descriptor in — and the place-creation path has one.
`PLACE_EXTRAS = ['phone', 'hours', 'notes']`, and `notes` is free text. An observation that
creates its anchor could therefore publish exactly what §6 exists to prevent, through the door
standing next to it. The observation flow must not expose `notes`, and must say so in the
docblock the way `places.ts` already names the decisive fields it deliberately omits — so the
next person does not restore it as an oversight.

**An anchor may be created by the observation**, through the existing operator-added place
path in [`directory-schema.md`](directory-schema.md) §5 — which already demands a `method`
of `in_person`, `staff_confirmed` or `phone`, and already marks the row as never having been
through a maintainer. That path also enforces this rule for free: a new place needs a type
from the directory taxonomy, and there is no type an encampment can be filed under.

## 6. No free text leaves the device

Free text cannot be policed; [`CLAUDE.md`](../../CLAUDE.md) invariant 1 already concedes it
and says to guide rather than pretend. So it is not policed — **it is not published.**

An operator's own notes stay in the **Wipeable** tier, on the device, destroyed by panic
wipe, exactly as now. A published observation is composed entirely of selected values.

This single mechanism enforces both hard prohibitions at once:

- **No physical descriptors.** Race, clothing, build, vehicle — the machinery of profiling,
  and what turned Citizen and Nextdoor into instruments of harm. There is no field to put
  one in.
- **No locating vulnerable people.** §5 refuses the anchor; §6 refuses the phrasing.

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
