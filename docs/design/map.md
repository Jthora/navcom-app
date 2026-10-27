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
against NavCom's own fixtures until their data lands, and nothing synthetic ships. **Since 2026-10-19 too,
Hazards (§8)**: three public feeds' fires, volcanoes, storms, floods, droughts and earthquakes over any
layer, the first thing on the map that asks anybody outside navcom.app, and only once somebody chooses it;
and on a mission's screen, the US National Weather Service's warnings for its state, asked on a tap. The
road layer and the mini-map are not built; the
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
| **The grid** | Vector outlines we draw ourselves, and points for places of record: regions, records, missions, reports. The landing map, always | Ours. No third party unless Hazards is chosen (§8), and then three public feeds' whole-world lists; no key; works offline |
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
worth protecting, and it is why the heavy layer is opt-in rather than lazy. **The one exception is
Hazards** (§8, 2026-10-19), and it keeps the property: chosen, it asks three public feeds for their
whole-world lists, so each learns this phone's address, which can place it roughly, often to a city, its
browser, the time and that it asked from navcom.app, and still nothing about where anybody looks.

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
  and Australia); everywhere else is a country outline at 1:110m. **From ×2 in, those countries'
  land and coast are their provinces' too** (2026-10-24): with the land lifted far enough off the sea
  to read, a 1:110m US under 1:10m states put records in the sea of Delaware Bay, put Atlantic City
  offshore and filled in the Chesapeake, and drew Galveston Bay's coast twice. Their 1:110m outlines
  are left out, their provinces filled instead, and the coast drawn from the provinces' outer edge where
  it meets the sea; where it meets a neighbour without provinces, Canada, Mexico, Ireland, the
  neighbour's 1:110m line is the one border drawn (`fineOf`, worked out the first time somebody zooms
  that far, never at mount, and from the file every visit already has).
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
A region's square gives way to its records at about 2 km a pixel, where a region is still many pixels
across (about 2.7 km under Equal Earth, which keeps that figure by area at every latitude): its centre is a statistic of its records, not a place, and
drawn closer in it would sit on one block and read as one. It was 500 m until a review found exactly
that (2026-10-18). For the same
reason a region is a hollow square and a record a small filled one: **the circle is a mission's alone**
(2026-10-24).

**Canvas 2D, not SVG.** Three thousand county paths as DOM nodes is the thing that kills a
prepaid Android 8 with 400 MB free — the device floor is in [`delivery.md`](../delivery.md)
and it is a real phone. Paths draw to canvas. A tap, a hover and the keyboard's reticle share one
hit-test, `web/src/lib/grid/pick.ts`: each shape's box first, then its rings, in a fixed order — a
point, then a shape a mission fills, then a province, then a country. A national mission's outline
is not a fill: it holds every state inside it, and answering first it opened the United States for a
tap on Texas (review, 2026-10-18). There is no quadtree: an earlier version of this page said there
was, and at 471 shapes a box test is enough. A filled shape answers within 12 px of its edge, because
at the whole-world zoom on a phone California is about 10 px across and a thumb is several times that.
The 12 px is the finger's, so it stays 12 px however narrow the world is drawn (§6). **A shape the
finger is inside wins over a point a thumb away** (2026-10-24): further out than where records are drawn,
a point on land takes a tap only within its drawn size and 6 px of air, since a thumb's 24 px at the
whole-Earth view is about 3,000 km, and a tap in the middle of a lit California opened a mission in
Houston; at sea a point keeps its whole reach. **Closer in, where a thumb is a street, a point keeps its
reach**, a record its 12 px and a region its 24, and a mission's ring too unless the tap is inside a shape
a mission lights: the rule at every zoom made a record at ×40 answer only within 8 px. Spheres' small
states keep to the same rule, a diamond on land answering within its size and 6 px, so a tap in southern
Sicily opens Italy and not Malta. And a hazard's mark under the finger wins over a ring that is only a
thumb away.
Under any layer but Nation States, a lit shape the tap is only near gives way to the layer's own area,
which is what the person chose (a tap on Oregon under Zones opened California), and a lit shape's
readout adds what the layer says of it, under Spheres *Canada · 1 open mission · Test Francophonie,
Test Atlantic community, Test Anglosphere*.

**A gesture moves a picture rather than drawing one** (2026-10-24). Rasterising the whole canvas was 135
to 350 ms a step of a whole-Earth pan under a CPU six times slower, nearly all of it the canvas's own
raster and not NavCom's code. So what is drawn in map units, the land, the layer, the lights and the
lines, is kept on a canvas of its own, and the names on another: a pan or a pinch moves both and draws only
the points between them, and the picture is drawn again when the gesture ends, 160 ms after a wheel's
last turn, or sooner when it has moved too far to stand for the view; **the names a frame after it**, so the
frame a gesture ends on is two tasks and not one of about 110 ms (audit, 2026-10-24); and of the finer land
only the rings and countries in view, each a path of its own, since one path of the whole world is walked
edge by edge wherever the view is. The provinces are drawn only from ×2 in. `e2e/map-legible.spec.ts` pans
the whole Earth under that throttling and fails on any long task over 50 ms, and pans at ×4 with Places, a
fire season and day and night on, through the frames it ends on, and fails on any over 100 ms (it was 120;
measured after, 80 to 97).

**Both themes are ours**, which is the quiet advantage of drawing it: there is no white tile
to dim and no third-party style to fight. Colours come from `panel.md`'s tokens, so dark is
the default rather than a filter over somebody else's daylight. **The land, its lines and its coast have
neutrals of their own** (`--map-land`, `--map-line`, `--map-strong`, 2026-10-24): the panel's put the land
at 1.10:1 on the sea, provinces at 1.23:1 and borders at 1.73:1 on the land, which a cheap screen's glare
in daylight takes to 1.03, 1.07 and 1.21, no map at all at noon. They are 1.43, 1.55 and 2.31:1, and
1.34, 1.55 and 2.30:1 in Low signature, the default for anyone with a callsign; no hue is spent on any
of them. **The coast is drawn under every layer**, from the arcs only one country uses, so it costs no
bytes: under Zones, Spheres and None the continents were a fill and nothing more.

---

## 4. The switch, and the mini-map

Three layers. Only the first is on at first paint.

| Layer | Source | Default |
|---|---|---|
| **Grid** | Ours | **On.** No third-party request; one subscription each to The Record and its mirror, for missions |
| **Roads** | [OpenFreeMap](https://openfreemap.org) public instance — OSM vector tiles, no key, no registration, no cookies, dark styles available | Off. Loads when chosen, and says what choosing costs |
| **Satellite** | — | **Declined.** No free keyless source whose terms permit it |
| **Hazards**, over any layer (§8) | USGS, NASA EONET and GDACS, read live | Off. Asks when chosen, for the whole world, and says before it is chosen what choosing costs and who learns what |

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
of zoom parts the two. The browser tests' Texas sits past the 12 px for that reason. The key and the sheet's heights are measured, not assumed (`--map-inset`, `--map-reach`, `--map-sheet` for its height now, and the key's own box), so a change to either moves the view
with it. Province detail still follows the regions, because that is
what the data holds; every country lights and answers anyway.

**Every shape and point is a door** (2026-10-18; it was *a lit province is a door*). A hover, with a
mouse or a pen, lifts the outline under the pointer and says what it is and what is open there —
*California · 1 open mission*, *Kenya · Nothing open*. A tap opens it in Com: a province or a country
as a place, listing what is filed under it and the directory regions near the tap; a mission's ring
as that mission; a region's square or a record's point as that place. **What a tap took stays lifted**
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
each region's hollow square, which says how many places it holds, **thinned where squares would run
into each other** to the region with the most places, at its own position, which says how many it stands
for (2026-10-24: 1,889 rings at the whole-Earth view were one solid mass the missions were lost in), and
thinned again further apart where the squares kept still tile, since at ×4 the US was a lattice that read
as graph paper and hid a lit California; and closer in as each record's point, at four
places (about 11 m). The points come from one file, `/grid/places.json`, fetched whole the first time
Places is switched on and never by what is on screen (§2), in the order of each region's own index, so
a tap reads the record from the same file a search does. **The places people sleep stay off the map
(D5, decided 2026-10-18)** — shelters, youth programmes, overnight warming and residential detox:
they are published facilities, and some providers may still read a map of where they cluster as
locating the people they shelter. They stay in the directory and on their own pages at five places.
Every type is decided on or off in one table (`ON_THE_MAP`), so a type added later is a decision before
it is a point. **Where records are drawn, a region with places held back keeps a dashed square** that
says how many are not on the map, and its place says so too, so Baltimore, whose records are all
shelters, reads as that and not as nothing (invariant 7). A mission's ring is drawn where a package
locates its subject on public record, in ink rather than a hue, a thick ring with its centre on a casing
of the ground and drawn last, so nothing on the map covers one, never smaller on screen than its
precision covers — **and no finer than about a kilometre, at the point it rounds to, while Q19 is
open**: a package carries no type, so the hold on the directory's shelters has to hold
for a package's address too. A mission filed only under a jurisdiction keeps its shading, because a
circle at a state's middle would invent a place somebody might head for (D4, decided 2026-10-18).

**Places is offered only on a drawn map.** Without script, or with the map's code or geometry not
arrived, the switch is disabled, and where the map would be the page links to the directory, which
works with neither. When Places' own files do not arrive, the key says *Places not loaded*, and the
next time it is switched on asks again.

**Read as a person reads it, on a cheap phone in sunlight** (an audit of the built map, 2026-10-19,
fixed 2026-10-24; `web/e2e/map-legible.spec.ts` holds each by its pixels, boxes, frames or words).

- **The key is one panel**, the ground at 92% with an edge, so no mark runs through its words, the age
  lines invariant 7 rests on among them; and **gestures over it reach the map**: only its buttons take a
  touch, so a pinch that starts on it no longer zooms the page. The missions' line carries their mark, a
  ring, and a lit province a row of its own, *Missions filed under a place*. Each thing drawn has **one
  short line**, **what ages fastest first**, Hazards' feeds, then the layer, the missions by Zone
  (*Missions in Zones: 5 · by jurisdiction: 3*), the directory's checks and the sun; on a phone it is cut
  to whole lines, three at most and as many as leave the Earth 120 px above the sheet at half, **and never
  shorter than the first line whole**, so the feeds' age and *some events, never all* stay whatever else
  is cut, and says so with an ellipsis. On the device floor's 360 px, where the feeds' line is two rows,
  that leaves the Earth about 110 px rather than 120, and the Earth gives way rather than the age. There
  the name rides on the key's edge as a caption, the missions and Places share a row, and the map's
  controls are the floor's 48 px, so the key is 70 px rather than 137 and every control is above the sheet
  at half (2026-10-24). Under the lines, a row of the marks drawn, as the canvas draws them. **The whole key
  is on the layers screen**: every line, that row whole, and one layer down the rest of each line's words
  and every kind of mark the map draws, with what a filled country means, *somewhere in it, not all of
  it*. **A credit a licence asks for is over the map's foot**, above the sheet at peek and at half, on one
  line cut short of the controls with every word on the layers screen, and not at full height, where the
  map is a strip the key covers.
- **The Earth can be brought out from under anything**: the view is held to what nothing covers, so its
  top comes down to the key's foot and its bottom up to the sheet; at ×3 to ×6 nothing north of about
  30°N could be panned out from under the key.
- **Each kind of mark has a shape nothing else has**: the circle is a mission's; the directory's places
  are squares, and the ages a family of them; a Zone's count is an edged rounded rectangle, never round;
  a small state of a Sphere is a small diamond; Hazards' counts sit on the ground with no edge. Tone only
  adds to shape (§8). **A mission's ring is a 6 px symbol at the whole Earth**, on a 1.5 px casing, growing
  to 9 px on 3.25 by ×2: at 9 on 6.5 three rings covered most of the contiguous US. **It has a centre only
  at that least size**, where it is a symbol, on one disc of the ground so no seam shows; drawn at the size
  its precision covers it has none, since a dot in a circle reads as *here*, and at a street's zoom it sat
  on one block, as a region's centre would (2026-10-24).
- **Marks are laid out once a frame, in one list**: the missions' rings, the sun, which is where the sun
  is, the Zones' counts, then Hazards' marks and counts, each clear of what was placed before it, and the
  names clear of all of them. **A hazard's cell a ring would be drawn over is moved to the nearest clear
  spot**, no further than a wide cell, since further out a cell is already 24 px of the Earth gathered at
  one mark: a fire season's 420 fires were one cell under three rings, count and all. **A Zone's count
  moves only within its own area**, or stays at its label point under the ring: moved 46 px, which at the
  whole Earth is about 5,000 km, one sat in the Zone next door.
- **Names are on the map**: countries from ×2, provinces from ×6, Terrae, Maria and Zones with Zones,
  and each time zone's offset, in the muted and faint neutrals on a halo of the ground, greedy, largest
  first, never over each other, the key, a ring, a count or a hazard, and over the directory's squares.
  They fetch nothing (`MAP_LINES.labels`). From ×4 in the map says that outside the US, the UK and
  Australia land, coast and borders are 1:110m and islands may be missing, rather than load 1:50m, shorter
  where the whole note would run under the controls.
- **What the map says is said where it can be read, and to a screen reader**: a readout under the
  pointer is placed clear of the key, the controls, the sheet now and the point it names, no wider than
  what is left of the controls, and if nowhere near is clear, under the key's foot, left of them; the canvas's name says which layer and what is over it; a layer chosen is said once,
  politely; the key's lines are sentences; the keyboard's reticle sits in the middle of what nothing
  covers and always says something, *Open water, about 30°N 40°W* over the sea; a mission's readout
  names where it is filed; and a mouse's sweep is said once it rests, not thirteen times.
- **Declined**: the opening view leaves about 160 px of empty map below the Earth at peek, which is the
  price of keeping it above the sheet at half (asked again 2026-10-24, and still the price: an Earth sized
  for peek is under the sheet the moment a tap opens anything); and a list in Com to choose between things
  a tap could mean (the containment rule above settles the cases the audits found).

Budgets, all of them targets to measure rather than claims:

| | Target |
|---|---|
| Grid geometry, world outlines + provinces where regions are | ≤ 250 KB gzipped — **measured 59.1 KB** (2026-10-18, with codes and names) |
| Places, every record the map draws | ≤ 80 KB gzipped, **only when Places is switched on** — never at mount, never in the install precache |
| Mount, every visit: the map's code, the mission feed, Com's registry and the geometry | ≤ 129 kB gzipped, **enforced** since 2026-10-18 (`MOUNT` in `web/scripts/lib/budget.mjs`) — measured 110.1 kB on 2026-10-19, 51.4 kB of script and 58.7 kB of geometry at the build's gzip level. It was 107.6 kB the day before; the layers and Equal Earth added the projection, the hooks each layer draws through, and an opening view that keeps the Earth uncovered, and the deferred line, which counts mount too, was re-derived for them, to 69 kB |
| The layers somebody chooses, and what is drawn over them: Zones' outlines, one Terra or Mare's Sectors, the Sector lookup and its index, Time zones, Spheres, day and night, the directory by last check, missions counted by Zone | **A line each**, `MAP_LINES` in `web/scripts/lib/budget.mjs`, enforced since 2026-10-18. Each line has a ceiling for its code and one for its data, and a line's code is never charged to the shared deferred line, which had 1.6 kB left that day. A line whose code or data reaches the build before its ceiling is derived fails the build, and so does one whose code loads at first paint or mount. Measured 2026-10-19: the layers' screens 6.1 kB of code, of a 6.8 kB ceiling derived at 5.6 kB, the Sector screen that fetches nothing and the time screen that says when its code did not arrive adding 0.4 kB; Zones 1.4 kB; the Sector lookup 1.3 kB; Time zones 1.3 kB, and 52.4 kB of data (the bands, 43.3 kB, and each region's IANA zone, 9.2 kB), ceiling 63 kB. Zones' files have no ceiling until Stage 1 is vendored, and the vendoring change derives it. **Measured again that evening**, with the four slices of §8 in: the layers' screens 10.1 kB, re-derived to 12.1 kB for the boxes, the full key of the ages, a Zone's missions and a fifth screen, a Sphere's; day and night 1.5 kB of code and no data, ever; the directory by last check 1.9 kB and 10.8 kB of data (`/grid/region-ages.json`, which grows with the directory); missions by Zone 2.0 kB and no data; Spheres 2.0 kB of code, their data without a ceiling until the lists are vendored. Mount grew 1.8 kB, to 111.9 kB, for the overlays' hooks, the key under the key and the redraw on Low signature, and first paint 16 B, to 60,871 B of 61,440. **Measured 2026-10-24**, with the map made legible (§6): the layers' screens 17.1 kB, re-derived to a 20.1 kB ceiling for the whole key; Zones 1.5 kB; Spheres 2.2 kB; the directory by last check 2.7 kB; missions by Zone 2.5 kB; Hazards 6.8 kB; and a line of its own for the names, 1.7 kB of code and no data, loaded from ×2 or with Zones or Time zones. Mount 118,176 B, 58,066 B of it script; first paint 60,812 B of 61,440. **Measured again after the second audit, the same day**: mount 119,519 B, 59,409 B of it script, for the marks laid out once a frame, the readout and the credit held clear of the controls, and the key's cap worked out again as its lines change; Deferred, which counts mount, 70,596 B of 70,656, so **the next addition to mount is a decision**; and a line of its own for the finer land, `fine`, 1,354 B of code and no data, loaded from ×2, so mount carries none of it and no longer builds the provinces' lines at all |
| Hazards, a round: what it asks of the feeds, each answer capped on the phone | **A line of its own**, `MAP_LINES.hazards` (2026-10-19): 6.2 kB of code, ceiling 7.4 kB, re-derived the same day from 5.7 kB for the review's fixes, with `outside.ts` in it; and `remote`, one GET of each URL asked, 195,831 B on the wire a round in a quiet month for fires, about 1.96 s at 0.8 Mbps in the background, and `remote.peak`, 698,788 B, about 7 s, when the wildfires pass their cap in a busy season; printed by the build and enforced on the phone by decoded caps per answer (`CAPS` in `web/src/lib/outside.ts`). The layers' screens re-derived the same day to 17.4 kB for its box, its disclosure, its feed rows and a sixth screen |
| Requests at first paint to anyone but navcom.app | **None** — the mission subscriptions open after first paint, to The Record and its mirror only. None to anybody else until Hazards is chosen or a mission's weather warnings are asked for |
| Repeat visit, no new deploy | Zero network for the grid — service worker now covers the whole origin |
| Device floor | Interactive on a prepaid Android 8, 400 MB free |

---

## 7. Open, and who answers it

- ~~**Measure the geometry.**~~ Done 2026-10-06; §3 has the numbers and what they changed.
- ~~**The over-precise coordinates are a data fix**~~ Done 2026-10-06, in the data rather than the
  map (§0): all 9,623 published coordinates.
- **Satellite is declined**, per [`declined.md`](../declined.md)'s rule that a gap may be
  closed rather than carried.
- **Zones shipped final 2026-10-26**, from starcom-app ec6714b9 (§8, Zones, Stages). When Starcom changes
  the partition, re-run `web/scripts/zsp-vendor.mjs` at its commit with `--stage final`, the manifest's
  digest as reviewed and `--credit "Starcom ZSP 2.0"`, and re-derive the Zones lines' data ceilings.
- **Spheres** (§8) shipped 2026-10-26 as draft lists. Re-run `web/scripts/spheres-vendor.mjs` with
  `--final` once Mecha Jono says the lists are, or at a later commit when they change, with the
  manifest's digest as reviewed, and re-derive the Spheres line's data ceiling:

      node scripts/spheres-vendor.mjs --repo ../../starcom-app --commit <sha> \
        --manifest-sha256 <hex> --credit "Mecha Jono, ZSP 2.0 Part 2"

  Re-vendor the organisations with them, `--organisations-sha256 <hex>`, the digest of
  `public/geopolitical/organisations/manifest.json` at the same commit.
- **A Zone in the interchange.** Asked of partners in rev 9 (the owner, 2026-10-27), and read since: a
  mission with no point that names its Zone or Sector is counted there (§8, Missions on Zones), and its
  screen names its city, a place of interest and its Sector as its poster wrote them. Until packages carry
  them, a mission filed only by jurisdiction is still counted apart.
- **Hazards' open choices, the owner's** (§8). GDACS's `SEARCH` is asked unparameterised, 124,555 B,
  64% of a round; `?eventlist=FL;DR;TC` would roughly halve it but is unmeasured and its syntax
  unverified, and a wrong parameter is a feed that reads *not read: unknown* for ever, so it waits for one
  measured GET. **Unasked, it lists only orange and red alerts** (68 and 18 that day, none green, from
  May 2025 on: a default of the server's, by alert level and over some window, that GDACS does not
  document), and the screens say so; its green floods and cyclones are never drawn. An explicit
  `alertlevel=Green;Orange;Red` is the same kind of unmeasured parameter. EONET's wildfires are asked for
  the last 30 days (`days=30` in `outside.ts`, one constant): 7 kept 3 fires and 14 kept 13 on the day,
  and one GET of each EONET URL as written confirmed both categories and the 30 days. **The busy season
  is the owner's too.** The fires still open in EONET's list put 1,340 in the 30 days to 15 August 2024,
  about 922 kB, past the 512 KiB cap, where the wildfires read *not read: unknown* and the volcanoes and
  storms still draw; 14 days held 659 (about 453 kB) and 7 held 362 (about 249 kB). A shorter window
  shows a busy season and drops the fires that have burned longest; this one keeps them and goes dark in
  the worst weeks. Either is one constant and one measured GET. GDACS's terms (its credit, and whether non-commercial use
  binds) and EONET's credit request are credited by name on the screens and in `LICENSING.md`, and are for
  the owner to confirm before this ships. The root's policy covers the root alone (§8); a terminal-wide
  one is a separate decision.
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
as Starcom's picker does. **Over** whichever is chosen, things that divide nothing: day and night, over
any layer and always with Time zones; the directory by last check, over Nation States; open missions
counted by Zone, with Zones; and Hazards, over any layer. Only Hazards' marks answer a tap of their own,
after the points and before a lit shape. The missions light whichever is drawn, because they are not a
way of dividing the Earth, and a lit shape answers a tap first in every layer, after a point and a
hazard's mark and with the same 12 px, so it stays a door (§6) whatever is drawn under it. The choice
lasts the page's life and is not stored.

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
never in the service worker's install precache (they are cached on first use, as Places is). Hazards
fetches nothing from navcom.app, and what it asks of its feeds is never cached. Each
moment a layer costs somebody something is a line of its own in the budget, `MAP_LINES` in
`web/scripts/lib/budget.mjs`, with a ceiling for its code and one for its data (§6).

**Every layer says on the map what it is, whose, and how old** (invariant 7), in one short line of the
map's key at the top, the rest of its words on the layers screen (§6), where the sheet never reaches: a readout of it at the canvas's foot was behind the sheet whenever
a layer's screen was open, and present to every test (2026-10-19). The key says so too when a layer's
code or files did not arrive.

### Zones

Starcom's Zone and Sector Protocol 2.0: seventeen Terrae and Maria, the Zones that tile each, and the
Sectors that tile each Zone, every point of the Earth in exactly one Sector. Ids are `terra:<slug>`,
`mare:<slug>`, `zone:<slug>` and `zone:<slug>/sector:<slug>`.

**Vendored by digest, never fetched from starcom.app (D6).** A fetch from Starcom would hand its host
every visitor's address and timing, would not work offline, is refused by CORS today, and fails the
landing page's "talks to nobody" test by design. So each stage is taken from starcom-app's repository
at a pinned commit, by hand:

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
`outlines.json`, every Terra, Mare and Zone at every point the format gives; one file per Terra or Mare
holding its Sectors; and `index.json`, every Sector at lookup precision. Each records the source and
commit, the manifest's digest, the stage and the credit.

**Stages.** Stage 1 is the seventeen outlines (23 Oct), Stage 2 Terra Africana with its Zones and
Sectors (30 Oct), Stage 3 the rest (9 Nov), and the set Starcom swaps to on 12 November is `final`.
**What came instead** (26 Oct): Starcom drafted the whole of it at once, its twelve Terrae and Mecha
Jono's five Maria, 251 Zones and 2,632 Sectors, on its `zsp-2.0` branch (797b8575), in
`public/geopolitical/zones-draft/` until its swap, which waits on the owner's review rather than a date.
The script reads that folder with `--folder zones-draft`, at stage 3 and never `final`. NavCom's reader
refused the draft for three things Starcom's checks do not look at, each now Starcom's to fix: every
file's `bytes` counts characters, not bytes; twenty Zones of the Maria name a system ZR6 does not have
(*chain*, *transform*, *fan*, *strait*); and Terra Antarctica's outline cuts the corner at (−180°, −90°),
leaving about 0.04 km² at the pole in no container. With the three put right in a copy that never
shipped, everything else passed, and what it would weigh is 31.6 kB compressed for the outlines, 3 to
29 kB for one container's Sectors, and 231.5 kB for the lookup's index (1.27 MB unpacked), which on that
phone took 0.8 s to answer Nairobi with *Northern Acacia-Commiphora bushlands and thickets, south*, in
the East African Rift Zone.
**Final, the same day** (26 Oct). Starcom swapped to the whole set (b248325c), serving it from
`public/geopolitical/zones/` with the drafts folder gone, and fixed two of the three findings five hours
later (ec6714b9, its ZR29): `bytes` is the file's bytes, and every corner of the map is pinned through its
simplification. **The third was NavCom's**: ZR6 names its systems as examples, *a rift, belt, basin, …*,
and NavCom's reader had held them as a closed list, with *orogen* from Starcom's code beside them. A
Zone's system is now any one lower-case word. NavCom vendors ec6714b9 as `final`, with nothing in it
changed. **And the vendoring had thinned it wrong**, which the draft's figures showed and nobody read:
kept to a tenth of their points, the outlines lost every piece of an area but its largest (New Zealand's
Zone the Chatham Islands) and the thin end of a long one (Walvis Ridge's western 650 km), and drew the
median Zone's edge 100 km from where it is; the file said so, `simplified_m` 27,800 km. Half the points
still lost pieces. Starcom's edges are already about 8 km apart (ZR24), so a cap on distance kept nearly
all of them, and the script now keeps them all and quantises, drifting 2.3 km at most for the outlines
and 0.3 to 2.1 km for a container's Sectors, and **refuses a file that drifts more than 5 km**. That is
70.5 kB compressed for the outlines (16,303 points, from 32.0), 4.3 to 36.2 kB for one container's
Sectors, and 239.4 kB for the lookup's index. Its labels moved too: `labelPoint` scored a candidate by
the lengths of the stretches through it, and on Starcom's 0.1° grid an edge that runs along a meridian
put the Black Sea's Sector's label on its own line; it now takes the candidate farthest from every edge.
**Every stage before `final` is a draft, and is labelled as one, view only**, on the map and on every
screen that shows it. **A build with no Zones says so** (*Zones · not in this build yet*) rather than
drawing nothing, as every build did until 26 Oct. Nothing synthetic ships. The tests use NavCom's own
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

**Drawing, in three weights.** A Terra's or Mare's edge heaviest, a Zone's lighter, and a Sector's thin
and dashed in the strong line from about ×4 in (2026-10-24: in the faintest line it was not there at ×9),
drawn only for a container that is open, because a whole-Earth partition puts lines
everywhere at once. Country borders are not drawn while Zones is. **Each edge is stroked once**
(2026-10-26), from the file's arcs: a Terra's or Mare's edges in its weight, then only the Zones' edges
that are not also one, then an open container's Sectors' edges, once each. Stroked ring by ring, an
edge between two Zones was drawn twice and one between two Terrae four times. Under Starcom's whole
draft at a CPU six times slower, that made opening Mare Pacificum three tasks of 125 to 164 ms and the
last frame of a whole-Earth pan 103 to 164 ms; stroked once, 83 to 87 ms and 81 to 110, which is where
the same pan under Nation States already is (73 to 106). `e2e/zones.spec.ts` holds the first, against
whatever Zones the build ships, from the first stage vendored. **Drawn at the zoom, kept between
frames** (26 Oct): with every point of Starcom's final set kept, opening Mare Pacificum was three frames
of 200 to 230 ms, nearly all of it rastering lines a dozen points to the pixel. Each edge is now thinned
for drawing, once for each doubling of zoom, so no point moves more than a pixel (Douglas–Peucker, both
ends kept, so shared edges still meet); only the edges whose box is on the canvas are stroked; and the
lines are kept as a picture of their own, drawn again only when the canvas moves or what they show
changes, since the map draws its picture again for anything a layer loads. A tap, the lookup and a
count read every point. Opening Mare Pacificum is now two frames of 51 to 72 ms, and a ×4 pan's end
50 to 105, Nation States' own range.

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
opens the same way. The index's edges are quantised
to about 400 m, so within 1.5 km of one both Sectors are offered and the person chooses.

**Where I work (D7)**: one Sector, kept on this phone only, in the Wipeable tier (`work_sector`), so a
panic wipe takes it. Never published, never sent, never in a backup. **Only from a final partition**:
a draft's ids may change before Starcom's swap (D6), and a Sector kept under an id that went would be a
place that is no longer anywhere. It is kept with the manifest digest it was chosen from.

**Credit.** The partition is CC BY 4.0, so the layers screen and the map itself carry the attribution the
vendored manifest gives, from the first stage vendored: over the map's foot, above the sheet at whatever
height it is, *Zones: …, CC BY 4.0* (2026-10-24; the key keeps the draft's stage, *Zones · draft 2, view
only*, on a line short enough for a phone).

### Time zones

**Natural Earth's 1:10m time zones (D8)**, public domain, from the same pinned commit as the world's
outlines (`web/scripts/grid-geometry.mjs`): dissolved by standard offset into forty bands, simplified
to 10% on the sphere, `web/static/grid/timezones.json`. Each band keeps only its offset; its label
(*UTC+5:45*) is written on the phone, because the file's own `utc_format` disagrees with its `zone` on
two polygons. Drawn as alternating lifts of the land, never the sea, which a lift brought up to the land
(2026-10-24), each band's edge a whole pixel in the strong line over the night, and its offset, *+5:30*,
printed on it. **They are standard offsets as Natural Earth drew them in
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
after it. And each lays a sparse grid of dots in the strong line (faint ink until 2026-10-24, brighter than the
borders, swamped the coast and every line at night), kept in screen space and on device pixels so
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
night at 14:05 UTC*, its whole line on the layers screen adds *worked out on this phone from its own
clock, nothing fetched*, and the layers screen says where the sun is overhead. What it cannot know is a wrong clock: the page says when this phone's clock is behind what
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
nothing more, **a family of squares** since the circle is a mission's (2026-10-24; rings made a lattice the
missions were lost in): **0–13 days ago**, a solid ink square; **14–89 days ago**, a smaller solid muted
one; **90+ days ago**, a hollow one; **Unknown · no check date**, hollow and crossed, because unknown is not
old. The
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
the place, rather than a website or a second hand: today, *Directory by last check · none by a person*; the row
under it names each class short, *90+ days · 1,847*, so every class there is fits a phone's key. On 19 October 2026 every region reads
*14–89 days ago*; see §7 for 2 December.

Regions, not provinces: a state shaded by its regions' checks would claim coverage for the counties no
region reaches. The owner may have meant provinces; it is a question for them.

### Missions on Zones

**Open missions counted by Zone and by Sector, missions and never people** (2026-10-19), from the
missions already on the phone: *Missions in Zones: 1 · by jurisdiction: 4*, with the feed's own age on the key's
missions line above it. Each is placed by the ring the map draws for it, where its package locates its subject, at
about a kilometre or coarser; **a mission filed only by jurisdiction names no Zone, and is counted apart
rather than put in one**. **With no ring, a mission whose package names its Zone or Sector is counted there**
(2026-10-27, interchange rev 9): Starcom's `["zone", id, name]` and `["zone_sector", id, name]`, which the owner
asked partners to carry, both optional and never warned about. Its publisher said which, so it is near no edge;
a Zone these outlines do not hold places it nowhere, and it stays with those by jurisdiction. A ring wins over a
name, since the count is of what the map draws, and a Zone's badge gives way to its Sectors' only when their
counts hold all of the Zone's, so one that names its Zone and no Sector is never dropped from view at a closer
zoom. Counted at the deepest level the phone holds: an open container's Sectors,
else its Zones, else the Terra or Mare. A badge, a rounded rectangle of the ground ringed in ink with its figure in
ink, never round, which is a mission's, hangs at each area's label point, moved a step, within its own area, off a mission's ring
or the key where it would sit under one, a point inside its full-resolution outline that the vendoring
stamps (`labelPoint`, core); a Sector's replaces its Zone's once the Sector is 48 px wide. Nothing open
draws no badge; missions not read draw none either, and the key says so, because unknown is not none.

The outlines are quantised for the phone, and the vendoring measures by how much they drift, at every
source vertex, **for each file of them**: `outlines.json` for the Terrae, Maria and Zones (2.3 km on
Starcom's final set, 1.5 km on the fixture), and each container's file for its own Sectors, which are
quantised apart and drift by their own amount (0.3 to 2.1 km; 0.6 to 1.7 km on the fixture). A mission within a level's drift, plus its own precision, of
that level's drawn edge is near that edge, at that level, with the neighbour across it: **at every level
it is counted in**, so a Zone whose container is open still says it, since the Zone's badge counts it
too. It is still counted where its drawn point falls, and the count says so rather than settle it
silently: **its badge is dashed**, a hover adds *1 near an edge*, and the area's screen names the mission
and the neighbour it may be in instead. A Zone's screen lists its open missions, each a way to it. No
layer's code reads the mission feed: the map hands the counts their missions, and a test holds that.

### Spheres

**Built against NavCom's fixture, 2026-10-19; Mecha Jono's Part 2 lists shipped 2026-10-26** (D9):
thirteen Spheres and 221 memberships, lists 1.0, from starcom-app `ec6714b9`, 4.3 kB compressed, labelled
draft lists until Mecha Jono says they are final. **68 of the memberships are listed and not drawn**
(`drawn: false`): the Francophonie's 5 associates and 28 observers, the Lusosphere's associate
observers, a language official only in one region. NavCom's reader first dropped the flag, which would
have hatched the Francophonie over Japan and Argentina; it now keeps it, a Sphere is shaded over and a
tap names it for only the members it draws, and its screen lists the rest apart, *Listed, not drawn*,
with the list's own note.

**And the organisations of states** (2026-10-27): Mecha Jono's other Part 2 lists, fifteen bodies (the
European Union, NATO, BRICS, the African Union, ASEAN, OPEC, the Commonwealth and the rest), 364
memberships each with its standing and year, vendored from the folder beside the Spheres' by their own
digest (`--organisations-sha256`) and read by NavCom's own reader (`packages/core/src/organisations`).
They are on the Spheres layer rather than a layer of their own: the same kind of thing, a cited list of
countries opened one at a time and hatched, and a layer of their own would have grown the map every
visit loads, which has no room. **Only a member is drawn**; a candidate, a partner, an observer and one
suspended are listed on its screen with their standing, and never shaded or named by a tap, as the lists
say of themselves (*27 members are drawn; the 10 candidates are listed, not drawn*). A standing is any
one lower-case word, since the lists never closed the five they use. A tap names a country's Spheres,
then its organisations: *Canada · Francophonie, Anglosphere · NATO, the Commonwealth, …*. The file is
11.3 kB compressed with both. Eight of them cite Unicode CLDR or the Unihan database,
under Unicode-3.0, which the reader refused until the owner took it as attribution only that day
(`LICENSING.md` carries its notice). Cited membership lists of countries, by ISO code, overlapping, in the shape
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
path names it. A build without them says *Spheres · not in this build yet*.

**Drawn over the world's own outlines by code.** A small state with no outline at 1:110m is a small diamond
at Natural Earth's label point (D9): `web/scripts/label-points.mjs`, from the same pinned commit as the
outlines (`web/scripts/lib/natural-earth.mjs`), writes the 64 such points to the unserved
`web/scripts/data/label-points.json`, and the vendoring copies in only those of members a Sphere names.

**One Sphere is shaded at a time, the one somebody opens, and it is hatched**, 6 px apart in screen space
at every zoom, so it is never taken for a mission's solid lift, with a thin ink outline, and its small
states filled. **With none opened, nothing is shaded**, and the key says *open one to hatch it*: every
member of any Sphere was a lift of 6% (about 1.16:1, invisible in sunlight), and Spheres overlap, so with
the real lists nearly every country is in one and that lift would be a faint wash over the whole world.
A count of Spheres per country was considered and not built: it would measure how many lists cover a
place, not anything about the place. A small state is a small muted diamond, larger and in ink once its Sphere is opened
(2026-10-24): as a 5 px circle Malta's covered Sicily to Tunisia, and Barbados, Singapore and Mauritius
read as missions. **The key names the Sphere
hatched**, *Spheres · Test Anglosphere hatched · …*, after Back and across a pan, since the hatch outlives
the screen that chose it; choosing another layer lets it go. Then the lists' age, **by the oldest read as
well as the newest**, *read 3 Aug–19 Oct*, never the freshest list's date alone. A hover names every
Sphere a country is in, the most specific first; a tap opens them, each a door to its members, its
groups, its sources (links a person chooses to follow, carrying no referrer), when it was read and
whether it is a draft. A country in no Sphere answers as Nation States does, so a tap is never dead.

### Hazards

**Built 2026-10-19.** Fires, volcanoes, storms, floods, droughts and earthquakes, from three public feeds,
over any layer, behind a box on the layers screen: `web/src/lib/grid/layers/hazards.ts`, its own map line
(§6). **It is the only thing on the map that asks anybody outside navcom.app and the relays**, and the
one list of what it asks is `web/src/lib/outside.ts`.

**What it asks, whole-world and never by position.** Five URLs, written out in `outside.ts`, with nothing
in them chosen by the view, the zoom, a tap or where the phone is; `src/lib/boundaries.test.ts` holds that
no host is named anywhere else and no URL is built there but the NWS's, from a state's two letters.
Measured from the live feeds on 2026-10-19, one GET each, and the variant chosen for the device floor:

| Feed | Asked | Measured | Why this variant |
|---|---|---|---|
| USGS | `summary/4.5_day.geojson` and `summary/significant_day.geojson`, merged by id | 2,636 B and 212 B gzipped; 25 quakes and none that day | `all_day` is every small quake on Earth |
| NASA EONET | `events?status=open&category=volcanoes,severeStorms`, and `events?status=open&category=wildfires&days=30` | 47,097 B and 21,331 B, uncompressed; 39 volcanoes and storms, both categories, and the 31 fires dated in the last 30 days. Each sent as `application/rss+xml` and is JSON, which is read as JSON | The whole open list was 4.88 MB, sent uncompressed, 7,148 of it wildfires whose median last report was 738 days old: about 49 s at 0.8 Mbps. `days` would drop volcanoes, whose dates are eruption starts back to 2002, so wildfires are asked apart. The two asks were first derived from that list, then each fetched as written, and matched |
| GDACS | `www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH`, unparameterised; its orange- and red-alert floods, droughts and cyclones still current are drawn from it on the phone | 124,555 B, uncompressed; 86 events, all orange or red, 3 current that day | Its `MAP` list refused a request without an event type; a narrower `SEARCH` is unmeasured, and so is one asking for green alerts too (§7) |

About 196 kB a round in a quiet month for fires, about 1.96 s at the device floor, in the background; about
1.17 MB an hour with it on and the map on screen. **That is October's.** EONET's wildfires swing with the
seasons: at August 2024's count the 30 days would have held at least 1,340 fires, about 922 kB. Every answer
is read no further than a cap of decoded bytes (512 KiB for EONET and GDACS each, 1 MiB for USGS), so a feed
that grew without warning reads *not read: unknown* and never fills a prepaid phone, and **EONET's is held
below that peak on purpose**: a round is then at most about 700 kB, about 7 s, and an answer that passed its
cap is not asked again on that page, so a phone does not pay every 10 minutes for an answer it drops. The
layers screen says both figures before the box is ticked. **Each of a feed's asks is read on its own**: the
wildfires past their cap read *EONET just now, wildfires not read: unknown*, and EONET's volcanoes and storms
are still drawn. No request carries a cookie or a
referrer; each carries an `Origin: https://navcom.app` that no fetch option can remove, which is why the
screen says each host learns the request came from navcom.app.

**When it asks.** Every feed once when ticked; each again 10 minutes after it was last asked, whether that
answered or not, and never sooner; never while the page is hidden, and on coming back into view only what
is due. Turning it off and on inside 10 minutes asks nothing. The choice is never stored, so a reload asks
nobody. Stopped, it keeps no timer and no listener and gives up what was on its way. The service worker
passes requests to another origin straight through, so nothing it asks is cached by NavCom.

**What it says** (invariant 7). The map's key gives each feed its own age, *Hazards · USGS and EONET 3
min ago · GDACS not read: unknown · some events, never all*, feeds side by side that say the same said
once, and all three alike as *3 feeds 3 min ago*, so the key stays short, and *some events, never all*
on every line but *nothing listed*'s, whatever else a phone's key cuts; a feed that failed, answered past its cap or in a shape it was not measured
in reads *not read: unknown*, and what it held before is not drawn as if it were still the list. **So does a
feed that listed entries and could read none of them** (2026-10-19): every quake given another way than a
point, or GDACS's current flag sent as something other than `true` or `'true'` (it is a string today, and a
boolean is read the same), is a feed not read, never one that listed nothing. A kind no reader here knows is
counted as left out, and a feed's word is never taken as a key. When every feed read whole, listed nothing
and left nothing out: *nothing listed by USGS, EONET or GDACS, read 3 min ago · not the same as safe*. Never
*none*, never *0*. The layers screen has a row per feed: how many it listed, when, what it could not draw
(EONET's events given only as an area, which a point would misplace, are counted and not drawn), how many
it left out, and which of its asks did not answer; *nothing drawn* rather than *nothing listed* wherever
anything was.

**Drawn in the neutrals, by shape** (the rule above). A mark per event at the point its source published,
in screen space so it is the same size at every zoom: a six-armed asterisk for an earthquake, a triangle
for a wildfire and a hatched one for a volcano, a hexagon for a storm or cyclone (EONET's and GDACS's alike;
the same storm in both is two marks, not merged, and a hover lists both), a diamond for a flood and a
hatched one for a drought. No circle, square or disc, which the missions, the regions, the sun and the
directory's ages already are. Ink over a halo of the ground; a feed's alert colour is quoted as its word,
*PAGER alert: green*, *GDACS alert: Red*, and never drawn. Marks closer than 11 px share a cell, which
draws one of them by a fixed order and *+n* beside it; **further out than about ×4 on a phone, cells are
24 px and one kind each**, with how many on a pill of the ground (2026-10-24: a fire season drew the US
West as a carpet of triangles), on whichever side of its glyph is clear of every other mark and count, the
largest first. Every mark sits on a casing of the ground, under the missions' rings, and **a cell a ring,
a Zone's count or the sun would be drawn over is moved to the nearest clear spot** (§6), so the fire
season's count is on the map and not under Houston's ring. **GDACS's floods and droughts are events
over an area given as one point**: drawn dashed, and a hover says *an area event; this is its centre, as
GDACS gives it*. A key under the map's names the kinds there are,
sharing lines, *Storms · 2  Quakes · 3  Fires · 1*: a row a kind took five lines on a phone, and pushed the
Earth under the sheet at half, where every screen the map opens comes up (§6).

**Taps.** The one overlay that answers one, after the points and before a lit shape, within 10 px: a
hover names the nearest mark in the source's own words, *M 4.8 - 56 km N of Ruteng, Indonesia · 4.8 mb ·
origin 1 h ago · USGS · and 1 more*; a tap opens the marks in reach, nearest first, in Com, twelve at most
so history holds them, and says *12 of 40 here · zoom in for the rest* when there were more; each with its
source's title, measure and alert as given, its time as given and how old that is, when this phone read the
list and the time the list gives itself, the source's credit, and its links, **only where they are https**
(the Spheres rule). **A time is always named, never a bare age** (2026-10-19), since each source's is
something else: USGS's is the quake's *origin*; EONET's the date of its *latest point*, which for a volcano
is its one point and can be years old while it is open (Fuego's is 2002); GDACS's when it last *updated* its
entry, beside its own From and To. The hover and the screen's key both say which. Quoted, never paraphrased; GDACS's HTML is never used. What a tap took stays lifted while its
screen is open. Opened again from history with Hazards off, the screen says so and asks nothing.

**The policy.** The root carries the site's first `Content-Security-Policy`, `connect-src` only (`vercel.json`):
navcom.app, relays by scheme, since operators choose them, and exactly the four hosts in `outside.ts`; the
inline Distress bootstrap and SvelteKit's start script are untouched. **It is the root's alone**:
/terminal/who checks a proof on api.github.com or any Mastodon instance a card names, so a site-wide list
would break it, and every link out of the root reloads, so its policy never rides into another page. A
terminal page that links back to the root without a reload leaves the root unenforced for that visit:
weaker, not broken. **None does, since 2026-10-19**: the terminal's links back reloaded already, and the two
that did not, the error page's *Start over* and the public site's header on `/who/`, the one site page that
runs the client router, reload now; `src/lib/outside.test.ts` holds every link to the root on a built page
with the router, and the error page's source, which only the router draws. `e2e/landing.spec.ts` allows the
three feeds by name only once Hazards is ticked, and records every policy violation, so a connection the
policy silently stopped cannot pass for one never made.

**Read as data, never vendored**, so nothing of it ships: USGS's is public domain, and EONET and GDACS are
credited by name wherever a mark of theirs is shown (`LICENSING.md`). Nothing about the people being
served is asked or drawn: these are natural events on public record (invariant 1).

### Weather warnings on a mission

**Built 2026-10-19.** A mission filed under a US state, DC or territory has, below the mission and apart
from taking part, a control: *Check NWS warnings for California*. Before the tap it says what the tap tells
api.weather.gov: this phone's address, which can place it roughly, often to a city, its browser, the time,
that it asked from navcom.app, and which state. Only when tapped does it ask `alerts/active?area=CA`, once
(a second tap inside a minute reuses the answer), and it shows the warnings the NWS issued, an event ending
in *Warning*, and, since 2026-10-19, **the emergencies it relays that ask people to act now** though their
names do not: *Evacuation Immediate*, *Civil Emergency Message*, *Local Area Emergency* and *911 Telephone
Outage Emergency* (`EMERGENCIES` in `nws.ts`); each of status *Actual*, not a cancellation. *Child Abduction
Emergency* is about a person, not a place, and is not shown. Watches, advisories and statements are not
shown, it says so before the tap, and after it **how many other alerts were out and not shown**, so none
shown never reads as nothing out. Each in the NWS's words, its event, its headline, **the area it names**
(`areaDesc`, cut with a visible … where long: a statewide answer covers places far apart), who sent it, and
when it ends, or *no end issued* beside when the message expires, exactly as issued, and how long ago it was
sent. None issued reads *No warnings or emergencies issued for California as of 13:20 UTC. The NWS lists what
it has issued; it does not say a place is safe.* A failure reads *NWS not read: unknown*. Filed for the whole country, it asks nothing, since the NWS is asked by state; outside the US it
says no warning service is read for that place. Measured for California: 2,819 B on the wire, 13,941 B
decoded, capped at 4 MiB for an outbreak.

**It informs and never gates** (invariants 8 and 9). Starcom's own reader calls a mission off on a warning;
NavCom's never does. Taking part reads nothing from it, and a test holds that the control is not in taking
part's snippet and that taking part is the same before and after a read. Nothing pages, notifies or
announces assertively, and nothing of it is near Distress, which Com never covers (`e2e/com-distress.spec.ts`
reads the warnings at every height of the sheet). `web/src/lib/missions/nws.ts`; NavCom's own code, as
Starcom's is AGPL-3.0-only.
