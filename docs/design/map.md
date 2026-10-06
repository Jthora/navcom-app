# Nav: two maps, and the line between them

The landing surface is a map. It has to be: the grid is the thing somebody is looking at
when they open this, and a search box over a list is not a situation. But "a map" is two
different products wearing one word, and the whole design is in deciding which one we build
and which one we hand off.

Status: **design, decided where marked.** Nothing here is built. Normative sources it leans
on: [`panel.md`](panel.md), [`missions.md`](missions.md),
[`directory-schema.md`](../product/directory-schema.md),
[`delivery.md`](../delivery.md).

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

**The coordinates claim a precision nothing earned.** They ship at seven decimal places —
`34.97105026245117` — which is centimetre resolution on a record whose own confidence is
`low` and whose address was read off a website. Seven decimals of noise also costs about
320 KB across the file. The fix is in the data, not the renderer: **round each coordinate to
the precision its method earned** — five places (~1 m) for a geocoded street address, two
(~1.1 km) for anything placed by region or by hand. A renderer that truncates on the way out
still ships the lie in the file anyone can download.

---

## 1. The decision

**Two surfaces with a hard line between them, not one map with a zoom range.**

| | What it is | Whose |
|---|---|---|
| **The grid** | Vector outlines we draw ourselves: regions, missions, reports. The landing map, always | Ours. No third party, no key, works offline |
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
(§5). The grid itself makes zero third-party requests, which means **the common case —
looking at the map — tells nobody anything.** That is the property worth protecting, and it
is why the heavy layer is opt-in rather than lazy.

**Deferring only pays if the deferred thing is genuinely not fetched.** A mini-map that
lazy-loads when it scrolls into view is a mini-map that loads. Click-to-load, with a
placeholder that says what tapping it will do.

---

## 3. The grid, which we draw

**Geometry.** [Natural Earth](https://www.naturalearthdata.com/) admin-0 and admin-1, public
domain, no attribution required, at the 1:50m and 1:110m generalisations. Admin-2 (counties
and their equivalents) only where a region actually has records, from
[geoBoundaries](https://www.geoboundaries.org/) (CC BY 4.0, so it carries a credit).
Quantised TopoJSON, simplified per zoom band, one file per band. The global admin-1 set is
44.5 MB as raw GeoJSON and a US admin-1 TopoJSON is 20.5 KB at 1:110m, so the budget is
plausible and **unmeasured — measuring it is the first task, not an assumption.**

**Projection: Web Mercator**, accepted with a known cost. Mercator is wrong for a world
view — it inflates Alaska and flatters the northern hemisphere, and an equal-area projection
would be both more honest and more distinctive. We take Mercator anyway, because §4's road
layer has to align with the grid at the same viewport, and a reprojection at switch time
turns a layer swap into a different map. One projection, two layers.

**Canvas 2D, not SVG.** Three thousand county paths as DOM nodes is the thing that kills a
prepaid Android 8 with 400 MB free — the device floor is in [`delivery.md`](../delivery.md)
and it is a real phone. Paths draw to canvas; taps hit-test against a quadtree built once.

**Both themes are ours**, which is the quiet advantage of drawing it: there is no white tile
to dim and no third-party style to fight. Colours come from `panel.md`'s tokens, so dark is
the default rather than a filter over somebody else's daylight.

---

## 4. The switch, and the mini-map

Three layers. Only the first is on at first paint.

| Layer | Source | Default |
|---|---|---|
| **Grid** | Ours | **On.** Zero third-party requests |
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
3. **A mission's coarse point is coarse in storage**, not rounded at render. Anything else is
   one component away from publishing a doorstep.

---

## 6. What is on the grid when it opens

Open and claimed missions, and public reports. **Not the 9,623 directory records.** The
landing map is a situation, not an inventory — the directory stays searched rather than
browsed, and ten thousand pins is a heat map of where somebody once ran a scraper, not of
anything happening tonight.

Budgets, all of them targets to measure rather than claims:

| | Target |
|---|---|
| Grid geometry, world admin-0 + admin-1 | ≤ 250 KB gzipped |
| Third-party requests at first paint | **Zero** |
| Repeat visit, no new deploy | Zero network for the grid — service worker now covers the whole origin |
| Device floor | Interactive on a prepaid Android 8, 400 MB free |

---

## 7. Open, and who answers it

- **Measure the geometry.** Every number in §3 and §6 is an estimate until a build produces
  the file. First task.
- **The seven-decimal coordinates are a data fix**, affecting 9,623 published records. It is
  separable from the map and should not wait for it.
- **Satellite is declined**, per [`declined.md`](../declined.md)'s rule that a gap may be
  closed rather than carried.
