# Nav: two maps, and the line between them

The landing surface is a map. It has to be: the grid is the thing somebody is looking at
when they open this, and a search box over a list is not a situation. But "a map" is two
different products wearing one word, and the whole design is in deciding which one we build
and which one we hand off.

Status: **design, decided where marked. The grid (§3) and its Places switch (§6) are built** and
are the landing page; since 2026-10-18 every shape and point on it is a door, it opens on the whole
Earth, and places on public record are points. The road layer and the mini-map are not built; the
handoff is built for a record's point (§5). Normative sources it leans on: [`panel.md`](panel.md),
[`missions.md`](missions.md), [`directory-schema.md`](../product/directory-schema.md),
[`delivery.md`](../delivery.md).

**Nothing on this map, and nothing in any package NavCom reads, locates the people being served: no
encampments, no sleeping sites, no person's position. Places on public record are points. dv refuges
carry no coordinates at all.** That is invariant 1 aimed at the map. The map takes no coordinates as
a prop, and its only points are places of record, made in one module from two sources, verified
mission packages and the directory (`web/src/lib/grid/places.ts`); `src/lib/boundaries.test.ts`
holds both halves. **For the directory the rule is structural**: every record has a type, and every
type is decided on or off the map before it compiles. **For a package it is the publisher's duty**
(interchange spec §9.2), because a package carries no type and NavCom cannot tell a youth shelter
from a library by it; what NavCom can do is draw a package's point no finer than about a kilometre
while Q19 is open (§6), the hold the directory's shelters are under.

**Revised 2026-10-18, at the owner's direction.** NavCom is an Earth Alliance app, not a US one; the
map shaded US states while hover showed nothing and a click did nothing; and the owner asked for
circles at geolocations rather than shading, and for every rule here afraid to use a latitude and
longitude to be questioned. Three were: §5's coarse-point rule is now *a point carries the precision
its source earned*; §6's refusal to draw the directory's records is repealed; and the interchange
spec's `city`/`1km` cap is offered to partners for revision as rev 8. What was kept is the line
above, stated plainly. Left alone, because each is about a person rather than a place: the dv rule,
an operator's position (500 m, once, never sent), raw intel's geohash and its 48-hour delay, a
persona's coarse city, patrols exported without coordinates, and Agreed lines' *a record id or a
region, never coordinates*.

---

## 0. What the data already is

Measured against `web/build/directory.json` on 2026-10-05, because every argument below
turned on a number I had been guessing at:

| | |
|---|---|
| Records | 9,633 across 1,912 regions |
| **Carrying real coordinates** | **9,623 — 99.9%** |
| Extent | 71.3°N to 42.9°S, 159.4°W to 153.3°E |
| Outside North America | 541 records — UK (London, Bristol, Liverpool, Birmingham, Nottingham), Australia (Melbourne, Brisbane, Adelaide, Canberra, Gold Coast), plus AK, HI, PR |

Two things follow, and neither was a plan.

**Global is the present tense, not a roadmap item.** A basemap that stops at the US border
would be broken on the day it shipped, for records that are already published. This settles
the question rather than deferring it.

**The coordinates claimed a precision nothing earned.** They shipped at fourteen decimal places —
`34.97105026245117`, Overture's 32-bit floats printed at 64-bit length — which is nanometre
resolution on a record whose own confidence is `low` and whose address was read off a website.
The fix is in the data, not the renderer: **round each coordinate to the precision its method
earned** — five places (~1 m) for a geocoded street address, two (~1.1 km) for anything placed by
region or by hand. A renderer that truncates on the way out still ships the lie in the file
anyone can download.

**Done 2026-10-06.** All 9,623 coordinates were geocoded addresses, and all were rounded to five
places in the source files, with every other byte left as it was. The parser now refuses more than
five, the importer rounds on the way in, and region centres are published to two. A test reads the
built directory, the region centres and every record page's map link.

---

## 1. The decision

**Two surfaces with a hard line between them: the grid shows where a place of record is; the
handoff gets you to its door.** The grid zooms a long way in since 2026-10-18 (§3), so the line is no
longer drawn by zoom. It is drawn by what each surface knows: ours knows which places are on record
and where, to the precision each earned, and never which door, which street or which way.

| | What it is | Whose |
|---|---|---|
| **The grid** | Vector outlines we draw ourselves, and points for places of record: regions, records, missions, reports. The landing map, always | Ours. No third party, no key, works offline |
| **The handoff** | At the moment somebody needs a doorstep, we leave. One tap opens *their* map app with a pin | Theirs. Google, Apple, OSM, or whatever the phone has registered |

And one optional thing in between, §4: a **road layer** the operator can switch on, and a
**mini-map** that loads only when tapped.

This is the shape you proposed, and I think it is right for a reason stronger than file size.

---

## 2. Why splitting by context is the correct call

Your argument was performance: separate by UX context, defer the heavy half, ship less. That
holds, and the measured version is in §6. But the better reason is that **the two surfaces
answer different questions**, and one map answering both would answer each worse.

*"Where is anything, and what is happening?"* is a regional question. It is answered by
shape, extent and relative position — which is exactly what outlines do, and what a street
map actively obscures by burying three missions under ten thousand road labels.

*"Which door, and how do I get there?"* is a ten-metre question. Answering it well needs
routing, live traffic, transit times, the operator's own transport mode, and a voice telling
them where to turn. **That app is already on the phone**, it is better than anything we will
build, and it is the one they already trust with where they are going. Shipping our own
street tiles would be building a worse copy of an installed app and charging the operator
bandwidth for it.

So the line is not a performance budget. It is: **we own the picture, they own the pin.**

### Two caveats the split creates

**A handoff is an exit, and an exit leaks.** Every tap out hands a third party a coordinate,
a timestamp and a referrer. So: the handoff is always user-initiated and never automatic; the
link carries `rel="noreferrer"`; and no handoff is ever offered for a confidential record
(§5). The grid itself makes no request to any third party, which means **the common case —
looking at the map — tells nobody anything about where you are looking.** That is the property
worth protecting, and it is why the heavy layer is opt-in rather than lazy.

**The connections it does make are to the relays that hold the missions** (2026-10-06). Every
device reads the missions itself, from The Record and its mirror at once, and verifies each one,
because each device drawing its own picture is the architecture [CLAUDE.md]. An earlier version had the site's build
take a snapshot instead, to keep even that connection off the page; it made one build draw the
picture for everyone and tied freshness to deploys, which is the centralisation this design
exists to avoid. The cost of the direct route is small and named: each relay learns that a device
opened NavCom's missions — one subscription to all of them, never which part of the map anybody
looked at, which is exactly what a tile server would learn and why tiles stay opt-in. **It also logged
the address each connection came from**, which the grid's reader rule now says a relay must not keep
[`grid.md`](grid.md) §1; until The Record applies it, that is part of the cost.

**Deferring only pays if the deferred thing is genuinely not fetched.** A mini-map that
lazy-loads when it scrolls into view is a mini-map that loads. Click-to-load, with a
placeholder that says what tapping it will do.

---

## 3. The grid, which we draw

**Geometry.** [Natural Earth](https://www.naturalearthdata.com/), public domain, no
attribution required. **Measured 2026-10-06, and the measurement changed the plan.**

- **The 1:50m provinces cover only nine countries** — no United Kingdom, no Puerto Rico. Built
  as first written, London and Bristol would have sat inside a featureless outline. Provinces
  therefore come from the **1:10m** set, which covers 251 countries.
- **Detail follows the regions, not the world.** All 4,596 provinces worldwide plateau near
  180 KB gzipped however hard they are simplified, because the cost is per-feature rather than
  per-vertex. Provinces are drawn only for countries that have a region (today the US, the UK
  and Australia); everywhere else is a country outline at 1:110m.
- **Provinces simplified to 20%**, quantised: **55.8 KB gzipped for the whole world** with no
  properties, both layers verified present in the file — an earlier measurement that came out
  smaller had silently dropped one. At 1% it is 40.6 KB, but 372 records' positions fall
  offshore against the simplified coastline rather than 146; 15 KB is cheap for that.
- **Each shape keeps its code, and a province its name** (2026-10-18), because a hover and a tap
  name what is under them: a country's ISO 3166-1 code lower-cased as a mission files it (`ke`), a
  province's ISO 3166-2 code and its name. A country is named from its code on the phone, so only the
  two Natural Earth leaves uncoded, both disputed, carry a name. **59.1 KB gzipped**, measured: about
  +0.6 KB for the codes and +2.3 KB for the province names, with 1.1 KB of country names not shipped.
- The file is generated by `web/scripts/grid-geometry.mjs` from a pinned Natural Earth commit
  and committed, so a build never downloads it. A test fails when a region exists in a country
  the file has no provinces for, which is how "detail follows the regions" stays true.

Admin-2 (counties and their equivalents) is not in the first cut. When it comes, it comes only
where a region has records, from [geoBoundaries](https://www.geoboundaries.org/) (CC BY 4.0, so
it carries a credit) or, for the US, the Census Bureau's cartographic boundaries (public
domain).

**Placement never asks the outlines which country a point is in.** At 1:50m, El Paso's own
shelters plot inside Mexico; at 1:10m twelve records are still drawn across a border. So a
mission is placed by its jurisdiction, and the outlines are scenery: a dot a little offshore is a
cosmetic error, while a claim about which side of a border something is on would be a factual
one. The one place a record's country matters is decided from its phone number instead
[`abroad.ts`]. **A tap names the shape tapped, and nothing more** (2026-10-18): the place it opens
lists the missions *filed* under that shape's code — `ke-30` is in `ke`, `us` is in every US state —
and the directory regions nearest the tap *by distance*, never the ones a border holds.

**Projection: Web Mercator**, accepted with a known cost. Mercator is wrong for a world
view — it inflates Alaska and flatters the northern hemisphere, and an equal-area projection
would be both more honest and more distinctive. We take Mercator anyway, because §4's road
layer has to align with the grid at the same viewport, and a reprojection at switch time
turns a layer swap into a different map. One projection, two layers. **Decided 2026-10-18
(D1): Equal Earth replaces Mercator, before any Zone is drawn.** The road layer is not built, the map
opens on the whole Earth, and Starcom's Zones run pole to pole, while Mercator stops at 85° and leaves
Antarctica out. Not built yet: until it is, Mercator stays.

**How far in** (2026-10-18). Down to about 15 m a pixel on a phone at 52°N, so a street's records
separate. The outlines are 1:10m at best and look it there; what is worth drawing that close is the
records, at the precision their positions earned (§5), and the doorstep is still the handoff's (§1).
A region's ring gives way to its records at about 2 km a pixel, where a region is still many pixels
across: its centre is a statistic of its records, not a place, and drawn closer in it would sit on
one block and read as one. It was 500 m until a review found exactly that (2026-10-18). For the same
reason a region is a hollow ring and a record a dot.

**Canvas 2D, not SVG.** Three thousand county paths as DOM nodes is the thing that kills a
prepaid Android 8 with 400 MB free — the device floor is in [`delivery.md`](../delivery.md)
and it is a real phone. Paths draw to canvas. A tap, a hover and the keyboard's reticle share one
hit-test, `web/src/lib/grid/pick.ts`: each shape's box first, then its rings, in a fixed order — a
point, then a shape a mission fills, then a province, then a country. A national mission's outline
is not a fill: it holds every state inside it, and answering first it opened the United States for a
tap on Texas (review, 2026-10-18). There is no quadtree: an earlier version of this page said there
was, and at 471 shapes a box test is enough. A filled shape answers within 12 px of its edge, because
at the whole-world zoom California is 11 px wide on a Pixel 5.

**Both themes are ours**, which is the quiet advantage of drawing it: there is no white tile
to dim and no third-party style to fight. Colours come from `panel.md`'s tokens, so dark is
the default rather than a filter over somebody else's daylight.

---

## 4. The switch, and the mini-map

Three layers. Only the first is on at first paint.

| Layer | Source | Default |
|---|---|---|
| **Grid** | Ours | **On.** No third-party request; one subscription each to The Record and its mirror, for missions |
| **Roads** | [OpenFreeMap](https://openfreemap.org) public instance — OSM vector tiles, no key, no registration, no cookies, dark styles available | Off. Loads when chosen, and says what choosing costs |
| **Satellite** | — | **Declined.** No free keyless source whose terms permit it |

**OpenFreeMap is the right dependency and an honest risk.** It is keyless and unmetered by
its own statement, fully open source including the production setup, and it has served
MapHub in production since June 2024. It is also one person's donation-funded project, which
means "no limits" is a promise rather than a contract. We take it on two conditions: the grid
never depends on it, so an outage degrades the road layer and nothing else; and because the
whole stack is published, **self-hosting it on our own boxes is the fallback** — which is the
same answer as your IPFS and server capacity, pointed at the one layer that needs it.

**The mini-map**, on a record or a mission: a single still frame, click-to-load, sized to its
slot, with the handoff beneath it. It exists to orient, not to navigate. If it ever grows a
zoom control it has become the thing we decided not to build.

---

## 5. The handoff

One lit action — `panel.md`'s rule — reading **Open in maps**, which picks the form that
matches the platform. The alternatives sit behind a disclosure, because an operator with a
preference should not have to fight ours.

| Platform | URL | Note |
|---|---|---|
| Android, any map app | `geo:LAT,LON?q=LAT,LON(LABEL)` | RFC 5870. The OS asks which app — our preference never enters it |
| Apple | `https://maps.apple.com/?ll=LAT,LON&q=LABEL` | Plain HTTPS: opens Maps on Apple devices, the web map elsewhere |
| Any platform | `https://www.google.com/maps/search/?api=1&query=LAT,LON` | No key required |
| Any platform | `https://www.openstreetmap.org/?mlat=LAT&mlon=LON#map=17/LAT/LON` | The one that bills nobody |

Three rules on top of the table, and these are the part that matters:

1. **The link carries the precision the record earned and no more.** Five decimals for a
   geocoded address, two for a coarse point. A handoff is where false precision becomes a
   person standing in the wrong parking lot.
2. **No handoff for a confidential record.** `dv` records carry no coordinates by
   construction, and the map must read that through `isConfidential` and `LOCATING_FIELDS` in
   `packages/core/src/directory/confidential.ts` rather than checking it again here. The
   comment in that file already says why: an address can be vague, a coordinate pair never
   is, and it survives every UI that decides not to print the address.
3. **A point carries the precision its source earned, in storage**, not rounded at render: five
   places for a geocoded address, coarser where the method was. A mission's subject on public
   record may be placed at its address; a point that stands for a jurisdiction is a city at most,
   whatever it declares, because a jurisdiction has no doorstep [core: `missions/package.ts`].
   Anything finer than the source earned is one component away from publishing a doorstep.
   *Revised 2026-10-18:* it read "a mission's coarse point is coarse in storage", which capped every
   mission at about a kilometre, a public facility included.

---

## 6. What is on the grid when it opens

**Decided 2026-10-06: missions by default, places behind a switch.** The directory's 1,912 region
circles make the map look alive at once, and they also compete with the missions for the eye. So the
landing map opens on what there is to do, and one control shows or hides where the directory
reaches. Built the same day; the switch was **Coverage**, and is **Places** since 2026-10-18.

**It opens on the whole Earth** (decided by the owner, 2026-10-17). It used to frame where most
regions are, and 1,889 of the 1,912 are in the US, so it opened on the US. NavCom is an Earth
Alliance app, and the opening view is exactly what *Show the whole map* shows, with the land centred
in what nothing covers — above the phone's sheet at peek, or beside the wide screen's sidebar — and
nothing moves it until a person does. Province detail still follows the regions, because that is
what the data holds; every country lights and answers anyway.

**Every shape and point is a door** (2026-10-18; it was *a lit province is a door*). A hover, with a
mouse or a pen, lifts the outline under the pointer and says what it is and what is open there —
*California · 1 open mission*, *Kenya · Nothing open*. A tap opens it in Com: a province or a country
as a place, listing what is filed under it and the directory regions near the tap; a mission's ring
as that mission; a region's ring or a record's point as that place. **What a tap took stays lifted**
while its screen is the one open, because a finger has no hover and a thumb-wide tap at the
whole-Earth view can take a neighbour. **A tap is measured no more finely than a thumb resolves**:
at the whole-Earth view on a phone a thumb is the better part of a thousand kilometres, so the place
lists the nearest regions without distances and says to zoom in to measure; closer in, it gives each
in km. The keyboard gets the same: a reticle at the centre of what nothing covers, a polite readout
of what is under it as the arrows pan, and Enter to open it. The missions line in the map's key still
opens every mission, and the search every region and record, for anybody who cannot or does not use
the map. **Every mission lands somewhere:** filed under a province the file has, it lights that
province; under one it does not (`ke-30`), it lights the country; filed nationally, it outlines the
country, and a tap on a state inside it is still that state, whose place lists it.

Open and claimed missions, and public reports, and with Places on, **the directory's places as
points**. *Repealed 2026-10-18:* this said "Not the 9,623 directory records", on the ground that ten
thousand pins is a heat map of where somebody once ran a scraper. The owner's answer is that places on
public record may be points, and the map now draws them — further out than about 2 km a pixel as
each region's ring, which says how many places it holds, and closer in as each record's point, at four
places (about 11 m). The points come from one file, `/grid/places.json`, fetched whole the first time
Places is switched on and never by what is on screen (§2), in the order of each region's own index, so
a tap reads the record from the same file a search does. **The places people sleep stay off the map
(D5, decided 2026-10-18)** — shelters, youth programmes, overnight warming and residential detox:
they are published facilities, and some providers may still read a map of where they cluster as
locating the people they shelter. They stay in the directory and on their own pages at five places.
Every type is decided on or off in one table (`ON_THE_MAP`), so a type added later is a decision before
it is a point. **Where records are drawn, a region with places held back keeps a dashed ring** that
says how many are not on the map, and its place says so too, so Baltimore, whose records are all
shelters, reads as that and not as nothing (invariant 7). A mission's ring is drawn where a package
locates its subject on public record, in ink rather than a hue, never smaller on screen than its
precision covers — **and no finer than about a kilometre, at the point it rounds to, while Q19 is
open**: a package carries no type, so the hold on the directory's shelters has to hold
for a package's address too. A mission filed only under a jurisdiction keeps its shading, because a
circle at a state's middle would invent a place somebody might head for (D4, decided 2026-10-18).

**Places is offered only on a drawn map.** Without script, or with the map's code or geometry not
arrived, the switch is disabled, and where the map would be the page links to the directory, which
works with neither. When Places' own files do not arrive, the key says *Places not loaded*, and the
next time it is switched on asks again.

Budgets, all of them targets to measure rather than claims:

| | Target |
|---|---|
| Grid geometry, world outlines + provinces where regions are | ≤ 250 KB gzipped — **measured 59.1 KB** (2026-10-18, with codes and names) |
| Places, every record the map draws | ≤ 80 KB gzipped, **only when Places is switched on** — never at mount, never in the install precache |
| Mount, every visit: the map's code, the mission feed, Com's registry and the geometry | ≤ 129 kB gzipped, **enforced** since 2026-10-18 (`MOUNT` in `web/scripts/lib/budget.mjs`) — measured 107.6 kB, of which 58.3 kB is the geometry at the build's gzip level |
| Requests at first paint to anyone but navcom.app | **None** — the mission subscriptions open after first paint, to The Record and its mirror only |
| Repeat visit, no new deploy | Zero network for the grid — service worker now covers the whole origin |
| Device floor | Interactive on a prepaid Android 8, 400 MB free |

---

## 7. Open, and who answers it

- ~~**Measure the geometry.**~~ Done 2026-10-06; §3 has the numbers and what they changed.
- ~~**The over-precise coordinates are a data fix**~~ Done 2026-10-06, in the data rather than the
  map (§0): all 9,623 published coordinates.
- **Satellite is declined**, per [`declined.md`](../declined.md)'s rule that a gap may be
  closed rather than carried.
