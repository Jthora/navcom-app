# Raw Intel — the observation object

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

Signed with the **Contact key**, or published anonymously. Never the Operational key — the
whole point of the split is that "publishing costs no operational exposure."

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

## 9. Expiry — uncorroborated intel evaporates

An observation that is never corroborated and never cited **expires after 90 days**.
Corroborated or cited observations are pinned permanently.

**Why 90.** It reuses the window the Accountability tier already has rather than inventing a
new one, and it is long enough for a second operator to visit the same place in an ordinary
patrol cycle.

One rule doing two jobs: it keeps the pool clean with no moderator, and it shrinks the
Doxxer's dataset to only the observations that mattered to somebody. **An observation is
permanently true; permanent retention is a separate choice.**

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
