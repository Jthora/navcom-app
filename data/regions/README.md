# Regions

One directory per region. Each holds its own `resources.csv` and a `region.json` that
carries what the rows themselves cannot say.

```
data/regions/<slug>/resources.csv
data/regions/<slug>/region.json
```

## Licences

What contributors wrote is CC0 ([`data/LICENSE`](../LICENSE)). **Rows seeded from Overture Maps
keep their sources' terms**: mostly CDLA Permissive 2.0, some Apache 2.0 from Foursquare, and some
CC0. Those terms travel with the files in [`NOTICE.md`](NOTICE.md),
[`LICENSE-CDLA-Permissive-2.0.txt`](LICENSE-CDLA-Permissive-2.0.txt) and
[`LICENSE-Apache-2.0.txt`](LICENSE-Apache-2.0.txt).

They sit in this folder, not beside `data/LICENSE`, because this folder is what the
content-addressed archive packs, and CDLA Permissive 2.0 requires its text to go wherever the
data is shared. The reasoning is in [`LICENSING.md`](../../LICENSING.md).

## Why the manifest exists

A row says a place opens at `19:00`. Nothing in the row says **local to where** — and a
directory meant to work outside one country cannot leave that implied. The manifest
supplies the context every row in the folder inherits:

| Field | | |
|---|---|---|
| `slug` | Folder name, and the id prefix convention | `berlin` |
| `name` | What people there call it, in their language | `Berlin` |
| `country` | ISO 3166-1 alpha-2 | `DE` |
| `timezone` | IANA. Makes `hours` and `curfew` mean something | `Europe/Berlin` |
| `languages` | ISO 639-1, the languages this data is written in | `["de", "en"]` |
| `status` | `example` · `seeded` · `maintained` | |

`status` is the honest one. **`seeded` means nobody has checked any of it** — it came from
public sources at low confidence. `maintained` means real people correct it. The site says
which, because a reader deserves to know whether anyone has been there.

## What is deliberately not here

**Hemisphere.** It would only affect the *name* of a season, which nothing renders, and the
staleness trigger is hemisphere-independent by construction — see `seasonIndex` in
`web/src/lib/directory/volatility.ts`. Where a record has a latitude the hemisphere is
derived from it. A manifest field for something nothing reads would be speculation.

**Administrative hierarchy.** No state, province, prefecture, oblast, governorate or
county. The world does not agree on those and modelling them is a hole with no bottom. A
region is a flat slug with a country code.

## Ids are globally unique

Not per-region. URLs are flat — `/directory/<id>/` — so two regions cannot both use
`central-shelter`. Prefix with the region slug: `berlin-central-shelter`. The loader fails
the build on a collision and names both regions.

This is a deliberate trade. Namespacing URLs per region would remove the constraint, at the
cost of changing every existing link. With a handful of regions the convention is cheaper;
if that stops being true, namespacing is a contained change to one route.
