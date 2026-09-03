# Seeding the Directory

A brief for whoever builds the scraper — human or agent. It is written to be picked up cold.

The directory is the only part of NavCom that works with nothing else: no watch, no signal,
no peers. It currently holds **twelve invented records**, which means the one thing that
always works is the one thing that is useless.

---

## The rule that governs everything here

**Seed structural facts. Never seed intake rules.**

| Seed these | Leave these `unknown`, forever, until a human confirms them |
|---|---|
| `name` `address` `lat` `lon` `phone` `type` `hours` `cost` | `sobriety` `pets` `id_required` `referral_required` `sex_offender_ok` `reports_to` `curfew` `max_stay` `belongings` `capacity_signal` |

The left column is published, checkable, and wrong in boring ways. The right column is
**why the directory exists** — and it is absent from every public listing precisely because
nobody maintains it.

**A plausible guess in the right-hand column is the fastest way to end this project.** Not a
quality problem: someone walks two miles at 11pm on the strength of `pets: yes` and gets
turned away. The Medic archetype names confident wrong guidance as the kill trigger, and
this is exactly where it would enter.

A scraper that cannot find a field **must leave it empty.** Empty renders as *unknown*,
which is a true statement. There is no inference, no "most shelters allow X", no defaulting,
and no LLM asked to read a website and fill in the blanks.

## What a seeded record must carry

Every seeded row sets these, and the display rules do the rest:

```
method       = "website"      # never "in_person" or "phone"
verified_by  = ""             # nobody checked it, and the record must say so
last_verified= <scrape date>  # when the PAGE was read, not when the fact was true
flag         = "ok"
```

That combination makes a record render **visually distinct and marked unverified** on every
surface, which is already tested against the built HTML. The scraper's job is to be honest
about provenance; the display layer is already honest about what that provenance is worth.

## The rule the first real run taught

**A source that cannot distinguish the thing that matters must not be used for that
category.**

Learned twice in one afternoon, from OpenStreetMap over St. Louis:

- `healthcare=centre` and `amenity=clinic` returned 23 records: a medical school building, a
  cancer centre, four private urgent-care franchises, two travel clinics, five home-health
  agencies, and a medspa. The Medic wants *"the nearest ER that won't call police"* — free
  or low-barrier care for somebody with no insurance and no address. **No generic healthcare
  tag can tell you that**, and a private urgent care in the list is not a neutral extra: an
  operator sends somebody there and they are turned away or billed
- `amenity=shelter` is worse. In OSM it means **a structure that keeps rain off** — picnic
  pavilions, storm cellars, bus stops. After excluding bus stops it still returned "Tornado
  Shelter", "Duck Shelter" and "Bowl Lake Pavilion" as emergency accommodation. A wasted
  journey is bad; a park pavilion listed as a shelter is somebody walking there at midnight
  in February

Only `social_facility` describes a *service* rather than a building, and services are what
this directory holds. So OSM contributes shelters, meals, day centres and outreach — and
**medical stays empty rather than wrong** until a source that lists low-barrier care
specifically is wired up.

The result of applying that: St. Louis went from 88 scraped records to 11, and every one of
the 11 is a real service. **Fewer records, all of them plausible, is the trade to make every
time.**

## Where the public half comes from

Roughly in order of quality. Confirm licensing per source before shipping any of them — most
are open, some are not, and this list is a starting point rather than a cleared one.

| Source | Gives | Notes |
|---|---|---|
| **HUD HIC / PIT** | Shelters, beds, by CoC region | Annual, national, authoritative on what exists |
| **211 / United Way** | The broadest listing of services | Coverage and terms vary by region |
| **City & county open data** | Shelters, warming centres, clinics | Best quality where it exists, absent where it does not |
| **OpenStreetMap** | `social_facility`, `healthcare`, addresses, coordinates | Open licence, uneven coverage, good for geocoding |
| **Overture Maps** | `homeless_shelter`, `food_bank`, `soup_kitchen`, **phones**, addresses, a confidence score | Measured 2026-09-02, see below. Open data, bulk Parquet, no rate limit |
| **Health centre lookups** | Federally qualified clinics | Reliable for `medical` |
| **Individual org websites** | Hours, phone, current status | Last resort per record, and the only place `hours` is often found |

### Overture Maps, measured

Probed against release `2026-08-19.0` over Seattle's bounding box, the same one the OSM source
uses, for the same three categories:

| | OpenStreetMap | Overture |
|---|---|---|
| Records | 45 | **84** |
| Carrying a phone | 14 (31%) | **81 (96%)** |
| Carrying an address | 35 | **84 (100%)** |
| At `confidence >= 0.7` | n/a | 69 |

Roughly 62 are absent from what OSM gave us — Sacred Heart Shelter, DESC's Kerner-Scott House,
Plymouth Housing, Noel House Programs, Salvation Army food distribution.

**The doubling is not the point. The phone numbers are.** A number is what turns a record into
something a person can settle in a minute, and ringing round is the single most effective thing
anybody can do for this directory. Thirty-one per cent to ninety-six is the difference between a
locator and a work list.

It also passes the test `sources/osm.ts` learned the hard way — *a source that cannot
distinguish the thing that matters must not be used for that category*. Overture's taxonomy has
`homeless_shelter` under `[public_service_and_government, organization,
social_service_organizations]`, and its **confidence score sorts the noise to the bottom**: at
0.92, Union Gospel Mission, Northwest Harvest and Dorothy Day House; at 0.32 and below, "Seattle
Housing Authority Resident Managers" and "Level Up Seattle". A threshold removes them. That is
precisely what `social_facility=outreach` could not offer, which is why that one was declined.

And it types two records OSM could not. **Seattle's Union Gospel Mission** and **The Bridge Care
Center** both sit in `data/regions/seattle/uncategorised.md` today because OSM said who they
serve and not what they provide. Overture answers exactly that question.

**Two costs, stated:**

- **Freshness floor.** Overture publishes about monthly — only two releases exist at a time. For
  a building's address and coordinates that is irrelevant; for anything volatile it is worse than
  Overpass, which answers live. This is a locator source that layers *under* OSM, not a
  replacement for it
- **A tool, not a fetch.** The data is partitioned Parquet on S3, not an API. Reading it needs
  DuckDB, so `sources/overture.ts` **shells out to a binary** rather than taking a native npm
  dependency every contributor pays for whether or not they seed. Absent, it says which tool and
  where to get it, and every other source still runs

#### Running it

```
navcom-seed fetch <region> --source=overture
```

Needs the [DuckDB CLI](https://duckdb.org/docs/installation/) on `PATH`, or `NAVCOM_DUCKDB`
pointing at one. Where `~/.duckdb` is not writable — a sandbox, a locked build agent — set
`NAVCOM_DUCKDB_EXTENSIONS` to somewhere that is; DuckDB reports that case as *"Extension httpfs
not found"*, which reads like a missing install and sends people to reinstall what they already
have.

A region opts in by declaring the source beside its bbox, with the release **pinned**:

```json
"sources": {
  "osm": { "bbox": [...] },
  "overture": { "bbox": [...], "release": "2026-08-19.0", "minConfidence": 0.5 }
}
```

**Measured on Seattle, both sources merged:** 45 records to 108, and phones from 14 (31%) to 78
(72%). `dedupe` folded 16 duplicates and **absorbed rather than discarded** — an OSM record with
no phone inherits Overture's, which is why coverage more than doubled instead of OSM's 31%
merely surviving. Trust order keeps the live-fetched OSM record as the identity and takes the
month-old source's contact details, which is the right way round.

## Shape of the thing

`packages/seeder`, a workspace package alongside the others. Per region, producing
`data/regions/<slug>/resources.csv` — **committed to the repository**, not fetched at
runtime. That matters more than it looks: the output of every run is a git diff somebody can
read, which is the review mechanism.

### Five commands, and each one does a single thing

```
navcom-seed fetch  <region> [--source osm]   # the only command that touches the network
navcom-seed build  <region>                  # cache -> proposed CSV. Deterministic, offline
navcom-seed diff   <region>                  # what would change, against what is committed
navcom-seed apply  <region>                  # write it
navcom-seed audit  <region>                  # check committed data against the rules
```

**`fetch` and `build` are separate on purpose.** `build` is pure, offline and free, so
normalisation can be iterated on a hundred times without hitting a shelter's website once.
Politeness and speed happen to want the same thing here.

`audit` runs in CI against committed data, so the rules below are enforced on every change
rather than at the moment somebody remembers them.

### Region config

Adding a metro is adding a `region.json`. Nothing in the code changes.

```json
{
  "slug": "st-louis", "country": "US", "timezone": "America/Chicago",
  "sources": {
    "osm":  { "bbox": [-90.4, 38.4, -90.1, 38.8] },
    "hud":  { "coc": "MO-500" },
    "city": { "url": "https://..." }
  }
}
```

### Ids must be stable across runs

Otherwise every re-scrape reads as a mass deletion followed by a mass creation, and the diff
that was supposed to be reviewable becomes unreadable. Derive them from something durable —
`<region>-<source>-<hash of the source's own id>` — never from a row number or a name.

## The rule, made unbreakable

The brief above says never to write the intake columns. **A brief is a thing an agent can
reason its way around at 3am, so it is also a type.**

```ts
/** What a scraper is permitted to produce. The intake fields are not in it. */
export type SeededRecord = Pick<
  ResourceRecord,
  'id' | 'name' | 'type' | 'address' | 'lat' | 'lon' | 'phone' | 'hours' | 'cost' | 'languages'
>;
```

`emit` takes `SeededRecord[]` and fills every remaining column with an empty string. There is
no argument, no override and no flag. **A scraper cannot set `pets` because there is nowhere
to put it** — the same choice made for accountability-log outcomes and for the public
presence payload, for the same reason: a leak that cannot be expressed does not need
policing.

## Merging: human rows are sacred

`build` loads what is committed and partitions it.

| Row | What happens |
|---|---|
| `method` is **not** `website` — somebody checked it | **Untouched. Always.** Never rewritten, never deleted, never reordered |
| `method` is `website` — a previous scrape | Replaced wholesale by this run |

Two consequences worth stating, because both look like bugs otherwise:

- **A human-verified record that public sources no longer list stays.** It goes in the report
  as a review item. The human knew something the scraper does not, and a shelter missing from
  a listing site has not necessarily closed
- **The scraper cannot correct a human row's phone number.** If public data now disagrees,
  that is a review item too. The scraper proposes; a person disposes

## The report is the agent contract

Every command writes machine-readable JSON to `data/regions/<slug>/.seed-report.json`.
An agent should never have to parse a log line.

```json
{
  "region": "st-louis",
  "at": "2026-08-19T21:00:00Z",
  "sources": [
    { "name": "osm",  "ok": true,  "records": 142, "ms": 3100 },
    { "name": "hud",  "ok": false, "error": "403", "records": 0 }
  ],
  "proposed": { "added": 40, "changed": 12, "unchanged": 88, "protected": 9 },
  "review": [
    { "id": "st-louis-osm-4a1c", "reason": "human-verified, no longer in public sources" },
    { "id": "st-louis-hud-77b2", "reason": "public phone differs from verified phone" }
  ],
  "refused": [
    { "url": "https://...", "reason": "robots.txt disallow" }
  ]
}
```

**Partial failure is a normal outcome, not a crash.** A source returning 403 leaves every
other source's records intact and says which one broke. A run that silently produces half a
region is worse than one that stops, and worse still than one that says so.

## What an agent actually does

```
navcom-seed fetch st-louis        # network, cached, polite
navcom-seed build st-louis        # offline, deterministic
navcom-seed diff  st-louis        # read the report
                                  # -> anything in `review` is a question for a human
navcom-seed apply st-louis
npm run check:data                # existing validator, must pass
                                  # -> commit; the diff is the review
```

Re-running `fetch` on a warm cache costs nothing and hits nobody. Re-running `build` is free
and deterministic — same cache in, same CSV out, byte for byte. **An interrupted run is
resumed by running it again**, and there is no state anywhere but the cache and the CSV.

## Politeness is not optional

The targets are small organisations serving people in crisis, and several run on donated
hosting. A scraper that degrades a shelter's website has done direct harm to the people it
claims to serve.

- **Identify yourself** in the user agent, with a contact address that a person reads
- **One request at a time per host**, with a delay between them. There is no deadline here
- **Honour `robots.txt`**, and record every refusal in the report rather than silently
  skipping it
- **Cache aggressively.** The politest request is the one not made

## Rules the scraper itself must follow

- **Identify itself** in the user agent, with a contact address. Anyone running a small
  nonprofit's website deserves to know who is hitting it and how to say stop
- **Rate limit, and respect `robots.txt`.** These are organisations serving people in
  crisis; a scraper that degrades a shelter's website has done direct harm
- **Never scrape a page behind a login**, and never anything about an individual. Invariant
  1 has no exceptions and this is the likeliest place to trip it
- **Fail loudly and partially.** A source that breaks should leave the other sources' records
  intact and say which one broke. A run that silently produces half a region is worse than
  one that stops

## What it must never do

- **Never write to the intake columns.** Not from a website's FAQ, not from a phone call
  transcript, not from a model that read the page and is confident
- **Never invent `verified_by`.** An empty value is the true one. A scraper cannot verify
  anything; it can only report where it read something
- **Never mark a record verified because several sources agree.** Three listings copied from
  one another is one listing
- **Never delete a human-verified record.** If a scrape no longer finds a place that somebody
  checked in person, that is a **flag for review**, not a deletion. The human knew something
  the scraper does not

## What makes the dataset good rather than merely present

The difference between a directory somebody uses and one they open once:

- **Coordinates on everything.** Without them there is no "nearest", ever. Geocode from OSM
  where a source gives only an address
- **Phone numbers that dial.** Normalised to E.164 so a `tel:` link works on the first tap.
  This is the single most-used field on the whole surface at 11pm
- **Types that are right.** A warming centre filed as a shelter sends somebody somewhere that
  will not take them. When a source's category does not map cleanly, `other` is the honest
  answer and it is better than a confident wrong one
- **Deduplication that actually works.** The same shelter under two names in three sources is
  the normal case. **When unsure, keep both** — a duplicate is a nuisance; a wrongly-merged
  record is two half-truths welded together and neither is recoverable
- **Coverage over depth.** Twenty metros of skeletons beats one metro of skeletons, because
  the operator who opens this in a city nobody has touched still gets addresses and phone
  numbers

**Hours are deliberately left as free text**, not parsed into a schedule. An "open now"
indicator computed from a scraped string is a confident wrong answer waiting for a public
holiday, and it is exactly the failure the display rules exist to prevent. A human-readable
string with a visible age is the honest version.

## Where this leaves the directory

Skeletons everywhere the scraper runs — names, addresses, phone numbers, marked unverified.
Genuinely useful at 11pm and honest about what it is.

Real answers only where an operator has been. That is the part no scraper produces, and
[`propagation.md`](propagation.md) is about how it accrues.

**Scrape wide. Verify narrow.** A skeleton in twenty metros and real intake rules in the one
where somebody actually works.
