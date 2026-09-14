# Contributing

**What this project most needs is local knowledge, not code.**

That is the opposite of most repositories, and it is not a polite way of saying pull
requests are unwelcome. The engineering here is roughly 20% of the work. The other 80% is
whether the directory is *accurate*, and accuracy comes from people who were on that block
last night — not from anyone who can write TypeScript.

If you do outreach or patrol, and you know which listing is wrong, **that is the most
valuable contribution available.**

---

## The one rule that never bends

**Never record anything about the people being served.** No names, no descriptions, no
locations of individuals, no medical detail, no photographs — not in a field, not in the
notes column, not in a commit message.

This directory describes **services**, never recipients. There is no field for it because
there must never be one. A contribution containing any of it will be rejected, not edited.

## Correcting or adding an entry

Entries live in `data/regions/<region>/resources.csv`. Edit the row, open a pull request.

Before you do, run:

```sh
cd web && npm install && npm run check:data
```

It reports two things and the difference matters. **Errors** mean the data is invalid.
**Warnings** mean it is legal but a human should look — because the dangerous entry is
never the malformed one, it is the plausible one. A guessed intake rule parses perfectly.

### What goes in `verified_by`

A callsign, or `anonymous`. **Never a legal name** — not yours, not a staff member's. The
checker warns on anything containing a space.

### What `method` means

It decides how much the entry is trusted, so it has to be honest:

| | |
|---|---|
| `in_person` | You were there |
| `staff_confirmed` | Staff told you directly |
| `phone` | You called |
| `secondhand` | Someone told you |
| `website` | You read it on their site |

`website` and `secondhand` mark the entry as **seeded** — the site renders those visibly
differently, because low-confidence data that looks authoritative is more dangerous than no
data at all.

### Blank is not "no restriction"

A blank field renders as **unknown**. That is deliberate and it is load-bearing.

Leaving `pets` blank says *nobody has established whether they take dogs*. Writing `no`
says *they refuse dogs*. Someone sleeping outside with a dog will act on the difference. If
you do not know, leave it blank.

The same applies to `reports_to`, where it matters most: `no_one` means the service does not
pass information to police or immigration. Blank means nobody asked. **Those are not the
same fact**, and the second one is not a reason to guess the first.

## Seeding a region that has nothing

**Seed structural facts. Never invent an intake rule.**

Name, address, type, phone and published hours are public and checkable — take them from
official listings at `method: website`, and the site will present them as unverified.

The intake fields are different. `sobriety`, `pets`, `id_required`, `referral_required`,
`sex_offender_ok`, `reports_to`, `curfew`, `belongings` — these are the fields the directory
exists for, and official listings omit them *precisely because nobody maintains them*.

You may record one **if the service published it.** You may never record one because it
seemed likely. Nothing in a CSV can tell those apart, which is why the checker warns on
every intake rule recorded at `method: website` and asks a person to confirm.

A plausible guess looks like data, reads as authoritative, and sends someone somewhere that
turns them away at 10pm. That single failure is what the entire schema is shaped to prevent.

## Adding a new region

Copy `data/regions/_template/` to `data/regions/<slug>/` and fill in `region.json`.

The manifest carries what a row cannot say for itself — country, IANA timezone, languages,
and whether anyone has actually checked the data. Details in
[`data/regions/README.md`](data/regions/README.md).

**Ids are globally unique**, so prefix them with your region: `berlin-central-shelter`. The
build fails on a collision.

## The taxonomy is not finished, and it shows where it was written

`type` currently reads: shelter, meal, hygiene, medical, harm reduction, warming, cooling,
storage, legal, id_docs, mail, charging, veterinary, youth, dv, detox, daytime.

**That list is Anglosphere-shaped.** `warming` and `cooling` assume a temperate climate with
a specific emergency-response model. `mail` assumes general-delivery services. `id_docs`
assumes a particular documentation regime. Elsewhere the decisive categories may be water
points, cash assistance, migration and asylum support, family tracing, or things nobody
here has thought of.

`sex_offender_ok` is the clearest case: a real constraint where a public registry exists,
and meaningless — possibly stigmatising — where none does.

**Proposing a new type is a welcome contribution, and it needs local knowledge to be worth
anything.** Open an issue saying what the category is, where it applies, and what someone
would use it to decide. We are not going to invent global service categories from an
armchair, for the same reason we do not invent intake rules.

## What is not accepted from strangers

**Playbook and field guidance content** — de-escalation, first aid, overdose response,
rights. Not because contributors are unwelcome, but because confident wrong guidance in
those places gets someone hurt, and reviewing it needs real expertise rather than good
intentions. If you have that expertise, open an issue and say so first.

## Code

Welcome, but read [`CLAUDE.md`](CLAUDE.md) and [`docs/principles.md`](docs/principles.md)
first. This project has refused a lot of obvious features on purpose, and the reasoning is
written down.

Two things that will be sent back regardless of quality: **anything that adds a feed**, and
**anything that adds an analytics or telemetry dependency.** Both are refused at the
principle level.

```sh
cd web && npm run verify    # type-check, data check, build, tests, bundle budget
```

All of it must pass. The bundle budget is enforced because the device floor — a prepaid
Android 8 with 400MB free — is a real target and not an aspiration.

## Merging to main

`main` is what navcom.app deploys from. **Nothing merges to it until somebody other than its
author has read the diff against the invariants in [`CLAUDE.md`](CLAUDE.md)** — a second person,
or at minimum a fresh reviewer with none of the author's context.

The reason is not distrust of any particular author. A patient, plausible change is
indistinguishable from a good one to the person who wrote it, and this project's answer to that
everywhere else is bounded authority rather than better self-checks. It applies to agents working
here too: **an agent does not merge its own branch.**

**Nothing enforces this yet.** GitHub branch protection needs a second account with write access,
and the project has one maintainer — see [`build-order.md`](docs/build-order.md) 9.4. Until then it
is a rule kept by hand, which is exactly the kind this project distrusts, so it is written where
somebody will see it being broken.
