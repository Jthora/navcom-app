# Licensing

Three licences, because three different things live here and they have genuinely different
reuse profiles. Conflating them is the usual mistake.

| What | Where | Licence | |
|---|---|---|---|
| **Code** | `web/`, tooling | **Apache-2.0** | [`LICENSE`](LICENSE) |
| **Directory data** | `data/` | **CC0 1.0** | [`data/LICENSE`](data/LICENSE) |
| **Documentation** | `docs/` | **CC BY 4.0** | [`docs/LICENSE`](docs/LICENSE) |

## Why each one

**Code — Apache-2.0.** A patent grant, and an explicit *non*-grant of trademark. The second
matters more than usual here. "NavCom" carries a promise about behaviour — that `Distress`
ends in a human or reports that it couldn't, that the directory shows its age rather than
guessing. Apache section 6 means you can fork the code and cannot take the name with it. A
careless fork trading on that name is a real hazard when the name is the safety claim.

**Directory data — CC0 1.0.** The directory is a public good or it isn't. A city, a 211
service, a mutual aid group or a street medic should be able to use corrected data with
zero friction and no lawyer. Anything less permissive — including NonCommercial, which
sounds protective — would block exactly the reuse
[`docs/product/propagation.md`](docs/product/propagation.md) names as a growth mechanism.

CC0 is also the honest choice about what is being claimed. Facts about a shelter's opening
hours may not be copyrightable at all in many jurisdictions, and asserting a right that may
not exist would be its own small overclaim.

**Contribution credit survives this.** CC0 does not stop NavCom crediting the callsign in
`verified_by`, and [`docs/product/identity.md`](docs/product/identity.md) makes contribution
one of the two axes of standing. What CC0 gives up is *legally compelling* downstream
reusers to carry that credit. That is a price worth paying for a shelter list that anyone
can use.

**Documentation — CC BY 4.0.** These are argued documents rather than reference tables, they
get quoted, and attribution is reasonable to ask for.

## What no licence does

Every licence here disclaims warranty, so that much is covered. **None of them tells a human
that the data is time-sensitive**, and that is the failure this project is most exposed to,
because someone acts on it at 10pm outside a closed door.

So, in plain language and not in legal language:

> **This directory is maintained by volunteers. It shows how old every perishable fact is,
> on purpose. When a check is too old to trust, it says "call first" — that is a real
> answer, not a missing one. A blank means nobody has established something, never that
> there is no restriction. Please call ahead before sending anyone anywhere.**

## There is no organisation behind this

NavCom is not a business, not a non-profit, and not a registered entity. Nobody is trying
to make money from it and there is no company to sue, sponsor, or join.

That is not a disclaimer — it changes what these licences actually do, in three ways worth
stating plainly.

**Copyright rests with contributors, not an organisation.** There is no entity to hold it
and none is needed. Each person owns what they wrote and licenses it to everyone else under
the terms here. No CLA, no assignment, no paperwork.

**The trademark clause is intent, not enforcement.** Apache section 6 withholds trademark
rights, but with no entity there is no registered mark. Common-law rights from use are weak
and jurisdiction-bound, and enforcing them takes standing and money that do not exist here.
The request stands and rests on good faith: fork the code, and call it something else,
because the name is a claim about behaviour.

**It is why the data is CC0 rather than share-alike.** A copyleft data licence only protects
anything if somebody will enforce it. Choosing one here would impose real friction on a 211
service or a city — the exact reuse this project wants — in exchange for a protection that
exists only on paper. Permissive is the honest choice when enforcement is not available.

### What this means for data from elsewhere

CC0 has a consequence worth naming, because it constrains how the directory can grow.

**OpenStreetMap is ODbL**, which is share-alike for databases. Extracting names and
addresses from it in bulk would make this a derivative database and pull the whole directory
out of CC0. So OSM is used as a **candidate generator** — it proposes places that might
matter, a person establishes the facts, and only what was independently established is
published. Candidates are a working artifact and never become published data.

> **Not true of the directory until 2026-09-13.** 1,135 records across 58 regions in
> `data/regions/` had been built from OpenStreetMap directly, against this rule, and none of
> them had been checked by a person. An audit found them that day, and they were replaced from
> Overture Maps, along with 43 candidate lists that were names and links extracted from OSM.
> Earlier snapshots and the git history still carry them. Cardiff, where Overture lists nothing
> that qualifies, is empty as a result.

Records enter `resources.csv` sourced from the organisation's own site, government open
data, or a person who went there. Government open data is public domain and strong in the
United States, patchy elsewhere; OSM is global and ODbL. **No single source is both**, and
pretending otherwise is how a licence gets quietly broken.

**Overture Maps places are not CC0 either, and do not need to be.** Nearly all of the directory —
9,623 records — comes from Overture's places data, which carries the terms of whoever contributed
each place: CDLA Permissive 2.0 for most, Apache 2.0 with Foursquare's copyright notice for
Foursquare's, and CC0 for AllThePlaces'. None is share-alike, so the directory can stay
permissive. But CDLA Permissive 2.0 requires its own text to travel with the data, and
Foursquare's notice has to be kept. **They ship beside the data**:
[`data/regions/NOTICE.md`](data/regions/NOTICE.md), with both licence texts next to it. They sit
in `data/regions/` rather than beside `data/LICENSE` because that folder is what the
content-addressed archive packs, so the notices travel wherever a snapshot does. They were found
missing by the same audit, and added in the same change that replaced the OpenStreetMap records.

The attribution Overture asks for: *Overture Maps Foundation, overturemaps.org.*

## Contributing

By contributing you agree your contribution is licensed under whichever of the three covers
the files you touched. You keep your own copyright — there is no entity to assign it to and
none is wanted. No CLA, no paperwork.

**Never contribute anything about the people being served** — no licence makes that
acceptable, and it is refused rather than edited. See
[`CONTRIBUTING.md`](CONTRIBUTING.md).
