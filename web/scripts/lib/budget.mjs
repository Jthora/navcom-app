/**
 * The budgets, and the measurement the gate makes against them.
 *
 * "The device floor is a real target, not an aspiration. Check bundle size." — CLAUDE.md
 * Budgets in docs/delivery.md. `../budget.mjs` runs this and fails the build rather than warning,
 * because a budget nobody enforces is a wish.
 *
 * It measures what a browser actually DOWNLOADS for a page — the HTML plus the assets that
 * HTML references — not everything sitting in build/. Those differ sharply here: with
 * client-side rendering off, SvelteKit still emits client chunks that no page ever loads.
 * Counting them would report a payload no reader is ever served.
 *
 * Every walk over the chunk graph goes through `closure.mjs`, which the tests import too.
 *
 * **A module, not a script.** It writes nothing and never exits, so the tests import exactly this.
 * The gate used to live in one file that ran itself only when `import.meta.url` matched
 * `process.argv[1]`, and that comparison fails, silently and with exit 0, for a checkout whose path
 * has a space in it or is reached through a symlink: `npm run budget` would then measure nothing and
 * pass, and the health file would publish `budget: null`. The script that runs it has no condition
 * left to fail.
 *
 * Weight a page can pull LATER, by dynamic import, is measured too. The page budgets below measure
 * first paint, because a chunk fetched by `import()` appears in no `src` or `href`. Com loads its
 * navigation stack, chat and search when somebody opens the sheet [design/com.md §6], so those chunks
 * are delivered to readers while invisible to every page figure. The graph comes from Vite's
 * manifest, which records `dynamicImports` per chunk, so no JavaScript is parsed. Missing manifest is
 * not an error: a build without one simply has nothing to say there.
 */

import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { closure, entries, firstPaint, htmlRefs, isStale, keyOf, readManifest, routeNodes } from './closure.mjs';

/**
 * Two surfaces, two budgets, and the split is the point.
 *
 * The public site is a document: it must deliver ZERO JavaScript, so a reader with
 * scripting off, an old phone, or a proxy in front of them still gets the directory. That
 * budget is not "small", it is nothing, and it fails on the first byte.
 *
 * The Field Terminal is an application. It needs script to sign, seal and hold state
 * offline.
 *
 * ## Where the terminal's number comes from
 *
 * It used to come from "a prepaid Android 8 with ~400MB free", which was never measured and
 * turned out to be the wrong axis entirely — see `docs/research/device-floor.md`. Measured
 * against the built terminal at a 6x CPU penalty:
 *
 * | bundle | 1.6 Mbps | 0.8 Mbps | 128 kbps |
 * |--------|----------|----------|----------|
 * | 139 kB |  1.81 s  |  3.00 s  |  10.6 s  |
 * | 240 kB |  2.41 s  |  4.05 s  |  17.3 s  |
 *
 * Two findings decide the shape of this budget:
 *
 * - **Bandwidth dominates, not the device.** Doubling the CPU penalty costs 250 ms;
 *   halving bandwidth costs seconds. A budget justified by a slow processor was measuring
 *   the wrong thing
 * - **The cost is paid once.** A repeat visit is ~300 ms on any network and identical
 *   offline, because the service worker has it. This number governs a first install, not a
 *   night on patrol
 *
 * So the budget is derived from a **time**, on the connection that actually degrades:
 *
 *   design point   0.8 Mbps, 6x CPU  — a congested LTE cell, which is where a first
 *                                      install most plausibly happens
 *   target         interactive within 4 s, cold
 *   measured       ~1540 ms fixed + ~1050 ms per 100 kB
 *   → limit        (4000 - 1540) / 1050 * 100  ≈  235 kB, rounded down to 220 kB
 *
 * **Re-derive it rather than nudging it.** The last time this number moved it went from
 * 100 kB to 140 kB with no comment, and the two figures disagreed in two files for months.
 * If 220 is wrong, change the target or the design point and recompute — both are here.
 */

/** Measured coefficients, so the report can state a time and not just a size. */
const COLD_FIXED_MS = 1540;
const COLD_MS_PER_KB = 1050 / 100;

/**
 * @typedef {{ label: string, match: (name: string) => boolean, js: number, warn: number, page: number }} Surface
 * @type {Record<string, Surface>}
 */
export const SURFACES = {
  public: {
    label: 'public site',
    match: (name) =>
      !name.startsWith('terminal/') &&
      name !== 'index.html' &&
      name !== 'who/index.html',
    js: 0,
    warn: 0,
    page: 250 * 1024
  },
  /**
   * The root console. A sibling of the terminal, not nested under it, and lighter than any
   * terminal page **at first paint**: there it imports `storage` to read whether somebody is signed
   * on and which mission they left to sign on, and nothing of the identity, relay or
   * signature-checking stack that gives every `terminal/*` page its floor. So it carries its own,
   * much smaller budget rather than inheriting one sized for that stack. That the relays stay out of
   * its first paint is held by `src/lib/boundaries.test.ts`, not by this comment.
   *
   * First paint only. As the page mounts it imports the map, the live mission feed and Com's list
   * of screens, on every visit, and the feed brings core's signature checking with it: that is the
   * *mount* tier below, reported beside this budget and not inside it.
   *
   * Re-derived against a real build rather than guessed: measured at 49.7 kB JS / 66.8 kB
   * page total the day this shipped. `js` leaves ~20% headroom over that; `page` leaves more,
   * because — unlike a terminal screen — this page's HTML embeds a search index sized to the
   * whole directory, so its floor grows with real data, not just code.
   */
  root: {
    label: 'root console',
    match: (name) => name === 'index.html',
    js: 60 * 1024,
    warn: 52 * 1024,
    page: 120 * 1024
  },
  /**
   * The public roster, which is **not** the same kind of page as the console.
   *
   * They were given one budget on the assumption that they were, and the budget said no at
   * 130%. The console's comment above explains why its number is small: its first paint never
   * imports the identity/relay stack, though its mount tier does. The roster's entire job is reading
   * signed events from a relay, so it imports exactly that stack at first paint and cannot not.
   *
   * Derived rather than chosen to fit: measured at **78.3 kB JS / 82.2 kB page**, which the
   * coefficients above put at ~2.4 s to interactive on a congested cell — well inside the 4 s
   * design point the terminal's own budget is derived from. `js` leaves ~20% headroom, the
   * same margin the console gets.
   *
   * The floor here is signature verification. An unverified card on a public page is a
   * forgery anybody can publish, so the crypto is not the part to trim.
   *
   * **It crept to 97,720 B by 2026-10-27, over the ceiling, and none of it was the roster's.** The
   * page read core through its index, so every module core has was among its dependencies, and the
   * bundler handed it their shared chunk: the mission reader rode in, and grew with every rule added
   * to it. It reads `@navcom/core/card` and `/relays` now, which reach no mission module, and measured
   * 78.6 kB, its derivation's own figure. The ceiling is unchanged.
   */
  roster: {
    label: 'public roster',
    match: (name) => name === 'who/index.html',
    js: 95 * 1024,
    warn: 86 * 1024,
    page: 130 * 1024
  },
  terminal: {
    label: 'field terminal',
    match: (name) => name.startsWith('terminal/'),
    /** Hard stop. Derived above: 4 s to interactive at 0.8 Mbps on a cheap phone. */
    js: 220 * 1024,
    /**
     * The ratchet, and the actually useful line.
     *
     * A budget only forces a decision while it is near, and one at 99% forces a *crisis* —
     * which is how the last silent raise happened. This prints loudly and does not fail, so
     * growth is noticed while there is still room to decide what to do about it.
     */
    warn: 160 * 1024,
    page: 260 * 1024
  }
};

/*
 * The root console, by when each byte arrives.
 *
 * One figure used to stand for all of it after first paint, "Root, later": 68.9 kB, described as
 * what one visit downloads on opening the sheet. Most of it was not the sheet's. `+page.svelte`
 * imports the map and the live mission feed as soon as it mounts, on every visit, sheet opened or
 * not, and the feed pulls core's signature-checking chunk with it: measured 2026-10-09 at 39.7 kB
 * of the 68.9, against 28.6 kB for the mission screens. A ceiling for profile or crews derived from
 * the single figure would have charged them for the map.
 *
 * So the root reports three tiers. **First paint** is what the HTML names, and is the enforced
 * root budget above. **Mount** is what the page imports when it mounts, beyond first paint. **Each
 * Com entry** is what opening it costs beyond both, because a person waits for the entry they open
 * and not for every entry there is [groups.md §13]. Shared chunks are counted in the first tier
 * that loads them and never again.
 *
 * Mount and each entry are walked through static imports only. An `import()` inside one of them is
 * not that tier's: a people card opened lazily from a mission screen would otherwise be charged to
 * missions, and an import nested in the feed would be filed under mount, which the report calls
 * every visit. So a nested `import()` is a tier of its own, named by `COM_ENTRIES` or reported as
 * unclassified, however deep it is.
 *
 * Which dynamic imports are mount-time and which wait for the sheet is a fact about
 * `routes/+page.svelte` that the manifest cannot know, so it is declared here and
 * `src/lib/budget.test.ts` checks the declaration against the page and the build. A dynamic import
 * named in neither list is reported on its own line as unclassified rather than guessed into one.
 * SvelteKit's own generated modules, such as its error page, are named apart as `framework`.
 *
 * First paint has the root's ceiling, and mount has its own since 2026-10-18 [MOUNT]. Each entry
 * is reported, not enforced, until a ceiling is derived from a measurement, as every budget here was.
 * The map's layers are the exception, also since 2026-10-18: each is a line with ceilings of its
 * own, enforced from the moment it exists and charged to it rather than to Deferred [MAP_LINES].
 */
/**
 * Imported by `+page.svelte` on mount, on every visit. Keys as Vite's manifest spells them. Com's
 * own code is one of them: its list of screens and the one component that draws each, so that the
 * page's first paint names no entry [$lib/com/screens].
 */
export const ROOT_MOUNT = ['src/lib/components/grid/GridMap.svelte', 'src/lib/missions/live.ts', 'src/lib/components/com/index.ts'];
/**
 * Loaded the first time somebody opens one of Com's screens [com.md §6], by entry name. Imported by
 * Com's registry (`ENTRIES` in `src/lib/com/screens.ts`), never by the page, so each is a tier the
 * walk finds inside mount.
 */
export const COM_ENTRIES = /** @type {Record<string, string>} */ ({
  missions: 'src/lib/components/missions/index.ts',
  // Also a map line, so its code is charged to that line and never to Deferred [MAP_LINES].
  layers: 'src/lib/components/layers/index.ts',
  // Profiles, your own, and Find [groups.md §13, phase 1]: a line of its own, like missions.
  people: 'src/lib/components/people/index.ts'
});

/*
 * The map's layers, each a line of its own. Since 2026-10-18.
 *
 * The map is getting layers somebody chooses: Zones and their Sectors, time zones, and later Spheres
 * (the owner's map decisions, D6 to D10). Each brings code and data that arrive when somebody chooses
 * it, never at first paint and never at mount. Charged to the shared lines, they had nowhere to go.
 * Measured at 654622b, the day this was written, the root's first paint was at 60,678 B of 61,440 and
 * Deferred at 56,767 B of 58,368, with 1.6 kB left. The Zones reader and lookup alone were estimated
 * at 3 to 5 kB. The first layer to land would have spent Deferred's last kilobyte and a half, and
 * re-deriving Deferred upward to fit the second is the silent raise this file exists to stop.
 *
 * So each moment a layer costs somebody something is a line here. A line says what loads at that
 * moment, and has two ceilings: one for its code beyond first paint and mount, one for its data. A
 * line's code is charged to the line and never to Deferred. A chunk it shares with anything else
 * stays in Deferred, because that other thing loads it anyway.
 *
 * **A line that arrives before its ceiling fails the build.** Com's entries are reported until a
 * ceiling is derived. A layer is not, because "reported until measured" is how a shared line gets
 * eaten. A ceiling is derived from a measurement, in this file's unit, with ~20% headroom and a
 * warning line about 8% above the measurement. The measurement is kept beside it, so `budget.test.ts`
 * can hold the headroom to that rule. Nothing here is measured that does not exist yet. The layers'
 * screens, Zones, the lookup and Time zones are written, and their code was measured on 2026-10-19, as
 * Time zones' two files were, so those ceilings are derived; so were the four slices drawn over a layer
 * that evening, day and night, the directory by last check with its file, missions by Zone, and the
 * Spheres' code. The data came later, each derived the day it was vendored: the Zones' outlines, the
 * largest container's Sectors and the lookup's index from Starcom's final partition, and the Spheres'
 * lists (both 26 Oct, D6 and D9), their fixtures never shipping. A container's Sectors
 * have no code of their own, which arrives with the Zones line. The change that lands each part derives
 * its ceiling from what it measured; the failure prints the numbers to write.
 *
 * Each line's code is one module under `src/lib/grid/layers/`, loaded by `import()` from the map or
 * from a Com screen, and never statically. A layer something imports statically arrives with that
 * something, and its line would be measuring a moment that never happens. A Com entry can be a line
 * too, by naming its key as the line's `code`; the line then takes it from the entries. Two more
 * things fail: a module under that directory that no line declares, and a line's code that loads at
 * first paint or mount.
 */
/**
 * A ceiling, and the measurement it was derived from, in this file's unit: bytes, gzipped at zlib's
 * default level.
 *
 * @typedef {{ limit: number, warn: number, measured: number, why: string }} Ceiling
 */
/**
 * What one moment asks of hosts outside navcom.app, which no build holds, so it is measured from the
 * hosts themselves and written here with how [docs/product/what-leaves.md]. `measured` is one round on
 * the wire, the sum of `feeds`; `caps` are the decoded bytes the phone reads of each answer before it
 * drops it, which `src/lib/outside.ts` enforces and `budget.test.ts` holds equal. The build prints it
 * and cannot enforce it: the phone does. `peak` is the most a round can cost when the answer that
 * swings with the seasons grows past its cap, everything else as measured: a measurement is of one
 * day, and a feed's busy season is not that day.
 *
 * @typedef {{
 *   measured: number, limit: number, warn: number, why: string,
 *   feeds: { url: string, wire: number, decoded: number, encoding: string, how: string }[],
 *   caps: Record<string, number>,
 *   peak?: { bytes: number, swings: string, why: string }
 * }} Remote
 */
/**
 * `when` is the moment somebody pays for this line. `code` is its module as Vite's manifest keys it,
 * or null when its code arrives with something else. `files` picks its data out of `build/`. `per`
 * says whether that moment fetches every one of those files (`all`), or one of them (`each`), in
 * which case the largest is the figure. `js` and `data` stay null until there is something to measure.
 * `remote` is what it asks of anybody outside navcom.app, for the one line that does [Remote].
 *
 * @typedef {{
 *   when: string,
 *   code: string | null,
 *   files: ((file: string) => boolean) | null,
 *   per: 'all' | 'each',
 *   js: Ceiling | null,
 *   data: Ceiling | null,
 *   remote?: Remote | null
 * }} MapLine
 */
/** Where the layers' code lives: one module per line, and nothing else. */
export const LAYER_CODE = 'src/lib/grid/layers/';
const ZSP = 'grid/zsp/';

/** @type {Record<string, MapLine>} */
export const MAP_LINES = {
  /*
   * The picker, and the screens a layer opens in Com: the layers, a Zone or Sector, a lookup's answer,
   * a time zone. A Com entry, named here as this line's code, so it is charged here and not to the
   * Deferred line it would otherwise have eaten [COM_ENTRIES]. Its own data is none: every file it
   * shows is another line's.
   */
  layers: {
    when: 'opening the map’s layers',
    code: 'src/lib/components/layers/index.ts',
    files: null,
    per: 'all',
    js: {
      limit: 20_577,
      warn: 18_520,
      measured: 17_148,
      why:
        'Re-derived 2026-10-24 at 17,148 B, from 14,878 B: the map’s whole key, every line it says with the ' +
        'rest of its words, the row of marks under it whole, and every kind of mark the map draws, drawn as ' +
        'it draws them, which the map’s own key cuts short on a phone. ' +
        'Re-derived 2026-10-19 at 14,878 B, from 10,689 B measured that afternoon against a 10,364 B ' +
        'derivation, for Hazards: its box and, beside it, in plain words before it is ticked, which three ' +
        'hosts it asks and what each learns; a row per feed once it is on, each with its age or not read; ' +
        'a sixth screen, what a tap on a hazard took, in its source’s own words with its links, https only; ' +
        'and outside.ts, the one list of what the page asks outside navcom.app (1,549 B), which the Hazards ' +
        'line and the missions entry load too. ' +
        'Re-derived 2026-10-19 at 10,364 B, from 5,779 B the same morning, for what the four new map ' +
        'slices put on these screens: the day-and-night box and where the sun is overhead; the directory-' +
        'by-last-check box and its full key, every class with its count; a Zone’s open missions, each a ' +
        'way to it, its near-edge notes and what is placed in no Zone; the Spheres panel; and a fifth ' +
        'screen, a Sphere, its members as doors, its groups and its cited sources. Each layer’s own code ' +
        'is still its own line, so none of it is here; it is the screens alone, paid only on opening the ' +
        'map’s layers.'
    },
    data: null
  },
  /*
   * D10: every outline, whole, when Zones is chosen. The reader and the drawing are one module, and
   * nothing is fetched by what is on screen.
   */
  zones: {
    when: 'choosing Zones',
    code: `${LAYER_CODE}zones.ts`,
    files: (f) => f === `${ZSP}outlines.json`,
    per: 'all',
    js: {
      limit: 3_165,
      warn: 2_849,
      measured: 2_638,
      why:
        'Re-derived 2026-10-27 at 2,638 B, from 1,721 B: with every point of Starcom’s final set kept, ' +
        'each edge thinned for drawing once for each doubling of zoom, only the edges on the canvas ' +
        'stroked, and the lines kept as a picture between frames that have not moved, which took opening ' +
        'Mare Pacificum at a sixth of the speed from three frames of 200 to 230 ms to two of 51 to 72. ' +
        'Re-derived 2026-10-26 at 1,721 B, from 1,494 B: each edge stroked once, from the file’s arcs, in ' +
        'place of each ring that has it, which under Starcom’s whole draft took opening Mare Pacificum from ' +
        'tasks of 164 ms to 87 at a sixth of the speed; here and not in the topology module, whose growth ' +
        'mount would carry. ' +
        'Re-derived 2026-10-24 at 1,494 B, from 1,397 B: the key’s one short line with the draft’s stage, the ' +
        'credit CC BY asks for over the map’s foot, and a Sector’s edge dashed in the strong line from ×4 in. ' +
        'Measured 2026-10-19 at 1,397 B: reading the outlines and a container’s Sectors, drawing them in ' +
        'three weights, and answering a tap. The data has no ceiling until Stage 1 is vendored (23 Oct): ' +
        'the change that vendors it derives one from what it measures.'
    },
    data: {
      limit: 84_559,
      warn: 76_103,
      measured: 70_466,
      why:
        'Derived 2026-10-26 at 70,466 B: Starcom’s final partition (ec6714b9), its 17 Terrae and Maria and ' +
        '251 Zones at every point the format gives, 16,303 of them, quantised to 10,000, drifting 2.3 km at ' +
        'most. Simplified to a tenth of its points it was 31,956 B and lost islands and the ends of thin ' +
        'Zones, 100 km off at the median; a cap on distance kept nearly every point, at 69,576 B.'
    }
  },
  /*
   * D10: a container's Sectors, one file, when somebody opens that Terra or Mare. Its code is the
   * reader the Zones line already loaded.
   */
  'zones-container': {
    when: 'opening one Terra or Mare',
    code: null,
    files: (f) =>
      f.startsWith(ZSP) && f.endsWith('.json') && !f.slice(ZSP.length).includes('/') && f !== `${ZSP}outlines.json` && f !== `${ZSP}index.json`,
    per: 'each',
    js: null,
    data: {
      limit: 43_481,
      warn: 39_133,
      measured: 36_234,
      why:
        'Derived 2026-10-26 at 36,234 B, the largest: Mare Pacificum’s 658 Sectors from Starcom’s final ' +
        'partition (ec6714b9), at every point, drifting 2.1 km at most. The smallest is Mare Arcticum’s, ' +
        '4,347 B.'
    }
  },
  /*
   * D7 and D10: the whole-Earth index, fetched the first time somebody asks which Sector a place is in,
   * and the lookup that answers it on the phone. Nothing is sent.
   */
  'zones-lookup': {
    when: 'the first lookup of which Sector a place is in',
    code: `${LAYER_CODE}zones-lookup.ts`,
    files: (f) => f === `${ZSP}index.json`,
    per: 'all',
    js: {
      limit: 1_598,
      warn: 1_439,
      measured: 1_332,
      why:
        'Measured 2026-10-19 at 1,332 B: core’s lookup in longitude and latitude, with the bounding-box ' +
        'prefilter and the edge test that offers both Sectors within 1.5 km. Its index has no ceiling ' +
        'until a stage with Sectors is vendored.'
    },
    data: {
      limit: 287_232,
      warn: 258_509,
      measured: 239_360,
      why:
        'Derived 2026-10-26 at 239,360 B, 1.27 MB unpacked: all 2,632 Sectors of Starcom’s final partition ' +
        '(ec6714b9) at lookup precision, quantised to 100,000. Estimated at 0.4 to 0.55 MB before, which was ' +
        'not a measurement; at a sixth of the speed it answered Nairobi in 0.8 s (the draft, 26 Oct).'
    }
  },
  /*
   * D8: Natural Earth's 1:10m time zones, standard offsets, loaded when chosen. The code and both its
   * files ship, and all three were measured on 2026-10-19.
   */
  timezones: {
    when: 'choosing Time zones',
    code: `${LAYER_CODE}timezones.ts`,
    // The bands, and each directory region's own IANA zone, fetched together when it is chosen.
    files: (f) => f === 'grid/timezones.json' || f === 'grid/region-times.json',
    per: 'all',
    js: {
      limit: 1_581,
      warn: 1_423,
      measured: 1_318,
      why:
        'Measured 2026-10-19 at 1,318 B: decoding the bands, drawing them as alternating lifts, naming an ' +
        'offset, and each region’s own clock through Intl.'
    },
    data: {
      limit: 63 * 1024,
      warn: 57 * 1024,
      measured: 53_698,
      why:
        'Re-derived 2026-10-19 at 53,698 B, from 44,252 B the day before, because the line now carries ' +
        'two files where it was measured with one. The bands are 44,292 B: ne_10m_time_zones at the ' +
        'pinned Natural Earth commit (ca96624), dissolved by standard offset to its 40 bands, keeping only ' +
        '`zone`, simplified to 10% on the sphere with keep-shapes and quantised to 10,000, with mapshaper ' +
        '0.7.78; the 3% setting parted the Chatham Islands from the hole left for them. Beside them, 9,406 B ' +
        'of grid/region-times.json: each directory region’s IANA zone, so a region’s ring and its place ' +
        'give the time its clocks show, daylight saving included, which the bands cannot (D8). Its own ' +
        'file rather than console-regions.json, which every visit fetches.'
    }
  },
  /*
   * The Spheres' lists, vendored 26 Oct, and the organisations' beside them from 27 Oct, with the label
   * points D9 draws their small member states at, written into the same file by `scripts/spheres-vendor.mjs`.
   */
  spheres: {
    when: 'choosing Spheres',
    code: `${LAYER_CODE}spheres.ts`,
    files: (f) => f === 'grid/spheres.json',
    per: 'all',
    js: {
      limit: 2_852,
      warn: 2_567,
      measured: 2_377,
      why:
        'Re-derived 2026-10-27 at 2,377 B, from 2,177 B: the organisations of states on the same layer, ' +
        'their members shaded and every other standing listed, and a Sphere’s or organisation’s ' +
        'members a list counts and does not draw left unshaded and unnamed by a tap. ' +
        'Re-derived 2026-10-24 at 2,177 B, from 2,170 B: a small state a small filled diamond rather than a ' +
        'dotted circle, a mission’s shape, and the lists’ credit over the map’s foot. ' +
        'Re-derived 2026-10-19 at 2,170 B, from 2,014 B the same day: reading the vendored lists, the ' +
        'Sphere opened hatched in screen space and nothing shaded until one is, a small state as a dotted ' +
        'circle at its label point and a filled one in the Sphere opened, the key naming what is hatched ' +
        'and the lists’ read dates oldest to newest, and answering a hover or a tap with every Sphere a ' +
        'country is in. Its data has no ceiling until Mecha Jono’s lists are vendored (due 26 Oct), ' +
        'estimated at 6 to 12 kB, which is not a measurement: the change that vendors them derives one.'
    },
    data: {
      limit: 13_543,
      warn: 12_189,
      measured: 11_286,
      why:
        'Re-derived 2026-10-27 at 11,286 B, from 4,264 B: Mecha Jono’s fifteen organisations of states ' +
        '(lists 1.0, 364 memberships, 55 of them a standing other than member) vendored beside the ' +
        'Spheres from ec6714b9, each membership with its year and source, and 34 small members as ' +
        'circles where there were 16. Derived 2026-10-26 at 4,264 B: Mecha Jono’s thirteen Spheres (lists 1.0, 221 memberships, 68 of ' +
        'them listed and not drawn) as vendored from starcom-app ec6714b9, with each list’s note and the ' +
        'sixteen small members D9 draws as circles. First measured that day at 3,633 B without the notes ' +
        'or the flags, and so hatching the Francophonie over its observers. Under the 6 to 12 kB estimated, ' +
        'because a list is two-letter codes and its sources.'
    }
  },
  /*
   * Day and night: drawn whenever Time zones is chosen and over any other layer while its box is
   * ticked. Worked out on the phone from its own clock, so it has no data at all, and never will.
   */
  daylight: {
    when: 'drawing day and night: choosing Time zones, or ticking it over another layer',
    code: `${LAYER_CODE}daylight.ts`,
    files: null,
    per: 'all',
    js: {
      limit: 2_491,
      warn: 2_242,
      measured: 2_076,
      why:
        'Re-derived 2026-10-19 at 2,076 B, from 1,567 B the same day: the sun’s position from the ' +
        'almanac’s formulas; twilight and night as two caps, each a darker step and a grid of dots kept ' +
        'on device pixels, since tone alone cannot carry night on land this dark; the caps’ runs along ' +
        '±180° drawn in steps so the night reaches the Earth’s bulging edge; the line between and the ' +
        'sun where it is overhead, rebuilt once a minute, on the minute, never while the page is hidden; ' +
        'and the swatch that says what the dots are. Nothing is fetched for it.'
    },
    data: null
  },
  /*
   * The directory by last check, over Nation States: each record's check date, read on the phone
   * against its own clock, so it ages between deploys. Its data's ceiling is derived from a model of
   * the file after months of re-checking region by region, not from today's three dates, because the
   * dates are what it grows with first [budget.test.ts, the 90-day model].
   */
  ages: {
    when: 'showing the directory by last check',
    code: `${LAYER_CODE}ages.ts`,
    files: (f) => f === 'grid/region-ages.json',
    per: 'all',
    js: {
      limit: 3_274,
      warn: 2_947,
      measured: 2_729,
      why:
        'Re-derived 2026-10-24 at 2,729 B, from 2,636 B: the four classes a family of squares, since the ' +
        'circle is a mission’s, and the key’s short words, so every class there is fits a phone’s key. ' +
        'Re-derived 2026-10-19 at 2,636 B, from 1,983 B the same day: reading the dates as runs and ' +
        'laying them out once, every region’s and record’s reading worked out once a day so a frame ' +
        'only looks them up, a region by its oldest, four shapes rather than four tones at the size ' +
        'their swatches are, thinned where they would crowd so the most cautious is the one drawn, and ' +
        'the words, which name how long ago and never what a page shows.'
    },
    data: {
      limit: 17_228,
      warn: 15_506,
      measured: 14_357,
      why:
        'Derived 2026-10-19 from a model, measured at 14,357 B: grid/region-ages.json as it would be with ' +
        'the real 1,912 regions each re-checked on one of 90 days, a tenth of those with three or more ' +
        'places in three runs (budget.test.ts builds it from the build). Today’s file, three dates, is ' +
        '10,843 B. The first ceiling was 13,328 B from today’s file with one index a record, and ten ' +
        'dates would have failed it before the directory grew by one record; the file is runs of a date ' +
        'now, and 8.7 kB of it is the regions’ names. A directory checked record by record on scattered ' +
        'days is not this model and outgrows it (about 22 kB at 30 days): re-derive then, on purpose.'
    }
  },
  /*
   * Open missions counted by Zone and Sector, while Zones is chosen: from the missions already on the
   * phone, so it fetches nothing. The label points it hangs each count on ride in the outlines, which
   * are the Zones line's data.
   */
  'zone-missions': {
    when: 'choosing Zones, which counts its open missions',
    code: `${LAYER_CODE}zone-missions.ts`,
    files: null,
    per: 'all',
    js: {
      limit: 3_061,
      warn: 2_755,
      measured: 2_551,
      why:
        'Re-derived 2026-10-24 at 2,551 B, from 2,129 B: a count never round, which a mission is, moved a step ' +
        'off a mission’s ring or the key where it would sit under one, and where it is said once for ' +
        'drawing it and for keeping the map’s names off it. ' +
        'Re-derived 2026-10-19 at 2,129 B, from 2,004 B the same day: placing each mission’s drawn point ' +
        'in its Terra or Mare, Zone and open Sector; saying, at every level it is counted in and by that ' +
        'file’s own drift, which are near an edge the simplified lines cannot settle; and a count drawn at ' +
        'each label point, dashed where it holds one of those, a Sector’s once it is wide enough on screen.'
    },
    data: null
  },
  /*
   * Names on the map: countries from ×2, provinces from ×6, Starcom's Terrae, Maria and Zones with
   * Zones, and each time zone's offset with Time zones. Loaded the first time somebody zooms in to ×2 or
   * chooses Zones or Time zones; it fetches nothing, since every name is in a file the map already has
   * or in the phone's own tables.
   */
  labels: {
    when: 'zooming in to ×2, or choosing Zones or Time zones, which names what is drawn',
    code: `${LAYER_CODE}labels.ts`,
    files: null,
    per: 'all',
    js: {
      limit: 1_987,
      warn: 1_788,
      measured: 1_656,
      why:
        'Measured 2026-10-24 at 1,656 B: which names each zoom and layer wants, each at its file’s label ' +
        'point or a point well inside it, worked out once; laid out greedily, largest first, on a halo of ' +
        'the ground, clear of each other, the key, the sheet, the rings, the counts and the hazards; an ' +
        'offset written from its number; and, from ×4 in, that outlines outside the countries with regions ' +
        'are 1:110m. It fetches nothing.'
    },
    data: null
  },
  /*
   * The land at the world file's finer scale, from ×2 in: the countries with provinces filled from them,
   * and the coast and borders to match. Loaded the first time somebody zooms in that far; it fetches
   * nothing, since it is worked out from the file every visit already has.
   */
  fine: {
    when: 'zooming in to ×2, where the countries with provinces are drawn from them',
    code: `${LAYER_CODE}fine.ts`,
    files: null,
    per: 'all',
    js: {
      limit: 1_625,
      warn: 1_462,
      measured: 1_354,
      why:
        'Measured 2026-10-24 at 1,354 B: which countries have provinces; the world file’s land borders between ' +
        'one of them and a country without, in a 1° grid; each province’s outer edge less the stretches along ' +
        'such a border; the provinces’ union, chained from the arcs only one of them uses, and the lines between ' +
        'them; the other countries’ 1:110m rings; each with its box, so a country out of view is left out whole. ' +
        'A line of its own so mount, which every visit pays, carries none of it, and it fetches nothing.'
    },
    data: null
  },
  /*
   * Hazards over any layer: three public feeds' whole-world lists, asked when its box is ticked and at
   * most every 10 minutes after while the map is on screen [src/lib/outside.ts]. Nothing is fetched
   * from navcom.app for it, so it has no data line; what it asks of the feeds is `remote`, measured from
   * the feeds on 2026-10-19, one GET each from a laptop on a home connection.
   */
  hazards: {
    when: 'turning Hazards on, and every 10 minutes after while the map is on screen',
    code: `${LAYER_CODE}hazards.ts`,
    files: null,
    per: 'all',
    js: {
      limit: 8_152,
      warn: 7_338,
      measured: 6_794,
      why:
        'Re-derived 2026-10-24 at 6,794 B, from 6,341 B: further out, cells one kind each and 24 px wide, a ' +
        'count on a pill of the ground left out where it would overlap, a floods’ and droughts’ point dashed and ' +
        'said to be an area’s centre, all three feeds alike said once, and where its marks are, so no name ' +
        'is put over one. ' +
        'Re-derived 2026-10-19 at 6,341 B, from 5,827 B the same day: reading three feeds’ answers in the ' +
        'shapes measured that day, each source’s words kept as given and only https links made links; ' +
        'asking at most every 10 minutes, never while the page is hidden, and nothing left running once it ' +
        'stops; six kinds by shape and hatching, gathered into cells where they would crowd, and a tap’s ' +
        'hit-test; the key’s ages and not read: unknown. The review’s fixes are the 514 B: each of a feed’s ' +
        'asks read on its own and one past its cap not asked again, a feed that listed entries and could ' +
        'read none of them not read, GDACS’s current flag read whichever way it is sent, kinds looked up by ' +
        'own key only, each source’s time named, and how many a tap left out. With outside.ts, which the ' +
        'layers screens and the missions entry share.'
    },
    data: null,
    remote: {
      measured: 195_831,
      limit: 234_997,
      warn: 211_497,
      why:
        'Measured 2026-10-19 at 195,831 B on the wire a round, in a quiet month for fires: GDACS 124,555 B ' +
        '(64%), EONET 68,428 B and USGS 2,848 B, one GET of each URL asked, from a laptop on a home ' +
        'connection. EONET’s two asks were first derived from one GET of its whole open list, 4,878,035 B ' +
        'sent uncompressed although gzip was asked for, about 49 s at the device floor’s 0.8 Mbps and never ' +
        'asked; then each was fetched as written, and came back as derived: 39 volcanoes and storms, both ' +
        'categories, in 47,097 B, and the 31 wildfires dated in the last 30 days in 21,331 B, both sent ' +
        'uncompressed and labelled application/rss+xml although they are JSON. About 1.96 s a round at ' +
        '0.8 Mbps, in the background, and about 1.17 MB an hour with Hazards on and the map on screen. The ' +
        'NWS, asked from a mission’s screen and never by Hazards, measured 2,819 B on the wire for ' +
        'California, 13,941 B decoded.',
      feeds: [
        { url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson', wire: 2_636, decoded: 17_733, encoding: 'gzip', how: 'measured: one GET' },
        { url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_day.geojson', wire: 212, decoded: 257, encoding: 'gzip', how: 'measured: one GET' },
        { url: 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=volcanoes,severeStorms', wire: 47_097, decoded: 47_097, encoding: 'none', how: 'measured: one GET' },
        { url: 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=wildfires&days=30', wire: 21_331, decoded: 21_331, encoding: 'none', how: 'measured: one GET' },
        { url: 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH', wire: 124_555, decoded: 124_555, encoding: 'none', how: 'measured: one GET' }
      ],
      // Decoded bytes, past which the phone drops an answer and the feed reads not read: unknown.
      caps: { usgs: 1024 * 1024, eonet: 512 * 1024, gdacs: 512 * 1024, nws: 4 * 1024 * 1024 },
      peak: {
        bytes: 698_788,
        swings: 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=wildfires&days=30',
        why:
          'Derived 2026-10-19 from the measured whole open list: the busiest 30 days of the fires still open ' +
          'in it ended 15 August 2024, with 1,340 of them, about 922 kB at 688 B a fire, and fires closed ' +
          'since would have made it more; March 2026 held 379, about 261 kB. Past EONET’s 512 KiB cap the ' +
          'answer is read that far and dropped, so a round is then at most 698,788 B, about 7 s at 0.8 Mbps, ' +
          'and the wildfires are not asked again on that page. The cap is held below that peak on purpose ' +
          '[outside.ts CAPS].'
      }
    }
  },
  /*
   * Com's mission screens: the list, a mission, taking part, a report, settling and witnessing. Not a
   * layer, a Com entry, named here so its code is charged to a line of its own and not to Deferred, as
   * the layers' screens are [COM_ENTRIES]. Until 2026-10-27 they were most of Deferred, which held
   * them, the mount tier and everything else at once, at 68.9 kB of 69 kB.
   */
  missions: {
    when: 'opening a mission, or the list of them',
    code: 'src/lib/components/missions/index.ts',
    files: null,
    per: 'all',
    js: {
      limit: 47_205,
      warn: 42_485,
      measured: 39_338,
      why:
        'Derived 2026-10-27 at 39,338 B, at 77536253, when the mission screens left Deferred for a line ' +
        'of their own: Deferred was at 68.9 kB of 69 kB, with 63 B left, and the screens were 27.9 kB of ' +
        'it that nothing else loads. Taken out, Deferred measured 41,967 B and was derived again from ' +
        'that, downward, so nothing grew room by the move. This line counts every chunk the screens ' +
        'reach beyond first paint and mount, the 10.5 kB they share with other screens included, which ' +
        'Deferred also counts, once.'
    },
    data: null
  },
  /*
   * Profiles, your own, and Find [groups.md §13, phase 1]: the people entry, which opening a mission
   * never loads. Its ceiling is derived from its own measurement before its first screen merges, as
   * groups.md asks, with the headroom every line here gets.
   */
  people: {
    when: 'opening a profile, what others see of you, or Find',
    code: 'src/lib/components/people/index.ts',
    files: null,
    per: 'all',
    js: {
      limit: 45_844,
      warn: 41_259,
      measured: 38_203,
      why:
        'Derived 2026-10-29 at 38,203 B, from the entry\u2019s first build, before its first screen merged, ' +
        'as groups.md §13 asks. groups.md estimated 3 to 8 kB of its own code, with the shared chunks ' +
        'already loaded by missions; they are not. Its own screens are about 6 kB, and most of the rest ' +
        'is what *Write to them* seals an invite with: ML-KEM, 8 kB, and the relay pool and card code ' +
        'it shares with the terminal. Measured first at 55,057 B: core imported NIP-44 from ' +
        'nostr-tools\u2019 whole index, which also cost every terminal page 16.7 kB, and now imports ' +
        'it from its own path. About 0.4 s on first open at the device floor, then cached.'
    },
    data: null
  }
};

/*
 * The ceiling 11.3 owed [build-order, Milestone 11 gates]. Derived, not chosen: measured at 27.7 kB
 * gzipped on 2026-10-06, once the mission list and a mission's page split off to load on first open,
 * with the ~20% headroom every surface here gets. Reachable, not delivered: it caps what the app can
 * pull in later across every page, not what any one visit downloads.
 *
 * **Re-derived the same day, at 37.4 kB measured.** 11.4 finished — claims, reports, settlement,
 * witness and challenge, five screens — and the 11.R/E/X fixes to all of it went in behind them.
 * Com's stack growing here is what the split was for [com.md §6]: it costs a first paint nothing.
 * The ceiling exists so that growth is a decision with a reason written beside it, as this is, and
 * never an accident — so the same ~20% headroom, and the same warning line about 8% above it.
 *
 * **What it counted when it was derived, and no less.** That walk followed `imports` and
 * `dynamicImports` and counted every file they reached, whatever its extension, and followed no
 * chunk's `css` list. On every build so far that has meant scripts alone. The walk follows `css`
 * lists now, and the stylesheets only a `css` list names are printed beside this line and not
 * counted: counting them would tighten the ceiling by 1.6 kB (2026-10-09) without anybody deciding
 * to. A stylesheet reached through `imports` is counted, as it always was, so the change of walker
 * cannot narrow what the ceiling holds either. Folding the rest in is a re-derivation, not a side
 * effect of a refactor.
 *
 * **Re-derived 2026-10-18, at 47.9 kB measured** (49,015 B, from 45,619 B at 1979f85). Mecha Jono's
 * exposed key [interchange spec rev 7]: the registry gate every package passes before it is kept,
 * which loads with the live feed at mount, and the paused sealed choice, the retiring notice and the
 * rows that say what was sealed to the leaked key, on the mission screens. First paint is unchanged
 * to the byte. A second copy of sha256 the gate first pulled in (1.9 kB, for re-checking a pin that
 * ships beside what it pins) was taken out before this was measured; the pin is the build's to check.
 * The same ~20% headroom, and the warning about 8% above the measurement.
 *
 * **The map's layers are not in it, since 2026-10-18** [MAP_LINES]. What only a line's code reaches
 * is that line's, and is counted against its ceilings. A chunk anything else also reaches stays here,
 * and so does anything a line opens later by `import()`. When this was derived no layer existed, so
 * it still holds what it held when it was derived: 56,767 B at 654622b, before and after the change.
 *
 * **Re-derived 2026-10-19, at 57.8 kB measured** (59,155 B, from 56,770 B the day before). Not the
 * layers: their code is on their own lines, 9,826 B of it. What grew is the mount tier, which this line
 * counts too: the map's script went from 50,401 B to 52,574 B. Equal Earth and its inverse, so the whole
 * Earth is drawn at its true areas, Antarctica included (D1); the hooks each layer draws and answers
 * through, so none of a layer's code loads at mount; and the opening view that keeps the Earth clear of
 * the key, the controls and the sheet at half. Every visit pays that, and `MOUNT` holds it there, at
 * 112.7 kB of 129 kB. The rest is the place screen reading a region's own clock. The same ~20% headroom,
 * and the warning 7% above the measurement: 62 kB, the whole kilobyte nearest the usual 8% without
 * passing it.
 *
 * **Re-derived 2026-10-27, downward, at 41.0 kB measured** (41,967 B at 77536253, from 70,593 B).
 * Com's mission screens were 27.9 kB of it that nothing else loads, and they are a line of their own
 * now [MAP_LINES, `missions`], as the layers' screens have been since 2026-10-18; what they share
 * with anything else stays here. It had 63 B left, so the next change to mount, the live feed's
 * reader included, would have failed it whatever it was. Derived down rather than kept at 69 kB, so
 * the move frees no room by itself: 49 kB, the whole kilobyte nearest ~20% without passing it, and
 * the warning at 44 kB, the nearest to 8% without passing it.
 */
export const DEFERRED = { limit: 49 * 1024, warn: 44 * 1024 };

/*
 * What every visit to the root fetches as it mounts, beyond first paint: the mount tier's script —
 * the map, the live feed with core's signature checking, Com's registry [ROOT_MOUNT] — and the
 * map's geometry, `grid/world.json`, which the map asks for the moment it mounts. The device floor
 * pays all of it on every first visit, sheet opened or not.
 *
 * **Derived 2026-10-18, from a measurement**, when a review found it reported and never enforced:
 * the map's chunk had grown 2.2 kB and its geometry 3.0 kB in one change and nothing had said so.
 * Measured with that review's fixes in at **110,132 B: 50,401 B of script and 59,731 B of geometry**
 * (this gzip's default level; the 59.1 kB in map.md is level 9), from 48.6 kB of script before
 * them. The same ~20% headroom every surface here gets, and the warning line about 8% above the
 * measurement. On the coefficients above, first paint's ceiling and this one together come to
 * ~3.5 s to a drawn map on a congested cell, inside the 4 s the terminal's ceiling is derived from.
 */
export const MOUNT = { limit: 129 * 1024, warn: 116 * 1024, geometry: 'grid/world.json' };

/*
 * A ceiling on any single file, because the page budgets above were watching the wrong thing.
 *
 * Every budget in this file models what one reader downloads on one page. They said nothing
 * about a file no page links — and on 2026-10-04 the artifact that threatened the account the
 * site is served from was `directory.json`, a 25 MB export in production that no page has ever
 * referenced and no budget here was measuring. It appeared, grew with the directory, and the
 * only thing that would have noticed was a bill.
 *
 * Raw rather than gzipped, deliberately. A client that omits `Accept-Encoding` pays the
 * uncompressed size, and a hand-rolled consumer routinely does: this export is 16 MB raw and
 * 1.3 MB gzipped, a twelvefold difference that only the raw number makes visible.
 *
 * An artifact over the ceiling is not forbidden. It has to be named here with a reason and a
 * number, so that growing past it is a decision somebody makes rather than a thing that happens.
 */
const ARTIFACT_CEILING = 1024 * 1024;
const NAMED = [
  {
    path: 'directory.json',
    max: 20 * 1024 * 1024,
    why: 'The whole directory as one export. No page links it, robots.txt disallows it, and a bulk consumer is pointed at the CAR instead.'
  },
  {
    path: '_ipfs/navcom-directory.car',
    max: 8 * 1024 * 1024,
    why: 'The content-addressed directory, fetched by whoever pins it. This is the path bulk traffic is supposed to take.'
  },
  {
    path: 'sitemap.xml',
    max: 2 * 1024 * 1024,
    why: 'One line per record. Grows with the directory and is fetched once per crawl.'
  },
  {
    path: 'grid/zsp/index.json',
    max: 1536 * 1024,
    why:
      'Every Sector on Earth at lookup precision, 1.24 MB unpacked and 239 kB compressed, its own map line ' +
      '(zones-lookup). Fetched whole the first time somebody asks which Sector a place is in, so the ' +
      'answer is worked out on the phone and the place is never sent (D7, D10); no page links it.'
  }
];

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** @param {number} n */
const kb = (n) => `${(n / 1024).toFixed(1)} kB`;

/**
 * Every map line's code, as the manifest keys it.
 *
 * @param {Record<string, MapLine>} lines
 * @returns {string[]}
 */
export function lineCodes(lines) {
  return Object.values(lines).flatMap((l) => (l.code ? [l.code] : []));
}

/**
 * Which build was measured. The deploy stamp `vite.config.ts` writes beside the pages, read rather
 * than asked of git: a build is often measured at a later commit than it was made from, and a
 * figure filed under the wrong commit is how a regression gets blamed on the change after it.
 *
 * @param {string} build
 * @returns {{ commit: string | null, dirty: boolean | null, built_at: string | null } | null}
 */
function stampOf(build) {
  try {
    const v = JSON.parse(readFileSync(join(build, 'version.json'), 'utf8'));
    return {
      commit: typeof v.commit === 'string' ? v.commit : null,
      dirty: typeof v.dirty === 'boolean' ? v.dirty : null,
      built_at: typeof v.builtAt === 'string' ? v.builtAt : null
    };
  } catch {
    return null;
  }
}

/**
 * @typedef {{ name: string, html: number, css: number, js: number, total: number, assets: string[] }} Page
 * @typedef {{ js: number, css: number, chunks: number }} Weight
 */

/**
 * Measure a build. Prints as it goes and returns what the gate decided; writes nothing and never
 * exits, so a test can hand it a fixture build and read the report back.
 *
 * Both paths are the caller's. `../budget.mjs` resolves them from where it sits, not from the
 * working directory: run from the repo root, a cwd-relative manifest path finds nothing and the
 * deferred check reports nothing, silently, which is the one way that check must never fail.
 *
 * `lines` is the map's lines, given only by a test that needs ceilings the real ones do not have yet;
 * `comEntries` is Com's entries, given only by a test whose fixture build has its own registry.
 *
 * @param {{ build: string, manifestPath: string, log?: (line: string) => void, lines?: Record<string, MapLine>, comEntries?: Record<string, string> }} options
 */
export function measure({ build, manifestPath, log = console.log, lines = MAP_LINES, comEntries = COM_ENTRIES }) {
  if (!existsSync(build) || !statSync(build).isDirectory()) {
    throw new Error('No build/ directory. Run `npm run build` first.');
  }
  /** Build-root-relative, with forward slashes, as the manifest and the HTML spell paths. */
  const files = walk(build).map((f) => relative(build, f).split('\\').join('/'));
  const at = (/** @type {string} */ f) => join(build, f);

  /** @type {Map<string, number>} */
  const sizes = new Map();
  const gz = (/** @type {string} */ f) => {
    let n = sizes.get(f);
    if (n === undefined) {
      n = gzipSync(readFileSync(at(f))).length;
      sizes.set(f, n);
    }
    return n;
  };
  /** @param {Iterable<string>} set @returns {Weight} */
  const weigh = (set) => {
    const weight = { js: 0, css: 0, chunks: 0 };
    for (const f of set) {
      if (!existsSync(at(f))) continue;
      if (f.endsWith('.js')) {
        weight.js += gz(f);
        weight.chunks += 1;
      } else weight.css += gz(f);
    }
    return weight;
  };
  /**
   * What the deferred ceiling and `root_later` have always counted: every file a walk reached as some
   * chunk's own, whatever its extension, and none that only a `css` list named.
   *
   * @param {import('./closure.mjs').Closure} reach
   * @returns {string[]}
   */
  const counted = (reach) => [...reach.files].filter((f) => !reach.sheets.has(f) && existsSync(at(f)));

  const manifest = readManifest(manifestPath);
  const stale = manifest !== null && isStale(manifest, build);
  /** The graph, when it describes this build. A stale one is reported below, never walked. */
  const graph = stale ? null : manifest;

  /** @type {Set<string>} */
  const referenced = new Set();
  /** @type {Map<string, string[]>} */
  const loads = new Map();

  /** @type {Page[]} */
  const pages = files
    .filter((f) => f.endsWith('.html'))
    .map((name) => {
      const refs = htmlRefs(readFileSync(at(name), 'utf8'), name).filter((f) => existsSync(at(f)));
      const signature = refs.join('\n');
      let assets = loads.get(signature);
      if (!assets) {
        assets = [...firstPaint(graph, refs)].filter((f) => existsSync(at(f)));
        loads.set(signature, assets);
      }
      assets.forEach((a) => referenced.add(a));
      referenced.add(name);

      let js = 0;
      let css = 0;
      for (const a of assets) {
        if (a.endsWith('.js')) js += gz(a);
        else css += gz(a);
      }
      const html = gz(name);
      return { name, html, css, js, total: html + css + js, assets };
    });

  pages.sort((a, b) => b.total - a.total);

  let failed = false;

  /*
   * What the gate measured, written where the health file reads it [well-known.mjs]. For six weeks
   * nothing wrote this, and `/.well-known/navcom-health.json` published `budget: null` on every
   * deploy: the reader existed, the writer did not, and no test joined them.
   *
   * Fields are only ever added. The health file publishes this whole object, and a reader keyed
   * on `worst_page` must go on finding what it found there.
   */
  /** @type {Record<string, any>} */
  const report = { unit: 'bytes, gzipped', surfaces: {}, deferred: null, passed: false };
  report.build = stampOf(build);

  for (const [key, surface] of Object.entries(SURFACES)) {
    const own = pages.filter((p) => surface.match(p.name));
    if (own.length === 0) continue;

    log(`${surface.label} — ${own.length} page(s), gzipped\n`);
    log(`  ${'HTML'.padStart(9)} ${'CSS'.padStart(9)} ${'JS'.padStart(9)} ${'TOTAL'.padStart(9)}  page`);
    for (const p of own.slice(0, 6)) {
      log(
        `  ${kb(p.html).padStart(9)} ${kb(p.css).padStart(9)} ${kb(p.js).padStart(9)} ${kb(p.total).padStart(9)}  ${p.name}`
      );
    }
    if (own.length > 6) log(`  ${`+${own.length - 6} smaller`.padStart(41)}`);

    /*
     * Two worst pages, because they are different pages. The table above is sorted by total, and
     * `terminal/find` tops it on an HTML index it embeds; Status loads 30 kB more script. With one
     * name beside both figures, `.budget.json` and the health file sent anybody trimming toward
     * the script line to the wrong screen.
     *
     * Null when no page carries any script. A tie at zero would otherwise name whichever page has
     * the largest total, and the public site has eleven thousand of those: a name beside 0 B is a
     * page somebody goes looking at for script it does not have.
     */
    const worstJsPage = own.reduce((a, b) => (b.js > a.js ? b : a));
    const worstJs = worstJsPage.js;
    const worstJsName = worstJs > 0 ? worstJsPage.name : null;
    const worst = own[0];
    report.surfaces[key] = {
      pages: own.length,
      js: worstJs,
      js_budget: surface.js,
      page: worst.total,
      page_budget: surface.page,
      worst_page: worst.name,
      worst_js_page: worstJsName
    };

    log('');
    if (surface.js > 0) {
      // The number that matters, in the unit the budget was derived from. A size means
      // nothing on its own; seconds-to-usable is what somebody standing outside experiences.
      const cold = (COLD_FIXED_MS + (worstJs / 1024) * COLD_MS_PER_KB) / 1000;
      log(`  cold first load on a congested cell (0.8 Mbps, cheap phone): ~${cold.toFixed(1)}s to interactive`);
      log('  repeat visits and offline are ~0.3s regardless — this governs a first install.\n');
    }
    for (const [label, actual, budget, note] of /** @type {const} */ ([
      ['JavaScript', worstJs, surface.js, worstJsName ?? 'no page carries any'],
      ['Page total', worst.total, surface.page, worst.name]
    ])) {
      const ok = actual <= budget;
      if (!ok) failed = true;
      const pct = budget === 0 ? (actual === 0 ? 0 : Infinity) : Math.round((actual / budget) * 100);
      const warned = label === 'JavaScript' && ok && surface.warn > 0 && actual > surface.warn;
      log(
        `  ${!ok ? 'FAIL' : warned ? 'WARN' : 'PASS'}  ${label.padEnd(11)} ${kb(actual).padStart(9)} / ${kb(budget).padStart(9)}` +
          `  (${pct === Infinity ? 'over' : pct + '%'})  ${note}`
      );
      if (warned) {
        log(
          `        past the ${kb(surface.warn)} ratchet. Not a failure — but the next addition is a` +
            `\n        decision, not an accident. Re-derive the limit or take something out.`
        );
      }
    }
    log('');
  }

  /*
   * Everything the app can reach by dynamic import, minus whatever some page already loads at first
   * paint, and only what exists on disk.
   *
   * Enforced since 2026-10-06, when Com's stack first split [build-order 11.3]. It was reported for
   * a while first on purpose: every budget in this file was **derived from a measurement** rather
   * than chosen to fit, and the measurement did not exist until something loaded later.
   */
  /**
   * @type {null | { stale: true } | {
   *   stale: false, files: Set<string>, count: number, bytes: number, css: number,
   *   worst: { f: string, bytes: number } | null
   * }}
   */
  let deferred = null;
  if (stale) deferred = { stale: true };
  else if (graph) {
    const reach = closure(graph, entries(graph));
    const later = (/** @type {string} */ f) => !referenced.has(f) && existsSync(at(f));
    /*
     * A map line's own, which its line counts and this one does not [MAP_LINES]: what a line's code
     * reaches statically and nothing else reaches at all. What a line opens later by `import()` is
     * not its own, so it stays here.
     */
    const codes = lineCodes(lines).filter((k) => Object.hasOwn(graph, k));
    const others = codes.length > 0 ? closure(graph, entries(graph), codes).files : reach.files;
    const owned = new Set(codes.flatMap((k) => [...closure(graph, [k], [], { dynamic: false }).files]));
    const shared = (/** @type {string} */ f) => later(f) && !(owned.has(f) && !others.has(f));
    // The enforced figure, counted as it was derived [DEFERRED]; the stylesheets beside it, reported.
    const sized = counted(reach)
      .filter(shared)
      .map((f) => ({ f, bytes: gz(f) }))
      .sort((a, b) => b.bytes - a.bytes);
    const sheets = [...reach.sheets].filter(shared);
    deferred = {
      stale: false,
      files: new Set([...reach.files].filter(later)),
      count: sized.length,
      bytes: sized.reduce((n, x) => n + x.bytes, 0),
      css: sheets.reduce((n, f) => n + gz(f), 0),
      worst: sized[0] ?? null
    };
  }

  if (deferred?.stale) {
    log(
      `\n  note  the Vite manifest does not match this build, so dynamic-import weight` +
        `\n        could not be measured. Re-run the build.`
    );
  } else if (deferred && deferred.count > 0) {
    /*
     * Named, because the point of this note is the one chunk nobody knew about.
     *
     * On 2026-10-06 that was `docs` at 332.9 kB gzipped — more than twice the worst measured page,
     * sitting in the category the previous note called "not delivered to anyone". Whether a client-side
     * navigation ever actually pulls it is not something this script can prove, which is exactly why it
     * reports reachability and stops short of claiming delivery. `directory.json` was the same shape:
     * an artifact no budget was watching, found only once somebody went looking.
     */
    const worst = deferred.worst;
    log(
      `\n  note  ${deferred.count} chunk(s) reachable by dynamic import, ${kb(deferred.bytes)} gzipped,` +
        `\n        and ${kb(deferred.css)} of stylesheets with them — not at first paint, so no page` +
        `\n        figure above measures them.` +
        (worst ? ` Largest: ${worst.f} at ${kb(worst.bytes)}.` : '')
    );
  }

  if (graph) {
    const root = pages.find((p) => p.name === 'index.html');
    if (root) {
      const { root_later, ...tiers } = rootTiers(graph, root, weigh, (reach) => counted(reach).reduce((n, f) => n + gz(f), 0), lines, comEntries);
      // The figure the health file has always published, counted as it always was.
      report.root_later = { bytes: root_later };
      report.root_tiers = tiers;
      const row = (/** @type {Weight} */ w, /** @type {string} */ name, /** @type {string} */ what) =>
        `  ${kb(w.js).padStart(9)} ${kb(w.css).padStart(9)}  ${name.padEnd(17)} ${what}`;
      log(`\n  Root console by when it loads — first paint, mount and each map layer enforced, each Com entry reported\n`);
      log(`  ${'JS'.padStart(9)} ${'CSS'.padStart(9)}`);
      log(row(tiers.first_paint, 'first paint', 'the root budget above'));
      log(row(tiers.mount, 'mount', `every visit, as the page mounts, sheet opened or not (${tiers.mount.chunks} chunk(s))`));
      for (const [name, w] of Object.entries(tiers.entries)) {
        log(row(w, `entry: ${name}`, `on first opening it, beyond first paint and mount (${w.chunks} chunk(s))`));
      }
      for (const [name, w] of Object.entries(tiers.lines)) {
        log(row(w, `map: ${name}`, `on ${lines[name]?.when ?? 'choosing it'}, beyond first paint and mount (${w.chunks} chunk(s))`));
      }
      if (tiers.framework.chunks > 0) log(row(tiers.framework, 'framework', 'SvelteKit\'s own, such as its error page: only when something fails'));
      for (const [key, w] of Object.entries(tiers.unclassified)) {
        log(row(w, 'unclassified', `${key}: name it in ROOT_MOUNT or COM_ENTRIES (scripts/lib/budget.mjs)`));
      }
      log(row(tiers.later, 'later, all', 'mount and every entry, shared chunks once (was "Root, later")'));
      for (const key of tiers.undeclared) {
        log(`        ${key} is declared in scripts/lib/budget.mjs and no longer imported by the root page.`);
      }
    }
  }

  if (report.root_tiers) {
    // Missing geometry is a build without a map, and counts as nothing rather than failing here:
    // the map's own tests are what fail on that.
    const geometry = files.includes(MOUNT.geometry) ? gz(MOUNT.geometry) : 0;
    const js = report.root_tiers.mount.js;
    const bytes = js + geometry;
    report.mount = { bytes, js, geometry, limit: MOUNT.limit };
    const ok = bytes <= MOUNT.limit;
    if (!ok) failed = true;
    const warned = ok && bytes > MOUNT.warn;
    log(
      `\n  ${!ok ? 'FAIL' : warned ? 'WARN' : 'PASS'}  ${'Mount'.padEnd(11)} ${kb(bytes).padStart(9)} / ${kb(MOUNT.limit).padStart(9)}` +
        `  (${Math.round((bytes / MOUNT.limit) * 100)}%)  every visit, as the root mounts: ${kb(js)} of script` +
        `\n        and ${kb(geometry)} of the map's geometry (${MOUNT.geometry}).`
    );
  }

  /*
   * The map's lines [MAP_LINES]: each layer's code and data, each against a ceiling of its own, and
   * each failing the build rather than waiting to be measured.
   */
  {
    report.lines = {};
    const lineOf = new Map(Object.entries(lines).flatMap(([name, l]) => (l.code ? [[l.code, name]] : [])));
    /** Chunks that import a line's code statically: it arrives with them, not when somebody chooses it. */
    /** @type {Map<string, string[]>} */
    const statics = new Map();
    for (const [key, entry] of Object.entries(graph ?? {})) {
      for (const dep of entry.imports ?? []) {
        const name = lineOf.get(dep);
        if (name !== undefined) statics.set(name, [...(statics.get(name) ?? []), key]);
      }
    }
    const strays = Object.keys(graph ?? {}).filter((k) => k.startsWith(LAYER_CODE) && !lineOf.has(k));
    const early = /** @type {Record<string, string>} */ (report.root_tiers?.lines_loaded_early ?? {});
    const measuredLines = /** @type {Record<string, Weight>} */ (report.root_tiers?.lines ?? {});
    const status = (/** @type {boolean} */ over, /** @type {boolean} */ warned) => (over ? 'FAIL' : warned ? 'WARN' : 'PASS');

    log(`\n  Map layers, each a line of its own: loaded when somebody chooses it, and never counted in Deferred\n`);
    for (const [name, line] of Object.entries(lines)) {
      const code = line.code !== null ? measuredLines[name] ?? null : null;
      const sized = (line.files ? files.filter(line.files) : []).map((f) => ({ f, bytes: gz(f) })).sort((a, b) => b.bytes - a.bytes);
      const fetched = line.per === 'each' ? sized.slice(0, 1) : sized;
      const data = fetched.length > 0 ? fetched.reduce((n, x) => n + x.bytes, 0) : null;
      report.lines[name] = {
        js: code?.js ?? null,
        js_limit: line.js?.limit ?? null,
        data,
        data_limit: line.data?.limit ?? null,
        files: fetched.map((x) => x.f),
        ...(line.remote ? { remote: { measured: line.remote.measured, limit: line.remote.limit } } : {})
      };

      const label = (/** @type {string} */ part) => `${name} ${part}`.padEnd(22);
      const check = (/** @type {string} */ part, /** @type {number | null} */ actual, /** @type {Ceiling | null} */ ceiling, /** @type {string} */ what) => {
        if (actual === null) return false;
        if (ceiling === null) {
          failed = true;
          log(
            `  FAIL  ${label(part)} ${kb(actual).padStart(9)} arrived with no ceiling  ${what}` +
              `\n        Derive one from this measurement, with the reason beside it, in MAP_LINES` +
              `\n        (scripts/lib/budget.mjs): measured ${actual} B, so a limit near ${Math.floor(actual * 1.2)} B and a warning` +
              `\n        near ${Math.round(actual * 1.08)} B.`
          );
          return true;
        }
        const over = actual > ceiling.limit;
        if (over) failed = true;
        log(
          `  ${status(over, actual > ceiling.warn)}  ${label(part)} ${kb(actual).padStart(9)} / ${kb(ceiling.limit).padStart(9)}` +
            `  (${Math.round((actual / ceiling.limit) * 100)}%)  ${what}`
        );
        return true;
      };
      const shown = [
        check('code', code?.js ?? null, line.js, `on ${line.when}, beyond first paint and mount`),
        check('data', data, line.data, `on ${line.when}: ${fetched.map((x) => x.f).join(', ')}${line.per === 'each' ? `, the largest of ${sized.length}` : ''}`)
      ];
      if (line.remote) {
        // Not this build's to enforce: measured from the hosts, and held on the phone by outside.ts's caps.
        const r = line.remote;
        log(
          `  ----  ${label('remote')} ${kb(r.measured).padStart(9)} / ${kb(r.limit).padStart(9)}  a round, from ${r.feeds.length} URL(s) outside navcom.app:` +
            ` measured from the live feeds, enforced on the phone by outside.ts CAPS, not by this build`
        );
        if (r.peak) {
          log(`  ----  ${label('remote peak')} ${kb(r.peak.bytes).padStart(9)}              a round when ${r.peak.swings} passes its cap, as in a busy season`);
        }
      }
      if (early[name]) {
        failed = true;
        log(`  FAIL  ${label('code')} loads at ${early[name]}, on every visit, before anybody chose it.`);
      }
      if (statics.has(name)) {
        failed = true;
        log(`  FAIL  ${label('code')} is imported statically by ${statics.get(name)?.join(', ')}, so it arrives with that and not when chosen.`);
      }
      if (!shown.some(Boolean) && !early[name] && !statics.has(name)) log(`  ----  ${label('')} not in this build  (${line.when})`);
    }
    for (const key of strays) {
      failed = true;
      log(`  FAIL  ${key} is a map layer's code with no line of its own. Declare it in MAP_LINES (scripts/lib/budget.mjs).`);
    }
  }

  if (deferred && !deferred.stale) {
    const { bytes, css } = deferred;
    report.deferred = { bytes, limit: DEFERRED.limit, css };
    const ok = bytes <= DEFERRED.limit;
    if (!ok) failed = true;
    const warned = ok && bytes > DEFERRED.warn;
    log(
      `\n  ${!ok ? 'FAIL' : warned ? 'WARN' : 'PASS'}  ${'Deferred'.padEnd(11)} ${kb(bytes).padStart(9)} / ${kb(DEFERRED.limit).padStart(9)}` +
        `  (${Math.round((bytes / DEFERRED.limit) * 100)}%)  loaded later, by dynamic import: every file an` +
        `\n        import reaches, as derived, less what only a map line's code reaches (its line counts that).` +
        `\n        ${kb(css)} of stylesheets only a css list names is reported, not counted.`
    );
  }

  /*
   * Emitted and reachable by nothing at all. Harmless to a reader, but worth seeing: if it starts
   * growing, something has begun shipping client code.
   *
   * Excludes the dynamically-reachable set above, stylesheets included, so the claim it makes stays
   * true. Until the walk followed `css`, the map's stylesheet and the mission screens' were listed
   * here as delivered to nobody.
   */
  const dead = files.filter(
    (f) => !referenced.has(f) && !f.endsWith('.txt') && !(deferred && !deferred.stale && deferred.files.has(f))
  );
  if (dead.length) {
    const deadBytes = dead.reduce((n, f) => n + gz(f), 0);
    log(
      `\n  note  ${dead.length} unreferenced file(s), ${kb(deadBytes)} gzipped — emitted by the` +
        `\n        client build, reachable from no page at all. Not delivered to anyone.`
    );
  }

  const publicJs = Math.max(0, ...pages.filter((p) => SURFACES.public.match(p.name)).map((p) => p.js));
  if (publicJs === 0) {
    log('\n  Zero JavaScript on the public site. Every page there works with scripting disabled.');
  }

  const over = [];
  for (const name of files) {
    const bytes = statSync(at(name)).size;
    const named = NAMED.find((n) => n.path === name);
    const limit = named ? named.max : ARTIFACT_CEILING;
    if (bytes > limit) over.push({ name, bytes, limit, named: Boolean(named) });
  }

  if (over.length) {
    failed = true;
    log('\n  ARTIFACT CEILING');
    for (const o of over) {
      log(
        `  FAIL  ${o.name}  ${kb(o.bytes)} raw, over ${kb(o.limit)}` +
          (o.named
            ? ' — it has a budget here and has outgrown it. Decide, then raise it.'
            : ' — no page links it and nothing here allows it. Name it in NAMED with a reason, or do not ship it.')
      );
    }
  } else {
    const biggest = NAMED.map((n) => (files.includes(n.path) ? `${n.path} ${kb(statSync(at(n.path)).size)}` : null)).filter(
      Boolean
    );
    if (biggest.length) log(`\n  PASS  Artifacts    ${biggest.join(' · ')}`);
  }

  report.passed = !failed;
  return { report, failed };
}

/**
 * The root's tiers, from the root page's first-paint files.
 *
 * Seeds are every dynamic import some first-paint chunk makes, less the router's other pages and
 * less anything first paint already loaded. Mount is the declared seeds' static closure. Every other
 * seed, and every `import()` found inside mount or inside another seed, however deep, is walked
 * statically on its own and filed by `COM_ENTRIES`, as SvelteKit's, or as unclassified: no tier is
 * charged for what it only opens later. Each excludes what first paint and mount loaded, so a shared
 * chunk is charged once to those. Declared keys the page no longer imports are returned too, so a
 * stale declaration says so.
 *
 * `root_later` is the one figure walked the old way, every chunk reachable at all, shared chunks
 * once, counted by `count` the way the health file has always published it.
 *
 * A map line's code is filed under its line, ahead of `COM_ENTRIES`, wherever the walk finds it. A
 * line whose code is in the build but which the landing page never opens is still weighed, the same
 * way, so that no line's code goes unmeasured. A line whose code loads at first paint or mount is not
 * weighed. It is named in `lines_loaded_early`, which fails the build [MAP_LINES].
 *
 * @param {import('./closure.mjs').Manifest} manifest
 * @param {Page} root
 * @param {(files: Iterable<string>) => Weight} weigh
 * @param {(reach: import('./closure.mjs').Closure) => number} count
 * @param {Record<string, MapLine>} [lines]
 * @param {Record<string, string>} [entries]
 */
export function rootTiers(manifest, root, weigh, count, lines = MAP_LINES, entries = COM_ENTRIES) {
  const paint = root.assets;
  const painted = new Set(paint);
  const nodes = routeNodes(manifest);
  /**
   * What `keys` load by `import()`: never the router's pages, never what `has` says is loaded.
   *
   * @param {Iterable<string>} keys
   * @param {(key: string) => boolean} has
   */
  const imported = (keys, has) => {
    /** @type {string[]} */
    const out = [];
    for (const key of keys) {
      for (const dep of manifest[key]?.dynamicImports ?? []) {
        if (!nodes.includes(dep) && manifest[dep] && !has(dep)) out.push(dep);
      }
    }
    return out;
  };
  const paintKeys = /** @type {string[]} */ (paint.map((f) => keyOf(manifest, f)).filter((k) => k !== null));
  // Imported later, but already loaded: a chunk first paint fetched costs the import nothing.
  const seeds = new Set(imported(paintKeys, (dep) => painted.has(manifest[dep].file)));

  const mountKeys = ROOT_MOUNT.filter((k) => seeds.has(k));
  const mount = closure(manifest, mountKeys, [...paint, ...nodes], { dynamic: false });
  const before = [...paint, ...mount.files, ...nodes];

  /** @type {Map<string, import('./closure.mjs').Closure>} */
  const lazy = new Map();
  const queue = [...seeds].filter((k) => !mountKeys.includes(k));
  queue.push(...imported(mount.keys, (dep) => mount.keys.has(dep) || painted.has(manifest[dep].file)));
  while (queue.length > 0) {
    const key = /** @type {string} */ (queue.shift());
    if (lazy.has(key) || mount.keys.has(key)) continue;
    const reach = closure(manifest, [key], before, { dynamic: false });
    lazy.set(key, reach);
    queue.push(...imported(reach.keys, (dep) => reach.keys.has(dep)));
  }

  const entryOf = new Map(Object.entries(entries).map(([name, key]) => [key, name]));
  const lineOf = new Map(Object.entries(lines).flatMap(([name, l]) => (l.code ? [[l.code, name]] : [])));
  /** @type {Record<string, Weight>} */
  const lineWeights = {};
  /** @type {Record<string, string>} */
  const early = {};
  for (const [key, name] of lineOf) {
    if (!manifest[key]) continue;
    if (painted.has(manifest[key].file)) early[name] = 'first paint';
    else if (mount.keys.has(key)) early[name] = 'mount';
  }
  /** @type {Record<string, Weight>} */
  const entryWeights = {};
  /*
   * SvelteKit's own, such as the error page it falls back to: loaded when something fails, not by
   * anything the page decided. Counted in `later`, as it always was, and named apart so that it is
   * not mistaken for a screen nobody declared.
   */
  /** @type {string[]} */
  const framework = [];
  /** @type {Record<string, Weight>} */
  const unclassified = {};
  for (const [key, reach] of lazy) {
    const line = lineOf.get(key);
    const name = entryOf.get(key);
    if (line !== undefined) lineWeights[line] = weigh(reach.files);
    else if (name !== undefined) entryWeights[name] = weigh(reach.files);
    else if (key.startsWith('.svelte-kit/')) framework.push(key);
    // An import of something first paint or mount already loaded costs nothing and is not a tier.
    else if (reach.files.size > 0) unclassified[key] = weigh(reach.files);
  }
  // A line's code in the build that the landing page never opens, a terminal page's say: still its line's.
  for (const [key, line] of lineOf) {
    if (manifest[key] && !(line in lineWeights) && !(line in early)) {
      lineWeights[line] = weigh(closure(manifest, [key], before, { dynamic: false }).files);
    }
  }
  const all = closure(manifest, seeds, [...paint, ...nodes]);

  return {
    first_paint: { js: root.js, css: root.css, chunks: paint.filter((f) => f.endsWith('.js')).length },
    mount: weigh(mount.files),
    entries: entryWeights,
    lines: lineWeights,
    lines_loaded_early: early,
    framework: weigh(closure(manifest, framework, before, { dynamic: false }).files),
    unclassified,
    later: weigh(all.files),
    undeclared: [...ROOT_MOUNT.filter((k) => !seeds.has(k)), ...[...entryOf.keys()].filter((k) => !lazy.has(k))],
    root_later: count(all)
  };
}
