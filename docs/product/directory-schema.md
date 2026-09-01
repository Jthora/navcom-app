# Resource Directory — Schema

The knowledge layer's core data. Lives in the [Collective tier](./data-tiers.md):
shared, replicated, cached offline in full, attributed to contributing callsigns.

**Primarily a Console instrument.** The full directory — search, filters, map — belongs to
whoever holds watch, answering [`Query`](../watch/signals.md) for operators in the field.
The Field Terminal carries a deliberately simpler cached copy as fallback.

**Every unanswerable `Query` is logged as a directory gap.** The knowledge layer improves
fastest at exactly the points where it failed someone in real time.

## Hard rule

**Never record information about the people being served.** No names, no descriptions,
no locations of individuals, no medical details, no photographs. This directory describes
*services*, never *recipients*. There is no field for it because there must never be one.

---

## 1. Identity

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable slug, e.g. `stmarys-shelter-downtown`. Never reused |
| `name` | string | What it's actually called locally, not its legal name |
| `type` | enum | See taxonomy below |
| `address` | string | Street address |
| `lat`, `lon` | float | Optional. Enables handoff to the phone's maps app |
| `phone` | string | Optional |
| `notes` | text | The stuff that doesn't fit a column |

### `type` taxonomy

`shelter` · `meal` · `hygiene` (showers, laundry) · `medical` · `harm_reduction` ·
`warming` · `cooling` · `storage` · `legal` · `id_docs` · `mail` · `charging` ·
`veterinary` · `youth` · `dv` (domestic violence) · `detox` · `daytime` (drop-in)

**This list is Anglosphere-shaped, and that is a known limitation rather than a decision.**
`warming` and `cooling` assume a temperate climate with a particular emergency-response
model; `mail` assumes general-delivery services; `id_docs` assumes a documentation regime.
Elsewhere the decisive categories may be water points, cash assistance, migration and asylum
support, or family tracing.

Extending it needs people with local knowledge — the same rule that governs the data, for
the same reason. See [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md).

---

## 2. Intake rules

**This is what no official listing has, and the reason the directory is worth
maintaining.** Every field answers: *will they actually take this person, tonight?*

| Field | Values |
|---|---|
| `accepts` | `single_men`, `single_women`, `couples`, `families`, `minors`, `trans_inclusive` |
| `pets` | `yes`, `service_only`, `kennel_onsite`, `no` |
| `sobriety` | `sober_required`, `harm_reduction_ok`, `no_questions` |
| `id_required` | `yes`, `no`, `helps_but_not_required` |
| `referral_required` | boolean |
| `sex_offender_ok` | `yes`, `no`, `unknown` — a real constraint where a public registry exists. **Jurisdiction-specific**: meaningless, and potentially stigmatising, where none does |
| `reports_to` | `no_one`, `police`, `immigration`, `child_services`, `unknown` — who the service passes information to |
| `curfew` | Lockout time, if any |
| `max_stay` | e.g. `1 night`, `30 days`, `none` |
| `belongings` | `storage_provided`, `carry_on_only`, `size_limit` |
| `accessibility` | `wheelchair`, `ground_floor`, `none` |
| `languages` | Staff languages actually spoken |
| `cost` | `free`, `sliding`, `fee` |

**`reports_to` is the field the Medic asked for and the schema did not have.** *"The nearest
ER that won't call police"* was unanswerable until now, and outside the country this was
written in it is often immigration rather than police that decides whether someone will walk
through a door at all.

It describes the **service**, never a person, so [invariant 1](../principles.md) is
untouched. And `no_one` is not the same as blank: blank renders as *unknown* by rule 5, and
not knowing whether a clinic calls the police is a completely different fact from knowing it
does not. Leave it blank unless someone actually established the answer.

Use `unknown` freely. **An honest blank beats a confident guess.**

---

## 3. Availability

| Field | Notes |
|---|---|
| `hours` | Per-day open/close |
| `intake_hours` | When you can actually get in — often narrower than "open" |
| `seasonal` | `year_round`, `winter_only`, `summer_only`, `weather_activated` |
| `capacity_signal` | `usually_available`, `often_full`, `call_first`, `unknown` |

`capacity_signal` is deliberately coarse. We are not building a bed-availability API —
that data is stale within hours and would be the most dangerous field in the system.
**"Call first" is a first-class, honest answer.**

---

## 3a. The half-life, measured

`hours` and `intake_hours` are **volatile**: stale after fourteen days, after which the value
is not shown at all and the field reads *call first*. That is rule 2 working exactly as
written, and it has a consequence nobody had put a number on.

Measured 2026-09-01, against the 479 scraped records: **median age thirteen days.** The whole
published directory crosses the volatile threshold within about a day of itself, because it
was all scraped in one pass. 158 records carry hours; all 158 are about to stop showing them.

**This is not a defect and the reader is not stranded.** A record that says *call first* still
carries its address and its phone numbers, so the answer becomes *"ring them, here is the
number"* rather than nothing. Checked on the live site rather than reasoned about.

**It is written down because somebody will want to relax the threshold**, and the argument
against is easy to lose. Fourteen days is not a claim that a shelter changes its hours
fortnightly. It is the point past which *this project* will not repeat a number it got off a
website and never checked — and a confident wrong closing time at 10pm is the failure the
whole schema exists to avoid.

What it does mean is that **6.9 is the only thing that makes the directory show hours at
all.** A record somebody phoned carries `method: phone`, gets a fresh date, and displays its
hours like any other. Ten records done properly are ten records that answer the question the
directory is opened for; the other 469 answer *call first*, honestly and permanently, until
somebody rings them.

## 4. Every record is a set of attestations

A row is not a fact. It is [a claim about a place](../attestation.md), carrying who said so,
how they knew, and — derived from those — what it is worth.

| Field | The attestation part it is |
|---|---|
| `last_verified` | **Age** |
| `verified_by` | **Author** — a callsign or `anonymous`, never a legal name |
| `method` | **How they know** — `in_person`, `phone`, `staff_confirmed`, `secondhand`, `website` |
| `flag` | A **counter-claim** by someone else: `ok`, `reported_closed`, `reported_wrong`, `permanently_closed` |

Everything below is the attestation model applied to places, not a separate design.

### Volatility classes

**Different fields rot at different speeds.** Staleness is per field-group, not per
record.

| Class | Fields | Stale after |
|---|---|---|
| **Static** | address, type, accessibility | 1 year |
| **Slow** | intake rules, cost, languages, max stay | 90 days |
| **Seasonal** | seasonal status, weather activation | 30 days, or at season change |
| **Volatile** | hours, intake hours, capacity signal | 14 days |

### Confidence

Derived, never entered by hand:

```
in_person or staff_confirmed, within window    → high
phone, within window                           → medium
website or secondhand, within window           → low
past its window                                → stale
flag != ok                                     → suspect (overrides all)
```

### Display rules

These exist because of one failure mode: a confident wrong answer that sends someone
somewhere that turns them away.

1. **Never show a volatile field without its age** — "Open until 10pm *(verified 3 days ago)*"
2. **Stale volatile data displays as "call first,"** never as the old value
3. **`suspect` records surface the flag first**, above all other content
4. **Anyone can flag in one tap** without being able to fully update — reporting must
   always be easier than fixing
5. **Blank renders as "unknown,"** never as absence of a restriction
6. **Seeded entries look visibly different from operator-verified ones.** A confidence
   tag in the data model doesn't help someone scanning a list at 10pm. Low-confidence
   data that *looks* authoritative is more dangerous than no data at all
7. **A place whose opening depends on something the app cannot check never shows its
   hours** — `weather_activated`, or `winter_only`/`summer_only` read out of season. This
   is the case rules 1 and 2 do not cover: **the data is perfectly fresh and the answer is
   still wrong.** A warming centre verified this morning still has a locked door on a mild
   night, because the city has not called it. The reason shown must be the real one —
   *"last check is too old"* on a record verified today is a lie, and it points the reader
   at a fix that would not help. Out of season is claimed only where the season can be
   determined: a record with no latitude, or one in the tropics, is left alone rather than
   guessed at

---

## 5. Contribution

Corrections are credited to the contributing callsign, building
[standing on the contribution axis](./identity.md) — visible expertise with no legal
identity attached. Anonymous contribution is always available for operators who want no
attribution at all.

**Correction must work offline and queue for sync.** The moment an operator discovers a
listing is wrong is the moment of worst connectivity and highest urgency — outside a
closed shelter, at night, with someone waiting. A correction path that needs signal or a
form is a correction path that never gets used.

Reporting that something is wrong requires one tap and no account.

### Adding a place that isn't listed

Corrections amend a row. **Adding one is a separate act with a separate kind** (`30915`),
because the failure modes differ: a wrong field sends somebody to the wrong hours, and a
wrong place sends somebody to an address that is not there.

It exists because the directory could otherwise only be seeded downward. Thirty-five of
sixty-eight regions ship with zero rows, and until a place could be added from the app those
regions had no page at all — the person with the local knowledge got a 404 while waiting for
a maintainer who has never been there. That is the cold-start problem stated as an
architecture, and it is the one thing here that scales without coordination: one operator
adding the three places they already know.

**`method` may only be `in_person`, `staff_confirmed` or `phone`.** You may add a place you
have stood at or spoken to. `website` and `secondhand` are refused, even though the
confidence rules can rank them everywhere else — a scraped place belongs in the maintainer's
import path above, where a person reviews it, not on somebody's screen at 11pm.

- **An address is required.** A place without one is a rumour: it cannot be walked to, it
  cannot be told apart from another place with the same name, and it gives the reader nothing
  to check
- **The intake fields of §2 cannot be set at creation.** They are not knowable from a doorway,
  and a form that invited them would collect a guess with an operator's callsign attached —
  which the confidence rules would then rank *above* a scraped value. They arrive afterwards,
  as corrections, from somebody who asked
- **Identity is derived from the name and address**, never chosen, so two operators adding the
  same building produce one row and the existing merge rules weigh their claims. Normalisation
  is NFC, case folding and whitespace collapse, and **strips no character class** — a
  punctuation-stripping identifier is how a peer project silently merged 北京, Москва and 東京
  into a single slot
- **The row says so on its face.** An added place has never been through a maintainer, and
  renders with its author, method and date above the fields — the record-level version of the
  provenance every field already carries

A published record always wins on identity: if a place an operator added later ships in the
curated directory under the same derived id, the curated row is the one a person stood behind.

### Regions, and seeding a new one

Data is partitioned by region — `data/regions/<slug>/` holds a `resources.csv` and a
`region.json`. The manifest carries what a row cannot say for itself: country, IANA
timezone, the languages the data is written in, and whether anyone has actually checked it.

**A row says a place opens at 19:00. Nothing in the row says local to where.** That is fine
in one city and wrong the moment there are two. Shape in
[`../../data/regions/README.md`](../../data/regions/README.md).

**Seed structural facts. Never seed intake rules.**

`name`, `address`, `type`, `phone` and published `hours` are public and checkable, and
[`propagation.md`](propagation.md) endorses seeding them from public sources at
`method: website` — low confidence, and visually distinct from operator-verified entries
[C21].

Everything in §2 is different. `sobriety`, `pets`, `id_required`, `referral_required`,
`sex_offender_ok`, `reports_to`, `curfew` and `belongings` are the fields this directory exists for, and
they are missing from official listings *precisely because nobody maintains them*.

They may be recorded **if the service published them** — a site that states "no pets" is
evidence, and `method: website` already marks it low-confidence and visibly seeded. They may
never be recorded because they seemed likely. Nothing in a CSV distinguishes a published
policy from an inference, which is why `npm run check:data` warns on every intake rule
carrying `method: website` and asks a person to confirm which it was.

A plausible guess in those fields looks like data, reads as authoritative, and sends
someone somewhere that turns them away. That is the failure this entire schema is shaped
to prevent.

### Who actually maintains this

Not everyone, and the design shouldn't pretend otherwise. Maintenance comes from a small
core with direct motivation — operators who bear the consequences of bad data, plus crews
where a lead assigns it — while most people only ever read.

**Design for the minority who contribute and make free-riding completely costless.**
Nothing in the app should pressure, shame, or gate a read-only operator. A directory that
demands reciprocity gets abandoned by the people it most needs to reach.


---

## Columns

```
id, name, type, address, lat, lon, phone,
accepts, pets, sobriety, id_required, referral_required, sex_offender_ok, reports_to,
curfew, max_stay, belongings, accessibility, languages, cost,
hours, intake_hours, seasonal, capacity_signal,
last_verified, verified_by, method, flag, notes
```

Importable starter: [`../../data/regions/example/resources.csv`](../../data/regions/example/resources.csv)
