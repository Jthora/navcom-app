# Nav: two maps, and the line between them

The landing surface is a map. It has to be: the grid is the thing somebody is looking at
when they open this, and a search box over a list is not a situation. But "a map" is two
different products wearing one word, and the whole design is in deciding which one we build
and which one we hand off.

Status: **design, decided where marked. The grid (§3) and its Places switch (§6) are built** and
are the landing page; since 2026-10-18 every shape and point on it is a door, it opens on the whole
Earth, and places on public record are points. Since 2026-10-19 it is drawn in Equal Earth, Antarctica
included (§3), and has layers somebody chooses: Nation States, Starcom's Zones, the Spheres, Time zones,
or none (§8). Over a layer, since the same day: day and night, worked out on the phone; the directory's
regions by when they were last checked; and open missions counted by Zone. Spheres and Zones are built
against NavCom's own fixtures until their data lands, and nothing synthetic ships. The road layer and
the mini-map are not built; the
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

**Projection: Equal Earth** (Šavrič, Patterson and Jenny, 2018), **decided and built 2026-10-18
(D1)**, in place of Web Mercator. Mercator stopped at 85°, left Antarctica out, and drew Greenland
larger than Brazil. Its one reason here was that §4's road layer would have to line up with the grid
at the same viewport, and that layer was never built. Starcom's partition runs pole to pole and
defines a Sector by its area on the ground (50,000 to 500,000 km²), so the grid draws the whole Earth,
Antarctica included, at its true areas. The world is about 2.05 times as wide as it is tall, so on a
portrait phone it is a band with room above and below it, and the opening view places it (§6).

One projection is shared by everything that places something: the geometry, the points, the tap's
inverse, a mission ring's size (equal-area, so a circle of *r* metres is drawn with its own area
anywhere), and the browser tests, which import it rather than write it out again
(`web/src/lib/grid/topology.ts` `project`, `unproject`). Changing it again is one edit. The Zone
lookup is the exception, on purpose: it is answered in longitude and latitude, never projected
(§8). If a road layer is ever built, it is a separate view behind a visible switch, not this map
reprojected.

**How far in** (2026-10-18). Down to about 20 m a pixel on a phone at 52°N, so a street's records
separate. The outlines are 1:10m at best and look it there; what is worth drawing that close is the
records, at the precision their positions earned (§5), and the doorstep is still the handoff's (§1).
A region's ring gives way to its records at about 2 km a pixel, where a region is still many pixels
across (about 2.7 km under Equal Earth, which keeps that figure by area at every latitude): its centre is a statistic of its records, not a place, and
drawn closer in it would sit on one block and read as one. It was 500 m until a review found exactly
that (2026-10-18). For the same
reason a region is a hollow ring and a record a dot.

**Canvas 2D, not SVG.** Three thousand county paths as DOM nodes is the thing that kills a
prepaid Android 8 with 400 MB free — the device floor is in [`delivery.md`](../delivery.md)
and it is a real phone. Paths draw to canvas. A tap, a hover and the keyboard's reticle share one
hit-test, `web/src/lib/grid/pick.ts`: each shape's box first, then its rings, in a fixed order — a
point, then a shape a mission fills, then a province, then a country. A national mission's outline
is not a fill: it holds every state inside it, and answering first it opened the United States for a
tap on Texas (review, 2026-10-18). There is no quadtree: an earlier version of this page said there
was, and at 471 shapes a box test is enough. A filled shape answers within 12 px of its edge, because
at the whole-world zoom on a phone California is about 10 px across and a thumb is several times that.
The 12 px is the finger's, so it stays 12 px however narrow the world is drawn (§6).

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
Alliance app, and the opening view is exactly what *Show the whole map* shows, and nothing moves it
until a person does. **The whole Earth sits in what nothing covers** (2026-10-19): clear of the map's
key and its controls, and above the phone's sheet **at half as well as at peek**, because every screen
a tap on the map opens comes up at half, the layer picker among them, and what a tap lifts or a layer
draws has to be in view while its screen is open. On a wide screen that is the whole canvas beside the
sidebar, the world as wide as it, with the key and the controls in its empty corners. On a phone the
controls' column runs down the side the world would fill, so the world is drawn a little narrower,
left of them and under the key: about 317 px of a Pixel 5's 393. Zooming out goes no further than
that, so the whole map is still the whole map. **A lit shape's 12 px reaches further there, and that
is kept** (2026-10-19): at 317 px it spans about 13.6° of longitude at the equator where 393 px gave
11°, so at the opening view a tap in the middle of Texas takes a lit California, 11.6 px away. The
slack is a thumb's, which does not shrink with the world, and a California 5 to 10 px across needs
all of it; capping it by ground instead would take the slack away where the shapes are smallest.
What a tap took stays lifted while its screen is open, so a finger sees which it got, and one step
of zoom parts the two. The browser tests' Texas sits past the 12 px for that reason. The key and the sheet's two heights are measured, not
assumed (`--map-inset`, `--map-reach`, and the key's own box), so a change to either moves the view
with it. Province detail still follows the regions, because that is
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
| Mount, every visit: the map's code, the mission feed, Com's registry and the geometry | ≤ 129 kB gzipped, **enforced** since 2026-10-18 (`MOUNT` in `web/scripts/lib/budget.mjs`) — measured 110.1 kB on 2026-10-19, 51.4 kB of script and 58.7 kB of geometry at the build's gzip level. It was 107.6 kB the day before; the layers and Equal Earth added the projection, the hooks each layer draws through, and an opening view that keeps the Earth uncovered, and the deferred line, which counts mount too, was re-derived for them, to 69 kB |
| The layers somebody chooses, and what is drawn over them: Zones' outlines, one Terra or Mare's Sectors, the Sector lookup and its index, Time zones, Spheres, day and night, the directory by last check, missions counted by Zone | **A line each**, `MAP_LINES` in `web/scripts/lib/budget.mjs`, enforced since 2026-10-18. Each line has a ceiling for its code and one for its data, and a line's code is never charged to the shared deferred line, which had 1.6 kB left that day. A line whose code or data reaches the build before its ceiling is derived fails the build, and so does one whose code loads at first paint or mount. Measured 2026-10-19: the layers' screens 6.1 kB of code, of a 6.8 kB ceiling derived at 5.6 kB, the Sector screen that fetches nothing and the time screen that says when its code did not arrive adding 0.4 kB; Zones 1.4 kB; the Sector lookup 1.3 kB; Time zones 1.3 kB, and 52.4 kB of data (the bands, 43.3 kB, and each region's IANA zone, 9.2 kB), ceiling 63 kB. Zones' files have no ceiling until Stage 1 is vendored, and the vendoring change derives it. **Measured again that evening**, with the four slices of §8 in: the layers' screens 10.1 kB, re-derived to 12.1 kB for the boxes, the full key of the ages, a Zone's missions and a fifth screen, a Sphere's; day and night 1.5 kB of code and no data, ever; the directory by last check 1.9 kB and 10.8 kB of data (`/grid/region-ages.json`, which grows with the directory); missions by Zone 2.0 kB and no data; Spheres 2.0 kB of code, their data without a ceiling until the lists are vendored. Mount grew 1.8 kB, to 111.9 kB, for the overlays' hooks, the key under the key and the redraw on Low signature, and first paint 16 B, to 60,871 B of 61,440 |
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
- **Zones from Stage 1 (23 Oct), and every stage after it**: run `web/scripts/zsp-vendor.mjs` on
  the stage as it lands in starcom-app, with the manifest's digest as reviewed and the attribution
  the licence asks for, then derive the Zones lines' ceilings from what the build measures (§8).
- **Spheres** (§8) wait on Mecha Jono's Part 2 lists, due 26 Oct. When they land, run
  `web/scripts/spheres-vendor.mjs` on them where they land in starcom-app, with the manifest's digest as
  reviewed and the attribution the licence asks for, `--final` only if their author says they are, then
  derive the Spheres line's data ceiling from what the build measures, and record the licence in
  `LICENSING.md`:

      node scripts/spheres-vendor.mjs --repo ../../starcom-app --commit <sha> \
        --manifest-sha256 <hex> --credit "<the attribution the licence asks for>"

  It assumes `public/geopolitical/spheres/manifest.json`, the path Starcom's Spheres mode reads. **For
  the owner**: which repository, path and commit the lists land at; their licence and exact credit;
  whether they are draft or final; and whether Organisations (`union:*`) are drawn too.
- **A Zone in the interchange.** NavCom's packages carry no Zone, so a mission filed only by
  jurisdiction cannot be counted in one without inventing a place (§8, Missions on Zones). Counting them
  honestly needs a `["zone", id]` or `["zone_sector", id]` tag from the publisher: a rev 9 ask to
  partners, which is the owner's to make. The ids change at Starcom's 12 November swap.
- **The directory's cliff, 2 December 2026.** Of the 1,911 regions with places, 1,846 were last checked
  on 3 September, so on 2 December every one of them turns from *14–89 days ago* to *90+ days ago* on
  the map, the day their pages mark what they hold past its slow window stale; one turns on 16 November
  and the last 64 on 13 December. That is the map being right. Checking them again is human work, and
  nothing here does it.

---

## 8. Layers

**Decided 2026-10-18 (the owner's map decisions D6 to D10), built 2026-10-19.** The grid divides the
Earth one way at a time, and somebody chooses which: **Nation States**, which is what it always drew;
**Zones**, Starcom's partition of the whole surface; **Spheres**, cited lists of countries (D9); **Time
zones**; or **None**, the land and the missions alone. A choice leaves that layer on and the others off,
as Starcom's picker does. **Over** whichever is chosen, things that divide nothing and answer no tap of
their own: day and night, over any layer and always with Time zones; the directory by last check, over
Nation States; and open missions counted by Zone, with Zones. The missions light whichever is drawn, because they are not a
way of dividing the Earth, and a lit shape answers a tap first in every layer, after a point and with
the same 12 px, so it stays a door (§6) whatever is drawn under it. The choice lasts the page's life
and is not stored.

The picker is a screen in Com, opened by the map's *Map layers* control, so nothing it opens can
cover Distress [`com.md`](com.md) §4; `e2e/com-distress.spec.ts` taps for Distress over it, and over
every screen a layer opens, at every height of the sheet.

**Drawn in neutral weights only.** Every hue on these screens is a watch state, so Starcom's earth
hues are not copied: a layer is lines and lifts in brightness, from `panel.md`'s tokens. **And never told
apart by tone alone** (2026-10-19): in Low signature the three text tones are close (ink to muted ΔE 10,
muted to faint ΔE 2, below what the eye separates at a glance), so every class drawn here is carried by
shape, fill and size, and tone only adds to it. The colours are read from the tokens on every frame,
and the map redraws the moment Low signature is switched; until then it kept its document colours
until somebody moved it.

**Paid for only by somebody who chooses it.** Each layer's code is a module of its own under
`web/src/lib/grid/layers/`, loaded by `import()` when the layer is chosen, and its files are fetched
from navcom.app, whole, then: never at first paint, never at mount, never by what is on screen, and
never in the service worker's install precache (they are cached on first use, as Places is). Each
moment a layer costs somebody something is a line of its own in the budget, `MAP_LINES` in
`web/scripts/lib/budget.mjs`, with a ceiling for its code and one for its data (§6).

**Every layer says on the map what it is, whose, and how old** (invariant 7), in the map's key at the
top, where the sheet never reaches: a readout of it at the canvas's foot was behind the sheet whenever
a layer's screen was open, and present to every test (2026-10-19). The key says so too when a layer's
code or files did not arrive.

### Zones

Starcom's Zone and Sector Protocol 2.0: seventeen Terrae and Maria, the Zones that tile each, and the
Sectors that tile each Zone, every point of the Earth in exactly one Sector. Ids are `terra:<slug>`,
`mare:<slug>`, `zone:<slug>` and `zone:<slug>/sector:<slug>`.

**Vendored by digest, never fetched from starcom.app (D6).** A fetch from Starcom would hand its host
every visitor's address and timing, would not work offline, is refused by CORS today, and fails the
landing page's "talks to nobody" test by design. And starcom.app serves ZSP 1.0 until its own checks
pass the whole partition on 12 November, so it would give NavCom nothing until then. So each stage is
taken from starcom-app's repository at a pinned commit, by hand:

    node scripts/zsp-vendor.mjs --repo ../../starcom-app --commit <sha> \
      --manifest-sha256 <hex> --stage 1 --credit "<the attribution the licence asks for>"

The script reads the files out of git at that commit, never from a working tree, and refuses a
manifest whose sha256 is not the one given. Its `--dir`, which reads a directory, is for the test
fixture and is refused for `static/grid/zsp/` whatever the manifest calls its maker; `--out` must be a
directory named `zsp`; and what a run replaces there is only what an earlier run wrote, known by its
stamp, so a mistyped `--out` deletes nothing else. It then checks every container file's sha256 and length
against the manifest, and runs the same kinds of check Starcom's build runs, with NavCom's own reader
(`packages/core/src/zones`): ids and levels, rings closed, wound as RFC 7946 winds them and not
crossing themselves, Sectors of 50,000 to 500,000 km² or saying why not, licences (public domain, CC0
or attribution only, for the set and for every source a Sector's lines were drawn from), the IAU's
landform words, retired 1.0 ids, and coverage: every point of a 2° grid in exactly one Terra or Mare,
and, where a container has Zones, in exactly one Zone and one Sector of it. **And every edge, which
Starcom's checks do not look at** (2026-10-19): the grid misses a strip that falls between its points,
and a Sector moved sideways keeps its area, so a Sector moved 0.6° west, overlapping the next
container's by a strip and leaving one bare in its own Zone, passed both. At each level, the
containers over the Earth, a container's Zones and a Zone's Sectors, every edge must be found again,
reversed, beside it, as the format's shared edges are (ZR9); an edge that is not is looked at from a
metre either side, where there must be exactly this area and exactly one neighbour. The areas then add
up to a part in a billion, since with shared edges they are exact to rounding. On a synthetic partition
near the real one's size, 2,700 Sectors with a vertex every 0.05°, every check together takes about two
seconds, and four when no edge is shared. How much of the Earth must have Zones depends on the stage. A
partition with any problem writes nothing. **The reader is NavCom's own**: Starcom's code is AGPL-3.0-only and NavCom is Apache-2.0, and a
test fails if anything under `packages/core/src/zones` carries Starcom's licence.

What it writes to `web/static/grid/zsp/` is quantised TopoJSON, each shared edge stored once:
`outlines.json`, every Terra, Mare and Zone simplified for the world view; one file per Terra or Mare
holding its Sectors; and `index.json`, every Sector at lookup precision. Each records the source and
commit, the manifest's digest, the stage and the credit.

**Stages.** Stage 1 is the seventeen outlines (23 Oct), Stage 2 Terra Africana with its Zones and
Sectors (30 Oct), Stage 3 the rest (9 Nov), and the set Starcom swaps to on 12 November is `final`.
**Every stage before it is a draft, and is labelled as one, view only**, on the map and on every screen
that shows it. **Until Stage 1 the build carries no Zones at all**, and the map says so (*Zones · not
in this build yet*) rather than drawing nothing. Nothing synthetic ships. The tests use NavCom's own
fixture partition, in the format exactly: nine containers (the four renamed on 2026-10-18 among them),
eighteen Zones and thirty-eight Sectors, pole to pole, with both polar caps and one Sector split across
the antimeridian (`packages/core/test/fixtures/zsp/`); the browser tests serve what the script makes of
it by route (`web/e2e/fixtures/zsp/`), and the script refuses to write it where the map reads from.

**Loading (D10).** Every outline, whole, when Zones is chosen. A Terra's or Mare's Sectors when somebody
opens it, or one of its Zones, by a tap or from a list, and never because of what is on screen or where
anybody is: opening a Sector fetches nothing, because a Sector can be opened from the lookup or from
where somebody works. Opening one tells navcom.app's host which container was opened, as picking a region in the
search does; looking at the map tells it nothing (§2). The lookup's index, whole, the first time
somebody asks.

**Drawing, in three weights.** A Terra's or Mare's edge heaviest, a Zone's lighter, and a Sector's faint
and thin, drawn only for a container that is open, because a whole-Earth partition puts lines
everywhere at once. Country borders are not drawn while Zones is.

**A tap opens what it lands on**: a Sector of an open container, else its Zone, else its Terra or
Mare. Com shows where it sits, *Terra › Zone › Sector*, each a way up; a Zone's system; a Sector's
landform in the IAU's word; and the source, with the draft's stage while it is one.

**Which Sector this phone is in (D7)** is answered on the phone. Its position is asked for once and
rounded to 500 m, as the search's is, and never leaves it; the index of every Sector on Earth is
fetched whole, the same file for everybody, and the lookup runs here, in longitude and latitude, never
projected, so a Sector that runs to the pole is answered like any other. Nothing chosen by where the
phone is is fetched, not even its container, and the fix is never put in history. **Opening a Sector
it found fetches nothing either** (2026-10-19; one tap there used to fetch the container the phone is
in): the Sector is named from the index and its Zone and Terra from the outlines, and its screen says
that opening its Zone would fetch its Terra's Sectors and tell navcom.app which Terra. *Where you work*
opens the same way. Edges are simplified
to about a kilometre, so within 1.5 km of one both Sectors are offered and the person chooses.

**Where I work (D7)**: one Sector, kept on this phone only, in the Wipeable tier (`work_sector`), so a
panic wipe takes it. Never published, never sent, never in a backup. **Only from a final partition**:
a draft's ids may change before Starcom's swap (D6), and a Sector kept under an id that went would be a
place that is no longer anywhere. It is kept with the manifest digest it was chosen from.

**Credit.** The partition is CC BY 4.0, so the layers screen and the map's readout carry the
attribution the vendored manifest gives, from the first stage vendored.

### Time zones

**Natural Earth's 1:10m time zones (D8)**, public domain, from the same pinned commit as the world's
outlines (`web/scripts/grid-geometry.mjs`): dissolved by standard offset into forty bands, simplified
to 10% on the sphere, `web/static/grid/timezones.json`. Each band keeps only its offset; its label
(*UTC+5:45*) is written on the phone, because the file's own `utc_format` disagrees with its `zone` on
two polygons. Drawn as alternating lifts. **They are standard offsets as Natural Earth drew them in
2012, with no daylight saving, and the map says exactly that.** A tap on a band opens it: its offset,
the time at that offset by this phone's clock, and its age.

**A place's own clocks are a different answer, and are never passed off as the band's.** Each directory
region names a validated IANA zone, so with Time zones chosen a region's ring, and its place in Com,
give the time its clocks show, from the phone's `Intl`, daylight saving included: Birmingham in July
reads *12:05 BST, Europe/London* where its band says 11:05. The zones come from
`/grid/region-times.json`, prerendered from each `region.json`, fetched with the bands and never at
mount, so `console-regions.json`, which every visit fetches, does not grow for it.

### Day and night

**Worked out on the phone, from its own clock; nothing is fetched** (2026-10-19). The sun's position
comes from the almanac's low-precision formulas, within a hundredth of a degree of Meeus's
higher-accuracy method, about a kilometre (`web/src/lib/grid/sun.ts`, tested against Meeus and against
Spencer's series, which shares no formula with either). The line is less exact than the sun: it is drawn
from points 2° of bearing apart, a chord off by up to about 15 km at the equator, and refraction near the
horizon, which the standard −0.833° only averages, moves it further; so *to within tens of kilometres*,
and all of it only as right as the phone's clock, which the layers screen says.

**Night is carried by texture, not by tone** (revised 2026-10-19, the same day). It was four caps of the
deepest neutral at a fifth each, from sunset to astronomical twilight, and full night came out the colour
of the daytime ocean, about 1.10:1 against day, with each step 1.03:1: on a cheap screen in sunlight, no
night side at all. Tone cannot fix it: the land is #141920, and WCAG's contrast, with its 0.05 for
flare, puts even pure black against it at 1.19:1. So there are two steps, each darkening by 35%: twilight,
from sunset (−0.833°, the sun's upper limb with refraction) to the end of civil twilight (−6°), and night
after it. And each lays a sparse grid of dots in faint ink, kept in screen space and on device pixels so
it is crisp and the same at every zoom: one every 6 px in twilight, and at night a second at each tile's
middle, so night is twice as dotted and never a heavier dot. Dots read on any screen, in either
signature, and nothing else on the map is dotted over an area; a swatch under the key says *Night ·
twilight has half the dots*. Then the line where the sun is rising or setting, in muted ink; then a small
sun where it is overhead, which is a mark and not a place. A cap that holds a pole is laid out from −180°
to 180° and closed along the pole, so the only seam is the Earth's edge; polar day, polar night and the
equinox need no special case. Its runs up ±180° to the pole are drawn in 2° steps: Equal Earth bulges
there, and drawn as one chord each they cut the night off a third of the way in from either side, which
the faint steps hid and the dots showed at once. `e2e/daylight.spec.ts` asserts the dots in both signatures, the
ground's luminance under them down by at least a third, twilight half as dotted as night, and the day side
untouched.

**Once a minute, on the minute, and never while the page is hidden.** No frame loop and no animation:
each cap is a path in map units rebuilt on the minute, and a pan only redraws it. A page left open on
the map used to redraw every minute for nothing, because the page's clock handed it the same missions
in a new list; it redraws now only when what is open changes. `e2e/daylight.spec.ts` counts the redraws.

Time zones always draws it; over any other layer, a box on the layers screen does. The key says *Day and
night at 14:05 UTC · worked out on this phone, nothing fetched*, and the layers screen says where the sun
is overhead. What it cannot know is a wrong clock: the page says when this phone's clock is behind what
the relays report, and nothing can say when it is ahead, so the layers screen says plainly that day and
night is only as right as the phone's clock.
Whether Time zones should always draw it is the owner's to say (`daylightDrawn`, one line).

### The directory by last check

**Over Nation States, each region by how long ago its places were last checked, read against this
phone's clock** (2026-10-19; invariant 7). `/grid/region-ages.json`, prerendered, holds dates and not
ages, fetched whole when the box is ticked, never at mount and never in the install precache. Read on the
phone, the picture ages honestly between deploys. Each region's records are **runs** of one date, `[date,
how many]` in its own order, so a region re-checked on one day is one run, and the file stays a few
kilobytes however many days the directory is re-checked on; one index a record grew with every new date,
and the first re-check on a tenth date would have failed its budget before the directory grew at all.

**It names an age, never what a page shows** (revised 2026-10-19, the same day). The classes first read
*hours shown*, *hours: call first* and *call first, intake rules too*, and nearly every record carries
no hours: 9,630 of 9,633 show hours as unknown, and every one shows intake rules as unknown, because a
page says *Unknown* for a blank field before it says anything about age. So the map claimed a call-first
state on 1,911 regions whose pages showed no hours at all. The file knows when a record was checked and
nothing of its fields, its flag or its method, so the classes are the windows a page turns at and
nothing more: **0–13 days ago**, a solid ink disc; **14–89 days ago**, a smaller solid muted disc; **90+
days ago**, a hollow ring; **Unknown · no check date**, a hollow square, because unknown is not old. The
full key says once what the windows mean, *Hours, where a place has them, read call first after 14
days*, and that each place's own page says what its check still lets it show. `readingOf` (core) is held
to `displayField`'s and `confidenceForField`'s windows on every day of a year, for a record that has the
fields; its doc says it knows nothing of which fields a record has.

**A region reads as its oldest check**, the cautious statement: everything there was checked at least
this recently. **Every mark is drawn at the size its swatch is, at every zoom, and where marks would
crowd, the most cautious is drawn** and the rest left out (`thin`, 11 px apart, one pass by a grid of
cells). They were shrunk to about half at the whole-Earth view, and two thousand of them still ran into
one shape there, rings over discs reading as fill, just where the key is read. Closer in with Places on,
each record by its own check, looked up from readings worked out once a day rather than read again in
every frame. A swatch row under the map's key names only the classes there are, with their counts, and
the layers screen gives all four; a hover says how long ago a region's oldest check was, and a place's
*Checked* slot says its oldest and newest, or a record's own date, and leaves what that shows to the
record's page. The key's own line says whether a person confirmed any of it, by phone, in person or at
the place, rather than a website or a second hand: today, none. On 19 October 2026 every region reads
*14–89 days ago*; see §7 for 2 December.

Regions, not provinces: a state shaded by its regions' checks would claim coverage for the counties no
region reaches. The owner may have meant provinces; it is a question for them.

### Missions on Zones

**Open missions counted by Zone and by Sector, missions and never people** (2026-10-19), from the
missions already on the phone, with the feed's own age: *Missions by Zone · 1 placed, 4 by jurisdiction
only · live*. Each is placed by the ring the map draws for it, where its package locates its subject, at
about a kilometre or coarser; **a mission filed only by jurisdiction names no Zone, and is counted apart
rather than put in one**. Counted at the deepest level the phone holds: an open container's Sectors,
else its Zones, else the Terra or Mare. A badge, a pill of the ground ringed in ink with its figure in
ink, hangs at each area's label point, a point inside its full-resolution outline that the vendoring
stamps (`labelPoint`, core); a Sector's replaces its Zone's once the Sector is 48 px wide. Nothing open
draws no badge; missions not read draw none either, and the key says so, because unknown is not none.

The outlines are simplified for the world view, and the vendoring measures by how much, at every source
vertex, **for each file of them**: `outlines.json` for the Terrae, Maria and Zones (1.5 km on the
fixture), and each container's file for its own Sectors, which are simplified apart and drift by their
own amount (0.6 to 1.7 km on the fixture). A mission within a level's drift, plus its own precision, of
that level's drawn edge is near that edge, at that level, with the neighbour across it: **at every level
it is counted in**, so a Zone whose container is open still says it, since the Zone's badge counts it
too. It is still counted where its drawn point falls, and the count says so rather than settle it
silently: **its badge is dashed**, a hover adds *1 near an edge*, and the area's screen names the mission
and the neighbour it may be in instead. A Zone's screen lists its open missions, each a way to it. No
layer's code reads the mission feed: the map hands the counts their missions, and a test holds that.

### Spheres

**Built against NavCom's fixture, 2026-10-19; nothing ships until Mecha Jono's Part 2 lists are
vendored** (due 26 Oct; D9). Cited membership lists of countries, by ISO code, overlapping, in the shape
Starcom's Spheres mode reads (edition 1.0: a Sphere's id, name and family, its members, groups and cited
sources, and when it was read). **The reader is NavCom's own** (`packages/core/src/spheres`): Starcom's is
AGPL-3.0-only, and a test fails if anything there carries its licence.

**Vendored by digest, as Zones are**: `web/scripts/spheres-vendor.mjs` reads the lists out of git at a
pinned commit, refuses a manifest whose sha256 is not the one given, checks every Sphere (its id, family
and codes, a source cited, a licence NavCom may vendor for the lists and for every source that names one),
and refuses a member it has nowhere to draw, and **a source whose link is not https**: a `javascript:` or
`data:` link would run in navcom.app's origin, where every operator's keys are, on one tap, and the lists
come from a partner's repository. The Sphere's screen holds the same line whatever a file says: only an
https link is a link, and anything else is the source's name as plain text. It writes
`web/static/grid/spheres.json`, labelled a draft unless `--final` is given, with the oldest and the
newest day a list was read and how many do not say; `--dir`, for the fixture, is refused there whatever
path names it. Until then the map says *Spheres · not in this build yet*.

**Drawn over the world's own outlines by code.** A small state with no outline at 1:110m is a circle at
Natural Earth's label point (D9): `web/scripts/label-points.mjs`, from the same pinned commit as the
outlines (`web/scripts/lib/natural-earth.mjs`), writes the 64 such points to the unserved
`web/scripts/data/label-points.json`, and the vendoring copies in only those of members a Sphere names.

**One Sphere is shaded at a time, the one somebody opens, and it is hatched**, 6 px apart in screen space
at every zoom, so it is never taken for a mission's solid lift, with a thin ink outline, and its small
states filled. **With none opened, nothing is shaded**, and the key says *open one to hatch it*: every
member of any Sphere was a lift of 6% (about 1.16:1, invisible in sunlight), and Spheres overlap, so with
the real lists nearly every country is in one and that lift would be a faint wash over the whole world.
A count of Spheres per country was considered and not built: it would measure how many lists cover a
place, not anything about the place. A small state is a **dotted** circle until its Sphere is opened:
Places' region rings are solid, and the two were the same muted ring. **The key names the Sphere
hatched**, *Spheres · Test Anglosphere hatched · …*, after Back and across a pan, since the hatch outlives
the screen that chose it; choosing another layer lets it go. Then the lists' age, **by the oldest read as
well as the newest**, *read 3 Aug–19 Oct*, never the freshest list's date alone. A hover names every
Sphere a country is in, the most specific first; a tap opens them, each a door to its members, its
groups, its sources (links a person chooses to follow, carrying no referrer), when it was read and
whether it is a draft. A country in no Sphere answers as Nation States does, so a tap is never dead.
