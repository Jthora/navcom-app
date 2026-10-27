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

### The map's own data

**Natural Earth** draws the grid's outlines and its time zones (`web/static/grid/world.json`,
`web/static/grid/timezones.json`), and gives the label points a small state is drawn at as a circle
when a Sphere names it (`web/scripts/data/label-points.json`, D9). It is public domain, so it binds
nothing; it is credited anyway, on the map's own layers screen. Day and night is worked out on the
phone from its own clock, and draws on no data at all.

**Starcom's Zones** (the Zone and Sector Protocol 2.0 partition, `web/static/grid/zsp/`) are **CC BY
4.0**, vendored final on 26 October 2026 from starcom-app `ec6714b9`. Attribution only, so the code and
the directory keep their own licences. What it asks for travels with them: the layers screen and the
map's own readout carry the credit, *Zones: Starcom ZSP 2.0, CC BY 4.0*. NavCom's vendoring script refuses any
set, or any source a Sector's lines were drawn from, that is share-alike or non-commercial
[`docs/design/map.md`](docs/design/map.md) §8. **The code that reads them is NavCom's own**: Starcom's code
is AGPL-3.0-only, which would bind an Apache-2.0 codebase, so none of it is copied, and a test fails if
anything under `packages/core/src/zones/` carries its licence.

**The Spheres' membership lists** (`web/static/grid/spheres.json`) are Mecha Jono's Part 2, lists 1.0,
**CC BY 4.0**, vendored on 26 October 2026 from starcom-app `ec6714b9` by `web/scripts/spheres-vendor.mjs`,
which refuses lists, or any cited source, that are share-alike or non-commercial. The map's foot and the
layers screen carry the credit, *Spheres: Mecha Jono, ZSP 2.0 Part 2, CC BY 4.0*, and the lists are
labelled a draft until their author says otherwise. NavCom's own test fixture never ships. The reader is
NavCom's own too (`packages/core/src/spheres/`), with the same test.

Eight of the Spheres cite **Unicode CLDR** (the official status of each language in each territory) or
the **Unicode Han Database** for who is in them. Both are under the Unicode License v3 (`Unicode-3.0`),
which asks only that this notice go with copies, so NavCom takes it as attribution only (the owner,
2026-10-26). What NavCom ships from them is a list of country codes, with the source named and linked,
and the notice, in full:

```
UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 1991-2025 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.

SPDX-License-Identifier: Unicode-3.0
```

**Hazards and the weather warnings are read live and never vendored** (2026-10-19,
[`docs/design/map.md`](docs/design/map.md) §8): nothing of them is in the repository or in any build, so
they bind nothing NavCom ships. The U.S. Geological Survey's earthquake feeds and the National Weather
Service's alerts are works of the US government and in the public domain. NASA EONET asks to be credited,
and GDACS, the Global Disaster Alert and Coordination System of the United Nations and the European
Commission, publishes terms of its own; both are credited by name on every screen that shows a mark of
theirs, and whether GDACS's terms ask more of NavCom than that is for the owner to confirm before this
ships. The code that reads them (`web/src/lib/grid/layers/hazards.ts`, `web/src/lib/missions/nws.ts`) is
NavCom's own: Starcom's readers of the same feeds are AGPL-3.0-only, and none of them is copied.

## Contributing

By contributing you agree your contribution is licensed under whichever of the three covers
the files you touched. You keep your own copyright — there is no entity to assign it to and
none is wanted. No CLA, no paperwork.

**Never contribute anything about the people being served** — no licence makes that
acceptable, and it is refused rather than edited. See
[`CONTRIBUTING.md`](CONTRIBUTING.md).
