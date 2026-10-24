<script lang="ts">
  /**
   * The grid: the map NavCom draws itself. [docs/design/map.md]
   *
   * Outlines we own, on a canvas, with no third-party request until somebody chooses Hazards, and
   * then only three public feeds' whole-world lists [$lib/outside] — looking at the map tells nobody
   * anything about where anybody looked. Street-level detail is somebody else's app, reached by
   * handing off a pin, never by loading their tiles here.
   *
   * Sits inside `.terminal`, whose tokens it draws with — only `--t-ground` is global. It takes
   * the neutrals and never a hue, because every hue on these screens is a watch state. The land, its
   * lines and its coast have tokens of their own (`--map-*`, below), lifted far enough off the sea to
   * read on a cheap screen in sunlight: the panel's own line tokens are 1.1 to 1.7:1 there.
   *
   * **Every shape and point is a door** [map.md §6]. A hover names what is under the pointer and
   * what is open there; a tap opens it in Com, and what it took stays lifted while that place is
   * open, because a finger has no hover; the keyboard gets the same through a reticle at the centre
   * of what nothing covers. What is under a point is `$lib/grid/pick`, shared by all three. **A shape
   * the finger is inside wins**: a point takes a tap there only within its drawn size and a little air.
   *
   * **Points are places on record, and nothing else** [invariant 1]. The map takes no coordinates:
   * it draws the rings of verified missions and, with Places on, the directory's own regions and
   * records, each made by `$lib/grid/places`, which is the only module that can make one. **The circle
   * is the missions' alone**: a thick ink ring on a casing of the ground, drawn last so nothing covers
   * one, with a centre only at its least size, where it is a symbol; the directory's places are squares.
   *
   * **One layer at a time** [map.md, Layers]: Nation States, which is what the map always drew;
   * Starcom's Zones, in three neutral weights, container heaviest; Time zones, as alternating lifts;
   * or none. The coast is drawn under every one of them. The choice is `$lib/grid/layer.svelte`, made
   * in Com's layers screen, and each layer's code and files arrive by `import()` only once it is chosen
   * [budget.mjs MAP_LINES]. A layer's areas answer a tap and a hover the way a country does under
   * Nation States; points answer first in all. Over a layer, overlays: day and night, worked out on the
   * phone; the directory's regions by when they were last checked; open missions counted by Zone; and
   * Hazards, three public feeds' events, the one overlay whose marks answer a tap, after the points and
   * before a lit shape. Each is a module of its own, loaded the same way, and says in the key what it is
   * and how old, in one short line, the rest of its words on the layers screen.
   *
   * **The key is the page's, and the map's lines go in it** [cover]: one panel, on the ground, which
   * gestures pass through to the map. On a phone its lines are cut to what leaves the Earth room above
   * the sheet at half, so a taller key never shrinks the Earth, but never shorter than the line of what
   * ages fastest, whole [room].
   *
   * Built for the device floor, a prepaid Android 8. Each layer becomes one `Path2D` in map units
   * when the file loads, and the picture drawn in map units is kept on a canvas of its own: a pan or a
   * pinch moves that picture and draws only the points over it, and the picture is drawn again when the
   * gesture ends, or when it has moved too far to stand for the view. Redraws happen on demand, at most
   * once per frame.
   */
  import { onMount, tick } from 'svelte';
  import type { Mission } from '@navcom/core';
  import type { Screen } from '$lib/com/screens';
  import { HEIGHT, METRES_PER_UNIT, coastOf, countryName, decode, edgeOfEarth, filedUnder, inside, lightsOf, unproject, type Ring, type Shape, type Topology } from '$lib/grid/topology';
  import { LIT_SLOP, pick, screenAt, unitAt, type Hit, type View } from '$lib/grid/pick';
  import { daylightDrawn, layerData, loaded, mapKey, mapLayers, type Counted, type DrawnLayer, type Ink, type Overlay, type Swatch } from '$lib/grid/layer.svelte';
  import { FILLED, SWATCH_PATHS } from '$lib/grid/swatches';
  import {
    placesOfDirectory,
    placesOfMissions,
    type PlaceOfRecord,
    type PlacesFile,
    type RegionsFile
  } from '$lib/grid/places';

  let {
    active = [],
    places = false,
    label = 'Map',
    current = null,
    status = $bindable('loading'),
    placesStatus = $bindable('off'),
    missionsAge = null,
    cover,
    onpick
  }: {
    /** The missions open now. Each lights where it is filed: its province, or else its country. */
    active?: readonly Mission[];
    /** Places: the directory's regions, and its records once zoomed in. Fetched the first time it is on. */
    places?: boolean;
    /** What the map shows, for anybody who cannot see the canvas: the layer and what is over it are added. */
    label?: string;
    /** The screen on top of Com, so what a tap took stays lifted while it is the one open. */
    current?: unknown;
    /** Whether the map has drawn, so the page offers Places only once there is a map to draw them on. */
    status?: 'loading' | 'ready' | 'failed';
    /** Whether Places' files arrived, so the map's key can say so when they did not [invariant 7]. */
    placesStatus?: 'off' | 'loading' | 'ready' | 'failed';
    /**
     * How old the missions are, as the key says it (`live`, or `as of …, offline`), or null while they
     * have not been read, which is unknown and never none: what counts them by Zone says so.
     */
    missionsAge?: string | null;
    /**
     * The page's key, over the canvas's top. The map puts its own lines in it, what the chosen layer is,
     * whose and how old [invariant 7; D6, D8], so the key is one panel; and the opening view keeps the
     * Earth out from under it. At the top, because the sheet, which a layer's screens open at half,
     * covers the canvas's foot, where a readout of what is drawn was present and unseen.
     */
    cover?: HTMLElement;
    /**
     * Something on the map was tapped, or chosen by keyboard: the screen that opens it. A shortcut,
     * never the only way in — whatever opens from here is also reachable without the map, by
     * keyboard and screen reader alike.
     */
    onpick?: (screen: Screen) => void;
  } = $props();

  let canvas = $state<HTMLCanvasElement>();
  let insetEl = $state<HTMLElement>();
  let reachEl = $state<HTMLElement>();
  let sheetEl = $state<HTMLElement>();
  let chipEl = $state<HTMLElement>();
  let controlsEl = $state<HTMLElement>();
  let moreEl = $state<HTMLElement>();
  let creditEl = $state<HTMLElement>();

  let land: Path2D | null = null;
  let coast: Path2D | null = null;
  /**
   * From ×2 in, the land at the file's finer scale where it has one, the countries with provinces drawn
   * from their 1:10m provinces rather than their 1:110m outline, with the coast and the borders to match:
   * its code loaded and worked out the first time somebody zooms in that far, never at mount
   * [layers/fine.ts; budget.mjs MAP_LINES.fine]. Until it arrives, and if it does not, the 1:110m.
   */
  let topology: Topology | null = null;
  /** A path and its box in map units, so what is out of view is left out whole rather than walked edge by edge. */
  type Piece = { path: Path2D; box: [number, number, number, number] };
  let fine: { others: Piece[]; outline: Piece[]; land: Path2D; inner: Piece[]; own: Piece[]; coast: Piece[] } | null = null;
  let fineAsked = false;
  function fineLines() {
    if (fine || !topology) return fine;
    if (!fineAsked) {
      fineAsked = true;
      const file = topology;
      import('$lib/grid/layers/fine').then(
        (m) => {
          fine = finer(m.fineOf(file));
          request();
        },
        () => (fineAsked = false)
      );
    }
    return null;
  }
  function finer(f: import('$lib/grid/layers/fine').Fine): NonNullable<typeof fine> {
    const pieces = (list: { rings: Ring[]; box: Piece['box'] }[], closed: boolean): Piece[] => list.map((g) => ({ path: pathOf(g.rings, closed), box: g.box }));
    return {
      // Each of the others' rings, and each ring of the provinces' union, on its own: filled, it is the land.
      others: pieces(f.others, true),
      outline: pieces(f.outline, true),
      // Both, for a layer's lift to be held to: the same land the fills draw.
      land: into(pathOf(f.others.flatMap((g) => g.rings)), f.outline.flatMap((g) => g.rings), true),
      // By country: the lines between provinces, and the provinces' coast.
      inner: pieces(f.inner, false),
      own: pieces(f.own, false),
      coast: pieces(f.coast, false)
    };
  }
  let provinceShapes: Shape[] = [];
  let countryShapes: Shape[] = [];
  /** What the open missions light: filled, and outlined. Rebuilt only when the missions change. */
  let litFill: Path2D | null = null;
  let litLine: Path2D | null = null;
  let litIds = new Set<string>();
  /** Whether anything is lit, for the key's row: a mission filed under a place lights it [swatches]. */
  let lit = $state(false);
  /** Only the shapes a mission fills, for a tap under another layer, where they still answer first. */
  let litProvinces: Shape[] = [];
  let litCountries: Shape[] = [];
  /** The shape under the pointer or the reticle, lifted by its outline and never by a hue. */
  let hovered: Hit | null = null;
  let hoverLine: Path2D | null = null;

  /**
   * The chosen layer, once its own code is here: it draws itself and answers for its areas, so the map
   * every visit loads carries none of either [layer.svelte.ts DrawnLayer; budget.mjs MAP_LINES].
   */
  let drawn = $state.raw<DrawnLayer | null>(null);
  /** What a layer has open in Com, lifted while it is, whether a tap or a list opened it. */
  let layerOpen: Path2D | null = null;
  /**
   * What is drawn over the chosen layer, each once its own code is here [layer.svelte.ts Overlay]: day
   * and night, the directory by when it was last checked, and the open missions counted by Zone.
   */
  let sun = $state.raw<Overlay | null>(null);
  let ages = $state.raw<Overlay | null>(null);
  let counts = $state.raw<Overlay | null>(null);
  /** Hazards, over any layer, once somebody ticked it: three public feeds, asked whole-world [$lib/outside]. */
  let hazards = $state.raw<Overlay | null>(null);
  const overlays = (): Overlay[] => [sun, ages, counts, hazards].filter((o): o is Overlay => o !== null);
  /** Names on the map, from ×2 or with Zones or Time zones: their own line, loaded when first wanted [layers/labels.ts]. */
  let names: typeof import('$lib/grid/layers/labels').labels | null = null;
  let namesAsked = false;

  function pathOf(rings: readonly Ring[], closed = true): Path2D {
    return into(new Path2D(), rings, closed);
  }
  function into(p: Path2D, rings: readonly Ring[], closed: boolean): Path2D {
    for (const ring of rings) {
      p.moveTo(ring[0]!, ring[1]!);
      for (let i = 2; i < ring.length; i += 2) p.lineTo(ring[i]!, ring[i + 1]!);
      if (closed) p.closePath();
    }
    return p;
  }

  /**
   * Every mission lands somewhere [lightsOf]. A mission filed under a province lights it where the
   * file has one, and otherwise lights its country, so `ke-30` lights Kenya; a national mission
   * outlines its country, because filling it would light everything. Only what is filled answers a
   * tap ahead of the provinces: an outline would answer for every state inside it.
   *
   * **Except where its ring already says where it is**: a mission at a point, in a province the file
   * does not have, is its ring alone. Filling its country claimed the whole of Canada for a depot in
   * Manitoba, where the ring gave the place and the fill said *somewhere in all of this*.
   */
  function relight() {
    const known = new Set(provinceShapes.map((s) => s.id));
    const placed = new Set(rings.flatMap((r) => (r.kind === 'mission' ? [r.address] : [])));
    const { fill, outline } = lightsOf(
      active.flatMap((m) => {
        const j = m.placement.jurisdiction;
        return j && j.includes('-') && !known.has(j) && placed.has(m.address) ? [] : [j];
      }),
      known
    );
    litProvinces = provinceShapes.filter((s) => s.id !== null && fill.has(s.id));
    litCountries = countryShapes.filter((s) => s.id !== null && fill.has(s.id));
    const filled = [...litProvinces, ...litCountries];
    const lined = [...filled, ...countryShapes.filter((s) => s.id !== null && outline.has(s.id))];
    litFill = filled.length > 0 ? pathOf(filled.flatMap((s) => s.rings)) : null;
    lit = litFill !== null;
    litLine = lined.length > 0 ? pathOf(lined.flatMap((s) => s.rings)) : null;
    litIds = fill;
  }

  /**
   * What the last tap or Enter took, lifted in ink while the screen it opened is the one on top of
   * Com, and again when Back returns to it. Touch has no hover, so without this nothing on the map
   * showed a finger what it had taken, and a thumb-wide tap at the whole-Earth view can take a
   * neighbour [LIT_SLOP].
   */
  let picked: { key: string; line: Path2D | null; place: PlaceOfRecord | null; marks: string | null } | null = null;
  let pickedOn = false;

  /** The directory's places, once fetched: its regions, and its records. */
  let directory = $state.raw<{ regions: PlaceOfRecord[]; records: PlaceOfRecord[] } | null>(null);
  let directoryAsked = false;
  /** Whether only the regions were asked for, for the ages over Nation States, and Places' own file not yet. */
  let regionsAsked = false;
  /**
   * The missions' rings, rebuilt only when what is open changes. The page's clock ticks every minute and
   * hands over a new list each time, the same missions in it, and redrawing for that was a redraw a
   * minute on a phone left open on the map.
   */
  let rings: PlaceOfRecord[] = [];
  let ringsOf = '';
  /** Regions with places the map does not draw: their squares stay where the records take over. */
  const held = $derived(directory?.regions.filter((r) => r.kind === 'region' && (r.unmapped ?? 0) > 0) ?? []);

  // The view: which point of the map's rectangle sits at the centre, and how many CSS px its width spans.
  let cx = 0.5;
  let cy = HEIGHT / 2;
  let scale = 0;
  let width = 0;
  let height = 0;
  let dpr = 1;
  type Box = { l: number; t: number; r: number; b: number };
  /**
   * What lies over the canvas, in CSS px from its top left: the page's key, with the map's own lines in
   * it, and the map's own controls, measured whenever either changes size. The opening view keeps the
   * Earth out from under them; a name, a readout and the reticle stay clear of them.
   */
  let covers: Box[] = [];
  let keyBox: Box | null = null;
  let controlsBox: Box | null = null;
  /** The chosen layer's credit, over the map's foot: the names keep above it. */
  let creditBox: Box | null = null;
  /**
   * CSS px at the canvas's foot the page covers at the height Com opens to for whatever the map opens,
   * the phone's sheet at half, read from `--map-reach`. The opening view keeps the Earth above it, so
   * what a tap lifts, and the layer the picker draws, are in view while their screen is open.
   */
  let reach = 0;
  /** CSS px at the canvas's foot that the page covers — the phone's sheet at peek — read from `--map-inset`. */
  let inset = 0;
  /** CSS px the sheet covers now, at whichever height it is, read from `--map-sheet`: the reticle and the readout stay above it. */
  let sheet = 0;
  /**
   * Up to about 20 m a pixel on a phone at 52°N, so a street's records separate. The outlines are
   * 1:10m at best and look it there; what is drawn that close is the records, at the precision
   * their positions earned, and the doorstep is still the handoff's [map.md §5].
   */
  const MAX_ZOOM = 4096;
  /**
   * From here in, a region's square gives way to its records: about 2.7 km a pixel on a phone, by area,
   * where a region is still many pixels across. A region's centre is a statistic of its records,
   * not a place, and drawn closer in it would sit on one block and read as one (review, 2026-10-18).
   */
  const RECORD_ZOOM = 32;
  /** The Earth's own edge, drawn round it: off it there is nothing, not sea [topology.ts edgeOfEarth]. */
  const earth = edgeOfEarth();
  const edge = typeof Path2D === 'undefined' ? null : pathOf([earth]);

  const view = (): View => ({ cx, cy, scale, width, height });
  /** The foot of the key, in CSS px: the top of what nothing covers. */
  const keyFoot = () => keyBox?.b ?? 0;
  /**
   * Where the keyboard's reticle sits: the centre of the part of the canvas nothing covers, below the
   * key, left of the controls and above the sheet at whatever height it is now. With the peek alone it
   * sat under a tall key, or the sheet at half, and Enter opened what nobody could see.
   */
  const reticle = (): [number, number] => {
    const floor = height - Math.max(inset, sheet);
    const top = keyFoot();
    return [(controlsBox?.l ?? width) / 2, floor - top > 24 ? (top + floor) / 2 : Math.max(0, floor) / 2];
  };

  let queued = false;
  /** Whether something changed since the picture was drawn, rather than only the names being due. */
  let dirty = true;
  function request() {
    dirty = true;
    queue();
  }
  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(draw);
  }

  /*
   * The whole world's width, at the least zoomed-in a person can go.
   *
   * It used to fill the screen's height instead, which on a portrait phone made the world wider
   * than the screen — so the button labelled "Show the whole map" showed a band centred on
   * Greenwich with the Americas cut off. A control that does not keep its label's promise is a
   * defect, so the whole map means the whole map, with empty space above and below it on a tall
   * screen. On a phone too short for the world to clear the map's own controls at the screen's width,
   * it is the width left of them instead, so that the whole map is whole there too [world()].
   */
  let least = 0;
  const fit = () => (least > 0 ? Math.min(width, least) : width);

  /**
   * Within the world. Across, as before: wholly on the canvas while it is narrower than it. **Down, its
   * top may come as far as the key's foot and its bottom up to the sheet at peek**, so whatever is
   * under either can be brought out; while it is shorter than the canvas it also stays wholly on it.
   * It was held to the canvas's own edges, so at ×3 to ×6, where the world is about as tall as the
   * canvas, nothing north of about 30°N could be panned out from under the key (audit, 2026-10-19).
   */
  function clamp() {
    scale = Math.min(Math.max(scale, fit()), fit() * MAX_ZOOM);
    const halfW = width / 2 / scale;
    cx = halfW >= 0.5 ? Math.min(Math.max(cx, 1 - halfW), halfW) : Math.min(Math.max(cx, halfW), 1 - halfW);
    // Where the world's top edge is on screen, and how far each way it may go.
    const tall = HEIGHT * scale;
    const top = Math.max(Math.min(0, height - inset - tall), Math.min(height / 2 - cy * scale, Math.max(height - tall, keyFoot())));
    cy = (height / 2 - top) / scale;
  }

  /** Whether the directory's regions are drawn by when they were last checked: over Nation States, while ticked. */
  const agesOn = $derived(mapLayers.chosen === 'nations' && mapLayers.ages);

  /** Whether the records are drawn, rather than their regions' squares: only with Places on. */
  const close = () => places && !!directory && directory.records.length > 0 && scale >= fit() * RECORD_ZOOM;

  /** The directory's places drawn at this zoom: its regions, or closer in with Places on, its records. */
  function directoryShown(): readonly PlaceOfRecord[] {
    if (!directory || !(places || agesOn)) return [];
    return close() ? directory.records : directory.regions;
  }

  /**
   * Places' regions, where they would crowd: the one with the most places kept, at its own position, and
   * each the others within `CELL` CSS px of it fold into, counted, so no two squares run into each other
   * and each says how many regions it stands for. 1,889 regions in the US were drawn one over another at
   * the whole-Earth view, a solid mass the missions were lost in: the heat map of where somebody once ran
   * a scraper that map.md §6 warned of. **Where the squares kept still tile**, three or more in a square two
   * cells across, they are thinned again `CROWD` px apart: at ×4 the US was a lattice of hollow squares that
   * read as graph paper and hid a lit California (audit, 2026-10-24). Sparse places keep their own.
   */
  const CELL = 10;
  const CROWD = 18;
  let thin: { scale: number; from: unknown; kept: PlaceOfRecord[]; stands: Map<PlaceOfRecord, number> } | null = null;
  /** Each of `list` kept, or folded into one kept before it within `cell` px, which then stands for both. */
  function fold(list: readonly PlaceOfRecord[], cell: number, stands: Map<PlaceOfRecord, number>): PlaceOfRecord[] {
    const kept: PlaceOfRecord[] = [];
    const grid = new Map<number, PlaceOfRecord[]>();
    for (const p of list) {
      const [gx, gy] = [Math.floor((p.x * scale) / cell), Math.floor((p.y * scale) / cell)];
      let near: PlaceOfRecord | undefined;
      for (let d = 0; d < 9 && !near; d++) near = grid.get((gx + (d % 3) - 1) * 1e6 + gy + Math.floor(d / 3) - 1)?.find((o) => Math.hypot(o.x - p.x, o.y - p.y) * scale < cell);
      if (near) {
        stands.set(near, (stands.get(near) ?? 1) + (stands.get(p) ?? 1));
        stands.delete(p);
      } else {
        kept.push(p);
        const k = gx * 1e6 + gy;
        grid.set(k, [...(grid.get(k) ?? []), p]);
      }
    }
    return kept;
  }
  function thinned(): PlaceOfRecord[] {
    if (!directory) return [];
    if (thin?.scale === scale && thin.from === directory) return thin.kept;
    const stands = new Map<PlaceOfRecord, number>();
    const most = (p: PlaceOfRecord) => (p.kind === 'region' ? p.records : 0);
    const first = fold(directory.regions.filter((r) => r.kind === 'region').sort((a, b) => most(b) - most(a)), CELL, stands);
    // Where they tile: three or more kept in a square two cells across, which holds four at most.
    const span = 2 * CELL;
    const at = (p: PlaceOfRecord) => Math.floor((p.x * scale) / span) * 1e6 + Math.floor((p.y * scale) / span);
    const per = new Map<number, number>();
    for (const p of first) per.set(at(p), (per.get(at(p)) ?? 0) + 1);
    const crowd = new Set(first.filter((p) => per.get(at(p))! >= 3));
    const kept = crowd.size === 0 ? first : [...first.filter((p) => !crowd.has(p)), ...fold([...crowd], CROWD, stands)];
    for (const p of kept) if (!stands.has(p)) stands.set(p, 1);
    thin = { scale, from: directory, kept, stands };
    return kept;
  }

  /** What Places draws at this zoom: its regions, thinned, or closer in its records, with the regions that hold some back. */
  function directoryPoints(): readonly PlaceOfRecord[] {
    if (!directory || !places) return [];
    return close() ? [...directory.records, ...held] : thinned();
  }

  /**
   * The points drawn and tappable at this zoom: missions' rings always; with Places on, regions'
   * squares, or closer in the records, with the square of each region that has places the map does not
   * draw, so a region of held-back shelters reads as that and not as nothing [invariant 7]. With the
   * directory's ages on, the regions without Places too.
   */
  function shownPoints(): readonly PlaceOfRecord[] {
    const dir = places ? directoryPoints() : directoryShown();
    return dir.length > 0 ? [...rings, ...dir] : rings;
  }

  /**
   * How small a mission's ring is drawn, in CSS px, and its casing of the ground: 6 px on a 1.5 px casing at
   * the whole Earth, growing to 9 px on 3.25 px by ×2. At 9 px on 6.5 px of casing, three rings covered most
   * of the contiguous US at the opening view, a lit California with them (audit, 2026-10-24); the ring
   * keeps 3:1 by its contrast with the casing, not by its mass.
   */
  const smallest = () => 6 + 3 * Math.min(1, Math.max(0, scale / fit() - 1));
  const casing = () => 1.5 + 1.75 * Math.min(1, Math.max(0, scale / fit() - 1));
  /** A mission's ring on screen: never smaller than `smallest`, nor than what its point's precision covers [METRES_PER_UNIT]. */
  const ringOf = (p: PlaceOfRecord) => (p.kind === 'mission' ? Math.max(smallest(), (p.metres * scale) / METRES_PER_UNIT) : 0);
  /** How large each point is drawn, in CSS px from its centre: what a tap inside a shape must come within. */
  const drawnOf = (p: PlaceOfRecord) => (p.kind === 'mission' ? ringOf(p) : p.kind === 'record' ? 2 : close() ? 7 : 3.5);

  let focused = $state(false);

  /** The neutrals, read once a frame from what the page now says: Low signature changes every one. */
  function inks(): Ink {
    const style = canvas ? getComputedStyle(canvas) : null;
    const t = (name: string, fallback: string) => style?.getPropertyValue(name).trim() || fallback;
    return {
      ink: t('--t-ink', '#F2F5F8'),
      muted: t('--t-muted', '#9BA5B2'),
      faint: t('--t-faint', '#78828F'),
      line: t('--map-line', '#424C59'),
      strong: t('--map-strong', '#5B6673'),
      sunk: t('--t-sunk', '#05070A'),
      ground: t('--t-ground', '#0B0E12'),
      land: t('--map-land', '#272F3B')
    };
  }

  /**
   * The picture drawn in map units, kept on a canvas of its own: the land, the layer, the overlays'
   * areas and lines, the missions' lights, what is lifted, and the names. A gesture moves it rather
   * than draw it again, which on the device floor is most of a frame: the whole canvas rasterised for
   * every step of a pan was 135 to 350 ms under a 6× slower CPU (audit, 2026-10-19).
   */
  let base: HTMLCanvasElement | null = null;
  /** The names, on a canvas of their own: moved with the picture, and drawn over the points, so no square runs through one. */
  let labelled: HTMLCanvasElement | null = null;
  let baseAt = { ox: 0, oy: 0, scale: 1 };
  let namesAt = { ox: 0, oy: 0, scale: 1 };
  /** Whether the names are to be laid out again, the frame after the picture was drawn. */
  let namesDue = false;
  let paintedAt = 0;
  /** Whether a finger, two fingers or the wheel are moving the map right now. */
  let moving = false;
  let still: ReturnType<typeof setTimeout> | null = null;
  /** A gesture moved the map: the picture is moved, and drawn again once the gesture ends. */
  function moved() {
    moving = true;
    if (still) clearTimeout(still);
    // The wheel has no end of its own: still for a moment is its end. A finger's is lifting it.
    still = setTimeout(() => {
      still = null;
      if (pointers.size === 0) settle();
    }, 160);
  }
  /** Whether the gesture that moved the picture has just ended, so the names wait a frame [draw]. */
  let settled = false;
  function settle() {
    if (!moving) return;
    moving = false;
    settled = true;
    request();
  }

  /**
   * During a gesture, whether the picture no longer stands for the view: scaled past what still reads,
   * or moved so far that a third of the canvas the Earth should fill is bare. Then it is drawn again,
   * and at most every 600 ms, since drawing it is the cost the gesture is spared; otherwise a bare
   * edge waits for the gesture to end.
   */
  function stale(ox: number, oy: number): boolean {
    if (performance.now() - paintedAt < 600) return false;
    const k = scale / baseAt.scale;
    if (k > 3 || k < 0.4) return true;
    const l = Math.max(0, ox - baseAt.ox * k);
    const t = Math.max(0, oy - baseAt.oy * k);
    const r = Math.min(width, ox - baseAt.ox * k + width * k);
    const b = Math.min(height, oy - baseAt.oy * k + height * k);
    // The Earth's box on the canvas now, and how much of it the picture still covers.
    const [ex, ey, ex2, ey2] = [Math.max(0, ox), Math.max(0, oy), Math.min(width, ox + scale), Math.min(height, oy + HEIGHT * scale)];
    const earthArea = Math.max(0, ex2 - ex) * Math.max(0, ey2 - ey);
    const kept = Math.max(0, Math.min(r, ex2) - Math.max(l, ex)) * Math.max(0, Math.min(b, ey2) - Math.max(t, ey));
    return earthArea - kept > width * height * 0.3;
  }

  function draw() {
    queued = false;
    const ctx = canvas?.getContext('2d');
    if (!ctx || width === 0) return;
    const tones = inks();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = tones.ground;
    ctx.fillRect(0, 0, width, height);
    if (!land) return;

    const ox = width / 2 - cx * scale;
    const oy = height / 2 - cy * scale;
    // The view, where a browser test can read it to tap a place by its longitude and latitude, and
    // whether a gesture is still moving the picture rather than drawing it.
    canvas!.dataset.view = `${cx} ${cy} ${scale}`;
    canvas!.toggleAttribute('data-moving', moving);
    canvas!.dataset.reticle = reticle().join(' ');
    const v = view();
    const taken = lay(ctx, v);
    /*
     * The picture when something changed and no gesture is moving it, or it no longer stands for the view;
     * the names with it, but **a frame after it when a gesture has just ended**, so that frame is two tasks
     * and not one: drawn together they were one of about 110 ms under a CPU six times slower (audit,
     * 2026-10-24). During a gesture the names move with the picture and are laid out again once it ends.
     */
    if (dirty) {
      dirty = false;
      if (!base || !moving || stale(ox, oy)) {
        paint(tones, ox, oy);
        if (settled) {
          settled = false;
          namesDue = true;
          queue();
        } else if (!moving) drawNames(tones, ox, oy, v, taken);
      }
    } else if (namesDue) {
      namesDue = false;
      drawNames(tones, ox, oy, v, taken);
    }
    // The picture, moved to where the view is now: during a gesture, only moved. The names over the points, moved alike.
    const k = scale / baseAt.scale;
    ctx.setTransform(k, 0, 0, k, dpr * (ox - baseAt.ox * k), dpr * (oy - baseAt.oy * k));
    ctx.drawImage(base!, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    points(ctx, v, tones);
    if (labelled) {
      const n = scale / namesAt.scale;
      ctx.setTransform(n, 0, 0, n, dpr * (ox - namesAt.ox * n), dpr * (oy - namesAt.oy * n));
      ctx.drawImage(labelled, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  /** What each overlay drew a count for, last said on the canvas [data-counts]. */
  let countsSaid = '';
  /**
   * Where every mark over the map goes this frame, each clear of what was placed before it: the missions'
   * rings first, which are drawn over everything, then the sun, which is where the sun is, then the Zones'
   * counts, and Hazards' marks and counts [Overlay place]. Only a ring at its least size, a symbol, takes
   * its box: one drawn at its precision's size is a circle on the ground, and what is inside it is not under
   * it. What comes back is where every name is kept off [layers/labels.ts]. The counts drawn are carried on
   * the canvas, where a browser test can find them, as the view is.
   */
  function lay(ctx: CanvasRenderingContext2D, v: View): Box[] {
    const [small, c] = [smallest(), casing() + 1.25];
    const taken: Box[] = [];
    for (const p of rings) {
      const r = ringOf(p);
      if (r > small + 0.01) continue;
      const [x, y] = screenAt(v, [p.x, p.y]);
      taken.push({ l: x - r - c, t: y - r - c, r: x + r + c, b: y + r + c });
    }
    const drew: Counted[] = [];
    for (const o of [sun, counts, hazards]) if (o?.place) drew.push(...o.place(ctx, v, taken));
    const said = JSON.stringify(drew.map((d) => [d.of, d.n, Math.round(d.x), Math.round(d.y), Math.round(d.box.l), Math.round(d.box.t), Math.round(d.box.r), Math.round(d.box.b)]));
    if (said !== countsSaid) canvas!.dataset.counts = countsSaid = said;
    return taken;
  }

  /** A canvas the size of the map's, cleared. */
  function blank(c: HTMLCanvasElement | null): HTMLCanvasElement {
    c ??= document.createElement('canvas');
    if (c.width !== canvas!.width || c.height !== canvas!.height) [c.width, c.height] = [canvas!.width, canvas!.height];
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    return c;
  }

  /** The picture in map units, on its own canvas, at the view now; the names are `drawNames`'. */
  function paint(tones: Ink, ox: number, oy: number) {
    base = blank(base);
    const ctx = base.getContext('2d')!;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
    const zoom = scale / fit();
    // From ×2 in, the land where the file has it finer, its provinces' [fineLines]; each filled on its own.
    const near = zoom >= 2 ? fineLines() : null;
    ctx.fillStyle = tones.land;
    // What of the map's rectangle is in view: a piece outside it is not drawn at all.
    const seen = [-ox / scale, -oy / scale, (width - ox) / scale, (height - oy) / scale];
    const inView = (list: Piece[]) => list.filter((p) => p.box[0] <= seen[2]! && p.box[2] >= seen[0]! && p.box[1] <= seen[3]! && p.box[3] >= seen[1]!).map((p) => p.path);
    if (near) for (const p of [...inView(near.others), ...inView(near.outline)]) ctx.fill(p, 'evenodd');
    else ctx.fill(land!, 'evenodd');
    const { ink, muted } = tones;
    if (edge) {
      ctx.lineWidth = 1 / scale;
      ctx.strokeStyle = tones.line;
      ctx.stroke(edge);
    }
    const chosen = mapLayers.chosen;
    const over = overlays();
    for (const o of over) o.under?.(ctx, scale, tones, edge);
    if (litFill) {
      // A lift in brightness, never a hue: every hue on these screens is a watch state.
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = ink;
      ctx.fill(litFill, 'evenodd');
      ctx.globalAlpha = 1;
    }
    // A layer's own lift over the missions' lights, so a Sphere's hatch reads through a lit country; on the
    // land alone, since a lift over the sea brought it up to the land, 1.24:1 under Time zones.
    if (drawn?.fill) {
      ctx.save();
      if (near) ctx.clip(near.land, 'nonzero');
      else ctx.clip(land!, 'evenodd');
      drawn.fill(ctx, tones);
      ctx.restore();
    }
    ctx.lineJoin = 'round';
    /*
     * The provinces only from ×2: at the whole Earth a state is a few pixels, and its lines were noise and
     * most of a frame. Drawn from the finer land's own lines, between provinces [fineLines], so nothing of
     * them is built at mount; in the moment before that arrives, the borders and the coast alone.
     */
    if (chosen === 'nations' && near) {
      ctx.lineWidth = 0.6 / scale;
      ctx.strokeStyle = tones.line;
      for (const p of inView(near.inner)) ctx.stroke(p);
    }
    if (chosen === 'nations' || chosen === 'timezones') {
      // The borders, as ever; faintly under the time zones, for where the bands are.
      ctx.lineWidth = (chosen === 'nations' ? 1 : 0.6) / scale;
      ctx.strokeStyle = chosen === 'nations' ? tones.strong : tones.line;
      if (near) for (const p of [...inView(near.others), ...inView(near.own)]) ctx.stroke(p);
      else ctx.stroke(land!);
    }
    if (coast && chosen !== 'nations') {
      // The coast under every other layer's lines: without it the continents were a 1.10:1 fill and nothing more.
      ctx.lineWidth = 1 / scale;
      ctx.strokeStyle = tones.strong;
      if (near) for (const p of [...inView(near.coast), ...inView(near.own)]) ctx.stroke(p);
      else ctx.stroke(coast);
    }
    drawn?.lines(ctx, scale, tones);
    for (const o of over) o.over?.(ctx, scale, tones, edge);
    if (litLine) {
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeStyle = muted;
      ctx.stroke(litLine);
    }
    for (const lifted of [hoverLine, pickedOn ? picked?.line : null, layerOpen]) {
      if (!lifted) continue;
      ctx.lineWidth = 2 / scale;
      ctx.strokeStyle = ink;
      ctx.stroke(lifted);
    }
    baseAt = { ox, oy, scale };
    paintedAt = performance.now();
  }

  /**
   * The names, in screen space, on their own canvas: a gesture moves them with the picture, and they are
   * laid out again a frame after it is drawn, clear of what covers the map, the sheet now and the credit
   * over its foot, and every mark placed this frame [lay].
   */
  function drawNames(tones: Ink, ox: number, oy: number, v: View, taken: Box[]) {
    const zoom = scale / fit();
    const chosen = mapLayers.chosen;
    if (!namesAsked && (zoom >= 2 || chosen === 'zones' || chosen === 'timezones')) {
      namesAsked = true;
      import('$lib/grid/layers/labels').then(
        (m) => {
          names = m.labels;
          request();
        },
        () => (namesAsked = false)
      );
    }
    labelled = blank(labelled);
    const top = labelled.getContext('2d')!;
    top.setTransform(dpr, 0, 0, dpr, 0, 0);
    const foot = Math.min(height - Math.max(inset, sheet), creditBox?.t ?? height);
    names?.draw(top, v, tones, covers, zoom, foot, taken);
    namesAt = { ox, oy, scale };
  }

  /**
   * Points in screen space, so each is the same size at every zoom: the directory's squares, then what
   * the overlays mark, then the missions, last, so nothing is ever drawn over one.
   */
  function points(ctx: CanvasRenderingContext2D, v: View, tones: Ink) {
    const near = close();
    const over = overlays();
    const { ink, muted, ground } = tones;
    // An overlay that draws the directory's points its own way, by when each was checked, draws them here.
    const shown = directoryShown();
    const drewOwn = shown.length > 0 && over.some((o) => o.points?.(ctx, v, tones, shown) === true);
    // A region is a hollow square, larger and dashed where its records are drawn round it, so its centre
    // is never mistaken for a record's; a record is a small filled one. No circle: that is a mission's.
    const hollow = new Path2D();
    const dashed = new Path2D();
    const filled = new Path2D();
    for (const p of drewOwn ? (near ? held : []) : directoryPoints()) {
      const [x, y] = screenAt(v, [p.x, p.y]);
      const r = drawnOf(p);
      if (x < -r || y < -r || x > width + r || y > height + r) continue;
      (p.kind === 'record' ? filled : near ? dashed : hollow).rect(x - r, y - r, 2 * r, 2 * r);
    }
    ctx.fillStyle = muted;
    ctx.fill(filled);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = muted;
    ctx.stroke(hollow);
    ctx.setLineDash([3, 3]);
    ctx.stroke(dashed);
    ctx.setLineDash([]);
    for (const o of over) o.marks?.(ctx, v, tones, liftedMarks());
    /*
     * The missions: a thick ink ring on a casing of the ground, so a ring keeps its own contrast over a
     * crowd of places, a fire season or a lit fill. Equal Earth keeps areas, so a circle on the ground is
     * drawn with its own area wherever it is [METRES_PER_UNIT]. **At its least size a ring is a symbol**,
     * and has a centre, on one disc of the ground so no seam shows between two casings; drawn larger it is
     * the ground its point's precision covers, and has none, since a dot in a circle reads as *here*, and
     * at a street's zoom it sat on one block (audit, 2026-10-24).
     */
    const disc = new Path2D();
    const band = new Path2D();
    const ring = new Path2D();
    const dot = new Path2D();
    const [small, c] = [smallest(), casing()];
    for (const p of rings) {
      const [x, y] = screenAt(v, [p.x, p.y]);
      const r = ringOf(p);
      if (x < -r || y < -r || x > width + r || y > height + r) continue;
      ring.moveTo(x + r, y);
      ring.arc(x, y, r, 0, Math.PI * 2);
      if (r > small + 0.01) {
        band.moveTo(x + r, y);
        band.arc(x, y, r, 0, Math.PI * 2);
        continue;
      }
      disc.moveTo(x + r + 1.25 + c, y);
      disc.arc(x, y, r + 1.25 + c, 0, Math.PI * 2);
      dot.moveTo(x + 2.5, y);
      dot.arc(x, y, 2.5, 0, Math.PI * 2);
    }
    ctx.fillStyle = ground;
    ctx.fill(disc);
    ctx.lineWidth = 2.5 + 2 * c;
    ctx.strokeStyle = ground;
    ctx.stroke(band);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = ink;
    ctx.stroke(ring);
    ctx.fillStyle = ink;
    ctx.fill(dot);
    ctx.lineWidth = 2;
    for (const lifted of [hovered?.kind === 'point' ? hovered.place : null, pickedOn ? picked?.place : null]) {
      if (!lifted) continue;
      const [x, y] = screenAt(v, [lifted.x, lifted.y]);
      const r = drawnOf(lifted) + (lifted.kind === 'mission' ? 4.5 : 3.5);
      ctx.beginPath();
      if (lifted.kind === 'mission') ctx.arc(x, y, r, 0, Math.PI * 2);
      else ctx.rect(x - r, y - r, 2 * r, 2 * r);
      ctx.stroke();
    }
    if (focused) {
      // The keyboard's reticle: what Enter opens is what is under it.
      const [rx, ry] = reticle();
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(rx - 10, ry);
      ctx.lineTo(rx - 3, ry);
      ctx.moveTo(rx + 3, ry);
      ctx.lineTo(rx + 10, ry);
      ctx.moveTo(rx, ry - 10);
      ctx.lineTo(rx, ry - 3);
      ctx.moveTo(rx, ry + 3);
      ctx.lineTo(rx, ry + 10);
      ctx.stroke();
    }
  }

  /**
   * Hazards' marks that are lifted: under the pointer or the reticle, what the last tap took while its
   * screen is open, and what the screen open in Com names however it was opened.
   */
  function liftedMarks(): Set<string> {
    const ids = new Set<string>();
    const add = (list: string | null | undefined) => list?.split(',').forEach((id) => ids.add(id));
    if (hovered?.kind === 'mark') add(hovered.ids);
    if (pickedOn) add(picked?.marks);
    const top = current as { kind?: unknown; ids?: unknown } | null;
    if (top && top.kind === 'hazard' && typeof top.ids === 'string') add(top.ids);
    return ids;
  }

  // ─── What is under a point, and what it says ──────────────────────────────────────────────

  /**
   * What is under (sx, sy) in the layer chosen: points first in every layer, then Hazards' marks, then a
   * shape a mission fills, then the layer's own areas. The missions light whichever layer is drawn, and
   * a lit shape is a door in every one of them [map.md §6, §8]. A layer with nothing loaded answers as
   * Nation States, so a tap is never dead.
   *
   * **A shape the finger is inside wins, where a thumb is wider than what it is on.** Further out than
   * where records are drawn, a point on land takes a tap only within its drawn size and 6 px of air: a
   * thumb's 24 px at the whole-Earth view is about 3,000 km, and a tap in the middle of a lit California
   * opened a mission in Houston. Closer in a thumb is a street, and a point keeps its whole reach, a record
   * 12 px and a region 24, as the thumb needs (it was 8 for a record at ×40, audit, 2026-10-24); a
   * mission's ring only within a shape a mission lights, which is still a door of its own. At sea a point
   * keeps its whole reach. And under a layer other than Nation States, a lit shape the tap is only near
   * gives way to the layer's own area, which is what the person chose: a tap on Oregon under Zones opened
   * California, 12 px away.
   */
  function hitAt(sx: number, sy: number): Hit | null {
    if (status !== 'ready') return null;
    const v = view();
    const at: [number, number] = [sx, sy];
    const u = unitAt(v, at);
    const none = new Set<string>();
    const within = (s: Shape) => u[0] >= s.bbox[0] && u[0] <= s.bbox[2] && u[1] >= s.bbox[1] && u[1] <= s.bbox[3] && inside(s.rings, u);
    const ashore = countryShapes.some(within);
    const far = scale < fit() * RECORD_ZOOM;
    let inLit: boolean | null = null;
    const held = (p: PlaceOfRecord) => far || (p.kind === 'mission' && (inLit ??= [...litProvinces, ...litCountries].some(within)));
    // Given only the points, `pick` answers a point or nothing.
    const point = pick(v, at, { provinces: [], countries: [], lit: none, points: shownPoints(), reachOf: ashore ? (p) => (held(p) ? drawnOf(p) + 6 : p.reach) : undefined });
    // A point the finger is on wins; one only a thumb away gives way to a hazard's mark the finger is on.
    const on = point?.kind === 'point' && Math.hypot(...screenAt(v, [point.place.x, point.place.y]).map((n, i) => n - at[i]!)) <= drawnOf(point.place) + 6;
    if (point && on) return point;
    for (const o of overlays()) {
      const mark = o.hit?.(v, at);
      if (mark) return { kind: 'mark', ...mark };
    }
    if (point) return point;
    const layer = drawn;
    if (layer) {
      // Given only the lit shapes, `pick` answers a lit shape, then nothing.
      const lit = pick(v, at, { provinces: litProvinces, countries: litCountries, lit: litIds });
      if (lit?.kind === 'shape' && inside(lit.shape.rings, u)) return lit;
      const shape = layer.hit(v, at);
      if (shape) return { kind: 'area', shape };
      if (lit || shape === null) return lit;
    }
    return pick(v, at, { provinces: provinceShapes, countries: countryShapes, lit: litIds });
  }

  /** `N open missions` or `Nothing open`, by the codes the missions are filed under. */
  function openAt(code: string | null): string {
    const n = code === null ? 0 : active.filter((m) => filedUnder(m.placement.jurisdiction, code)).length;
    return n === 0 ? 'Nothing open' : n === 1 ? '1 open mission' : `${n} open missions`;
  }

  /** What the layer and the overlays add, each its own phrase: a region's clocks, when it was checked, what is open in a Zone. */
  const also = (said: string, more: (string | null | undefined)[]) => [said, ...more.filter(Boolean)].join(' · ');

  /** Where a mission is filed, by name: `United Kingdom`, `California`. */
  function whereOf(address: string): string | null {
    const j = active.find((m) => m.address === address)?.placement.jurisdiction;
    return j ? (provinceShapes.find((s) => s.id === j)?.name ?? countryName(j.split('-')[0]!) ?? j.toUpperCase()) : null;
  }

  function sayOf(hit: Hit, sx: number, sy: number): string {
    if (hit.kind === 'mark') return hit.say;
    if (hit.kind === 'shape') {
      // Under another layer, what it says is here as well: a lit Canada under Spheres names its Spheres.
      const area = drawn?.hit(view(), [sx, sy]);
      const more = area ? drawn!.say(area).split(' · ').filter((w) => w !== hit.shape.name).join(' · ') : null;
      return also(`${hit.shape.name ?? 'Unnamed'} · ${openAt(hit.shape.id)}`, [more]);
    }
    if (hit.kind === 'area') return also(drawn?.say(hit.shape) ?? hit.shape.name ?? 'Unnamed', overlays().map((o) => o.about?.(hit.shape)));
    const p = hit.place;
    if (p.kind === 'mission') return also(`${p.title} · open mission`, [whereOf(p.address)]);
    const count = (n: number) => `${n} ${n === 1 ? 'place' : 'places'}`;
    if (p.kind === 'region') {
      // Where its records are drawn, a region's square stands for the ones that are not.
      const said = close() && p.unmapped ? `${p.name} · ${count(p.unmapped)} not on the map` : `${p.name} · ${count(p.records)}`;
      // Thinned, it stands for the regions under it too, and says so.
      const under = places && !close() ? (thin?.stands.get(p) ?? 1) - 1 : 0;
      // With Time zones drawn, its own clocks: its IANA zone knows daylight saving, the bands do not.
      return also(said, [drawn?.region?.(p.region), ...overlays().map((o) => o.region?.(p.region)), under > 0 ? `and ${under} more ${under === 1 ? 'region' : 'regions'} here, zoom in` : null]);
    }
    return also(`A place in ${p.regionName}`, overlays().map((o) => o.region?.(p.region, p.index)));
  }

  /** Under the reticle and over nothing: that it is the sea, and roughly where, to what this zoom resolves. */
  function seaAt(sx: number, sy: number): string {
    const [lon, lat] = unproject(...unitAt(view(), [sx, sy]));
    if (Math.abs(lon) > 180) return 'Off the edge of the Earth';
    const step = (LIT_SLOP * 360) / scale >= 4 ? 5 : (LIT_SLOP * 360) / scale >= 0.5 ? 1 : 0.1;
    const deg = (x: number, p: string, n: string) => `${(Math.round(Math.abs(x) / step) * step).toFixed(step < 1 ? 1 : 0)}°${x >= 0 ? p : n}`;
    return `Open water, about ${deg(lat, 'N', 'S')} ${deg(lon, 'E', 'W')}`;
  }

  /**
   * What a hit opens in Com. A shape opens as the place tapped, with where the tap landed to what
   * this zoom resolves: a thumb's width, which at the whole-Earth view on a phone is the better part
   * of a thousand kilometres, so `at` keeps whole degrees there and never finer than 0.1° anywhere,
   * and `within` says how far off it may be, so the place screen measures nothing more finely.
   */
  function screenOf(hit: Hit, sx: number, sy: number): Screen {
    // An area is only ever found by a layer whose code is here; if it went since, its picker answers.
    if (hit.kind === 'area') return drawn ? drawn.open(hit.shape) : { kind: 'layers' };
    if (hit.kind === 'mark') return { kind: 'hazard', ids: hit.ids, of: String(hit.of) };
    if (hit.kind === 'shape') {
      const [lon, lat] = unproject(...unitAt(view(), [sx, sy]));
      // A thumb's width in degrees at the equator, where one unit is 360°, and on the ground by area.
      const deg = (LIT_SLOP * 360) / scale;
      const d = deg >= 1 ? 0 : 1;
      const within = String(Math.max(1, Math.round((LIT_SLOP * METRES_PER_UNIT) / scale / 1000)));
      const name = hit.shape.name ?? hit.shape.id?.toUpperCase() ?? 'This place';
      return { kind: 'place', code: hit.shape.id, region: null, name, at: `${lat.toFixed(d)},${lon.toFixed(d)}`, record: null, within, unmapped: null };
    }
    const p = hit.place;
    if (p.kind === 'mission') return { kind: 'mission', address: p.address };
    if (p.kind === 'region') {
      const unmapped = p.unmapped === null ? null : String(p.unmapped);
      return { kind: 'place', code: null, region: p.region, name: p.name, at: null, record: null, within: null, unmapped };
    }
    return { kind: 'place', code: null, region: p.region, name: p.regionName, at: `${p.lat},${p.lon}`, record: String(p.index), within: null, unmapped: null };
  }

  /** The readout over the map: what is under the pointer, or under the reticle. Seen, and not read out: `said` is. */
  let chip = $state<{ text: string; x: number; y: number } | null>(null);
  let chipAt = $state<{ left: number; top: number }>({ left: 0, top: 0 });
  /**
   * What a screen reader is told, politely: the reticle's readout after every key, and a layer once it
   * is chosen. A hover's only once the pointer has rested, since a sweep of the mouse spoke thirteen
   * times in forty-one steps (audit, 2026-10-19).
   */
  let said = $state('');
  let sayLater: ReturnType<typeof setTimeout> | null = null;

  function sameHit(a: Hit | null, b: Hit | null): boolean {
    if (!a || !b) return a === b;
    if (a.kind === 'point' || b.kind === 'point') return a.kind === 'point' && b.kind === 'point' && a.place === b.place;
    if (a.kind === 'mark' || b.kind === 'mark') return a.kind === 'mark' && b.kind === 'mark' && a.ids === b.ids;
    return a.kind === b.kind && a.shape === b.shape;
  }

  /** The outline a hit lifts, for a shape or an area; a point or a mark is lifted where it is drawn. */
  const lineOf = (hit: Hit | null): Path2D | null => (hit && (hit.kind === 'shape' || hit.kind === 'area') ? pathOf(hit.shape.rings) : null);

  function show(hit: Hit | null, sx: number, sy: number, text = hit ? sayOf(hit, sx, sy) : '') {
    if (!sameHit(hit, hovered)) {
      hovered = hit;
      hoverLine = lineOf(hit);
      request();
    }
    chip = text ? { text, x: sx, y: sy } : null;
    if (canvas) canvas.style.cursor = hit && onpick ? 'pointer' : '';
  }

  /**
   * Near the pointer and clear of everything over the canvas: the key, the controls, and the sheet at
   * the height it is now; and never over the point it names. No wider than what is left of the controls,
   * on two lines if it must, so where nothing near is clear it sits just under the key's foot, left of the
   * controls, and is still read whole: one as wide as the canvas covered the ⌂ button and the Arctic under
   * the pointer (audit, 2026-10-24). Measured once the text is in.
   */
  const CHIP_PAD = 6;
  let chipMax = $state<number | null>(null);
  async function placeChip() {
    await tick();
    if (!chip || !chipEl) return;
    const w = chipEl.offsetWidth;
    const h = chipEl.offsetHeight;
    const pad = CHIP_PAD;
    const floor = height - Math.max(inset, sheet) - pad;
    const right = (controlsBox?.l ?? width) - pad;
    const { x, y } = chip;
    const off = (l: number, t: number) => x < l - 4 || x > l + w + 4 || y < t - 4 || y > t + h + 4;
    const clear = ([l, t]: [number, number]) =>
      l >= pad && t >= pad && l + w <= width - pad && t + h <= floor && off(l, t) && !covers.some((c) => l < c.r + pad && l + w > c.l - pad && t < c.b + pad && t + h > c.t - pad);
    const along = (t: number): [number, number] => [Math.max(pad, Math.min(x - w / 2, right - w)), t];
    const spots: [number, number][] = [[x + 14, y - h - 10], [x - w - 14, y - h - 10], [x + 14, y + 14], [x - w - 14, y + 14], along(y - h - 10), along(y + 14), along(keyFoot() + pad)];
    const spot = spots.find(clear) ?? along(keyFoot() + pad);
    chipAt = { left: spot[0], top: spot[1] };
  }

  let hoverQueued = false;
  let hoverPoint: [number, number] | null = null;
  function hoverSoon(sx: number, sy: number) {
    hoverPoint = [sx, sy];
    if (hoverQueued) return;
    hoverQueued = true;
    requestAnimationFrame(() => {
      hoverQueued = false;
      if (!hoverPoint) return;
      // Under the key there is nothing to name: the key is what is there.
      show(underKey(...hoverPoint) ? null : hitAt(...hoverPoint), ...hoverPoint);
      void placeChip();
      if (sayLater) clearTimeout(sayLater);
      sayLater = setTimeout(() => (said = chip?.text ?? said), 400);
    });
  }

  /** The reticle's own readout, after every keyboard move: polite, so it never interrupts, and never silent. */
  function sayReticle() {
    const [rx, ry] = reticle();
    const hit = hitAt(rx, ry);
    show(hit, rx, ry, hit ? sayOf(hit, rx, ry) : seaAt(rx, ry));
    said = chip?.text ?? '';
    void placeChip();
  }

  /** Whether a point of the canvas is under the key: a tap there is on the key, and opens nothing on the map under it. */
  const underKey = (x: number, y: number) => !!keyBox && x >= keyBox.l && x <= keyBox.r && y >= keyBox.t && y <= keyBox.b;

  function open(sx: number, sy: number) {
    if (!onpick) return;
    const hit = hitAt(sx, sy);
    if (!hit) return;
    const screen = screenOf(hit, sx, sy);
    picked = {
      key: JSON.stringify(screen),
      line: lineOf(hit),
      place: hit.kind === 'point' ? hit.place : null,
      marks: hit.kind === 'mark' ? hit.ids : null
    };
    pickedOn = true;
    request();
    onpick(screen);
  }

  // Lifted while what it opened is on top of Com, by what the screen says rather than which object
  // holds it: history hands back a copy. Read first, so the effect depends on it before any pick.
  $effect(() => {
    const top = current == null ? null : JSON.stringify(current);
    const on = picked !== null && top === picked.key;
    if (on === pickedOn) return;
    pickedOn = on;
    request();
  });

  // ─── Moving it ────────────────────────────────────────────────────────────────────────────

  /** Zoom by `factor`, keeping the point under (sx, sy) where it is: by default, the reticle's. */
  function zoomAt(factor: number, sx = reticle()[0], sy = reticle()[1]) {
    touched = true;
    const ux = cx + (sx - width / 2) / scale;
    const uy = cy + (sy - height / 2) / scale;
    scale *= factor;
    clamp();
    cx = ux - (sx - width / 2) / scale;
    cy = uy - (sy - height / 2) / scale;
    clamp();
    request();
  }

  function panBy(dx: number, dy: number) {
    touched = true;
    cx -= dx / scale;
    cy -= dy / scale;
    clamp();
    request();
  }

  /** Set once a person moves the map. After that, nothing moves it for them. */
  let touched = false;

  /** Whether anything over the canvas covers some of the Earth itself, its outline rather than its box. */
  function earthCovered(): boolean {
    const v = view();
    for (const c of covers) {
      for (let i = 0; i <= 4; i++) {
        for (let j = 0; j <= 4; j++) {
          if (inside([earth], unitAt(v, [c.l + ((c.r - c.l) * i) / 4, c.t + ((c.b - c.t) * j) / 4]))) return true;
        }
      }
    }
    return false;
  }

  /** CSS px kept between the Earth and what covers the canvas, when the Earth is fitted between them. */
  const GAP = 8;
  /**
   * How tall the Earth is kept above the sheet at half on a phone, in CSS px: the key's own lines are
   * cut to leave it this, so a key that grows with every overlay shrinks rather than the Earth. At 20 px
   * of map, which the iPhone SE had with day and night and Hazards on, the layer just chosen could not
   * be seen while its screen was open (audit, 2026-10-19).
   */
  const EARTH = 120;

  /**
   * The whole Earth in the part of the canvas nothing covers [decided 2026-10-17; map.md §3, §6]: above
   * the phone's sheet, at half, where every screen the map opens comes up, the layer picker among them,
   * and clear of the page's key and the map's own controls. As wide as the canvas where it can be,
   * centred between the sheet and the highest line it can sit under with nothing over the Earth's own
   * outline: no line at all on a wide screen, where the key and the controls sit in its empty corners. On
   * a phone, where the controls' column runs down the side the world would fill, narrower, in what is
   * left of the controls and below the key, so the whole map is the whole map and stays in view while Com
   * is open. Where that would leave it less than two fifths of the screen's width, the same above the
   * sheet at peek; and on a screen too small even for that, full width and as clear of them as it fits.
   * Nothing moves it until a person does.
   */
  function world() {
    least = 0;
    cx = 0.5;
    for (const floor of [height - Math.max(inset, reach), height - inset]) {
      scale = width;
      const centredBelow = (top: number) => HEIGHT / 2 + (height - top - floor) / 2 / scale;
      const lines = [...new Set([0, ...covers.map((c) => c.b)])].filter((top) => top >= 0 && floor - top >= HEIGHT * scale).sort((a, b) => a - b);
      for (const line of lines) {
        cy = centredBelow(line);
        if (!earthCovered()) return clamp();
      }
      // Left of whatever covers the canvas's right side, below whatever covers its left.
      const right = Math.min(width, ...covers.filter((c) => c.l > width / 2).map((c) => c.l - GAP));
      const top = Math.max(0, ...covers.filter((c) => c.l <= width / 2).map((c) => c.b + GAP));
      const fits = Math.min(right, (floor - top) / HEIGHT);
      if (fits >= width * 0.4) {
        least = fits;
        scale = fits;
        cx = 0.5 + (width - right) / 2 / scale;
        cy = centredBelow(top);
        return clamp();
      }
    }
    const floor = height - inset;
    scale = width;
    const lines = [0, ...covers.map((c) => c.b)].filter((top) => top >= 0 && floor - top >= HEIGHT * scale);
    cy = HEIGHT / 2 + (height - Math.max(0, ...lines) - floor) / 2 / scale;
    clamp();
  }

  /** The whole map, as the button says — and a person asked for it, so it stays there. */
  function reset() {
    touched = true;
    world();
    request();
    if (focused) sayReticle();
  }

  // Pointers: one drags, two pinch. Pointer events cover mouse, touch and pen alike.
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  /** Where a gesture began, while it can still turn out to be a tap: one finger, barely moved. */
  let tap: { id: number; x: number; y: number } | null = null;
  /** How far a finger may drift and still have tapped, in CSS px. */
  const TAP_SLOP = 8;

  function onPointerDown(e: PointerEvent) {
    canvas?.setPointerCapture(e.pointerId);
    tap = pointers.size === 0 ? { id: e.pointerId, x: e.offsetX, y: e.offsetY } : null;
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    }
  }

  function onPointerMove(e: PointerEvent) {
    const last = pointers.get(e.pointerId);
    if (!last) {
      // A mouse or a pen over the map with nothing pressed: say what is under it. Touch has no hover.
      if (e.pointerType !== 'touch' && e.buttons === 0) hoverSoon(e.offsetX, e.offsetY);
      return;
    }
    const now = { x: e.offsetX, y: e.offsetY };
    // A drag that wanders back to where it started was still a drag.
    if (tap && Math.hypot(now.x - tap.x, now.y - tap.y) >= TAP_SLOP) tap = null;
    if (!tap) moved();
    if (pointers.size === 1) {
      if (!tap) panBy(now.x - last.x, now.y - last.y);
      else return;
    } else if (pointers.size === 2) {
      pointers.set(e.pointerId, now);
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (pinch > 0) zoomAt(d / pinch, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
      pinch = d;
      return;
    }
    pointers.set(e.pointerId, now);
  }

  function onPointerUp(e: PointerEvent) {
    if (tap?.id === e.pointerId && Math.hypot(e.offsetX - tap.x, e.offsetY - tap.y) < TAP_SLOP && !underKey(e.offsetX, e.offsetY)) open(e.offsetX, e.offsetY);
    tap = null;
    pointers.delete(e.pointerId);
    pinch = 0;
    if (pointers.size === 0) settle();
  }

  function onPointerLeave() {
    hoverPoint = null;
    if (!focused) show(null, 0, 0);
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    moved();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY);
  }

  function onKey(e: KeyboardEvent) {
    const step = Math.min(width, height) * 0.15;
    const keys: Record<string, () => void> = {
      ArrowLeft: () => panBy(step, 0),
      ArrowRight: () => panBy(-step, 0),
      ArrowUp: () => panBy(0, step),
      ArrowDown: () => panBy(0, -step),
      '+': () => zoomAt(1.5),
      '=': () => zoomAt(1.5),
      '-': () => zoomAt(1 / 1.5),
      '0': reset,
      Enter: () => open(...reticle())
    };
    const act = keys[e.key];
    if (act) {
      e.preventDefault();
      // Whatever focused the canvas, a key means the keyboard is in use: the reticle shows.
      if (!focused) {
        focused = true;
        request();
      }
      act();
      if (e.key !== 'Enter') sayReticle();
    }
  }

  /**
   * How tall the map's lines in the key may be on a phone, in CSS px, or null for no cap: whole lines,
   * one to three, as many as leave the Earth `EARTH` px above the sheet at half, **and never fewer than
   * the first line needs whole**, which is what ages fastest [keyLines]: on a 360 px phone the key was cut
   * to one line, and the feeds' age and *some events, never all* went with it (audit, 2026-10-24); the
   * Earth gives way first. `cut` is whether that left some out, which the key says with an ellipsis; the
   * layers screen gives every word.
   */
  let room = $state<number | null>(null);
  let cut = $state(false);
  /**
   * The credit over the map's foot: none at full height, where the map is a strip the key covers, and the
   * credit ran under it; one line, clipped short of the controls where it is beside them, with every word
   * on the layers screen (audit, 2026-10-24).
   */
  let creditShown = $state(true);
  let creditMax = $state<number | null>(null);
  /**
   * Measures again, once the map has mounted. The key's own box does not change when a line arrives that
   * its cap already cuts, so the cap is worked out again whenever its lines do: a key cut to one line
   * before Hazards' arrived stayed one line, and cut the feeds' age (2026-10-24).
   */
  let resize: (() => void) | null = null;

  onMount(() => {
    if (!canvas) return;
    const el = canvas;
    // The map's own lines go into the page's key, so the key is one panel [cover].
    if (cover && moreEl) cover.append(moreEl);

    const size = () => {
      const box = el.getBoundingClientRect();
      width = box.width;
      height = box.height;
      inset = Math.min(insetEl?.getBoundingClientRect().height ?? 0, height);
      reach = Math.min(reachEl?.getBoundingClientRect().height ?? 0, height);
      sheet = Math.min(sheetEl?.getBoundingClientRect().height ?? 0, height);
      const boxOf = (c: HTMLElement | undefined): Box | null => {
        const r = c?.getBoundingClientRect();
        if (!r || r.width === 0 || r.height === 0) return null;
        return { l: r.left - box.left, t: r.top - box.top, r: r.right - box.left, b: r.bottom - box.top };
      };
      // On a phone, the key's lines are cut to whole lines that leave the Earth room above the sheet at half.
      if (moreEl && reach > 0) {
        const line = parseFloat(getComputedStyle(moreEl).lineHeight) || 17;
        const top = moreEl.getBoundingClientRect().top - box.top;
        const first = moreEl.querySelector('.line')?.getBoundingClientRect();
        const whole = first ? Math.max(1, Math.round(first.height / line)) : 1;
        const was = room;
        room = Math.max(whole, Math.min(3, Math.floor((height - reach - EARTH - GAP - top - 8) / line))) * line;
        cut = moreEl.scrollHeight > moreEl.clientHeight + 1;
        // The key is measured below before its new cap is drawn: measured again once it is, so the
        // opening view is fitted to the key as it stands (a key cut from three lines to two left the
        // Earth fitted to three, 2026-10-24).
        if (room !== was) void tick().then(size);
      } else {
        room = null;
        cut = false;
      }
      keyBox = boxOf(cover);
      controlsBox = boxOf(controlsEl);
      chipMax = controlsBox ? Math.max(120, controlsBox.l - 2 * CHIP_PAD) : null;
      // At full the sheet leaves a strip the key covers; elsewhere the credit is one line above the sheet.
      creditShown = height - sheet > (keyBox?.b ?? 0) + 24;
      const creditTop = height - sheet - 4 - 18;
      creditMax = controlsBox && creditTop < controlsBox.b + 4 ? controlsBox.l - 8 - 12 : width - 16;
      creditBox = creditShown ? boxOf(creditEl) : null;
      layerData.covers = covers = [keyBox, controlsBox].filter((c): c is Box => c !== null);
      // Capped at 2: a 3x phone would quadruple the pixels filled for no visible gain.
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
      // Until a person moves it, the opening view is the opening view at whatever size this is.
      if (!touched) world();
      clamp();
      request();
    };
    const observer = new ResizeObserver(size);
    for (const watched of [el, insetEl, reachEl, sheetEl, cover, moreEl, creditEl]) if (watched) observer.observe(watched);
    resize = size;
    size();

    // Wheel must be non-passive to stop the page scrolling under the map.
    el.addEventListener('wheel', onWheel, { passive: false });
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', request);
    /*
     * Low signature changes every token the map draws with, and is set on the document itself
     * (`html[data-signature]`), which no media query sees: until this, the canvas kept its document
     * colours until somebody next moved the map.
     */
    const signature = new MutationObserver(request);
    signature.observe(document.documentElement, { attributes: true, attributeFilter: ['data-signature'] });

    fetch('/grid/world.json')
      .then((r) => (r.ok ? (r.json() as Promise<Topology>) : Promise.reject(new Error(String(r.status)))))
      .then((file) => {
        const layers = decode(file);
        topology = file;
        land = pathOf(layers['world']?.rings ?? []);
        coast = pathOf(coastOf(file), false);
        provinceShapes = layers['provinces']?.shapes ?? [];
        countryShapes = layers['world']?.shapes ?? [];
        layerData.countries = countryShapes;
        layerData.provinces = provinceShapes;
        relight();
        status = 'ready';
        request();
      })
      .catch(() => {
        status = 'failed';
      });

    return () => {
      observer.disconnect();
      signature.disconnect();
      el.removeEventListener('wheel', onWheel);
      scheme.removeEventListener('change', request);
      if (still) clearTimeout(still);
      if (sayLater) clearTimeout(sayLater);
      moreEl?.remove();
    };
  });

  /**
   * Places, the first time it is switched on, and never before: the directory's region file, which
   * the page already holds and the browser answers from its cache, and the records' points, fetched
   * whole, never by what is on screen — looking at the map tells nobody where anybody looked
   * [map.md §2]. A record's own details load only when somebody taps it.
   */
  const json = <T,>(url: string) => fetch(url).then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(new Error(url))));
  /*
   * The regions alone, for their ages over Nation States without Places: the region file the page
   * already holds, from the browser's cache, and never Places' own file, which stays Places'.
   */
  $effect(() => {
    if (!agesOn || places || directory || regionsAsked) return;
    regionsAsked = true;
    void json<RegionsFile>('/console-regions.json').then(
      (regions) => {
        if (!directory) directory = placesOfDirectory(regions, null);
        request();
      },
      () => (regionsAsked = false)
    );
  });
  $effect(() => {
    if (!places || directoryAsked) return;
    directoryAsked = true;
    placesStatus = 'loading';
    void Promise.all([json<RegionsFile>('/console-regions.json'), json<PlacesFile>('/grid/places.json').catch(() => null)])
      .then(([regions, file]) => {
        // The regions without their records still draw. Either way the key says what did not
        // arrive, and the next time the switch is turned on asks for it again.
        directory = placesOfDirectory(regions, file);
        if (!file) directoryAsked = false;
        placesStatus = file ? 'ready' : 'failed';
        request();
      })
      .catch(() => {
        directoryAsked = false;
        placesStatus = 'failed';
      });
  });

  /*
   * The layer chosen in Com: its code and files, the first time it is chosen and never before, each
   * from navcom.app and fetched whole [D10; budget.mjs MAP_LINES]. A layer whose code does not arrive
   * says so, as one whose files do not.
   */
  $effect(() => {
    const chosen = mapLayers.chosen;
    drawn = null;
    // A hover in one layer names nothing in the next.
    hovered = null;
    hoverLine = null;
    chip = null;
    const code =
      chosen === 'zones'
        ? import('$lib/grid/layers/zones')
        : chosen === 'spheres'
          ? import('$lib/grid/layers/spheres')
          : chosen === 'timezones'
            ? import('$lib/grid/layers/timezones')
            : null;
    code?.then(
      (m) => {
        if (mapLayers.chosen !== chosen) return;
        m.layer.load();
        drawn = m.layer;
      },
      () => {
        if (chosen === 'zones') mapLayers.zones = 'failed';
        else if (chosen === 'spheres') mapLayers.spheres = 'failed';
        else mapLayers.times = 'failed';
      }
    );
    request();
  });
  /*
   * The overlays, each the first time it is wanted and never before, by `import()` [budget.mjs
   * MAP_LINES]; each stopped and dropped when it is not drawn, so a tick it keeps stops with it.
   */
  function overlay(on: () => boolean, code: () => Promise<{ overlay: Overlay }>, set: (o: Overlay | null) => void, failed: () => void) {
    $effect(() => {
      if (!on()) return;
      let live = true;
      let held: Overlay | null = null;
      code().then(
        (m) => {
          if (!live) return;
          held = m.overlay;
          held.load();
          set(held);
          request();
        },
        failed
      );
      return () => {
        live = false;
        held?.stop?.();
        set(null);
        request();
      };
    });
  }
  overlay(daylightDrawn, () => import('$lib/grid/layers/daylight'), (o) => (sun = o), () => (mapLayers.sun = 'failed'));
  overlay(() => agesOn, () => import('$lib/grid/layers/ages'), (o) => (ages = o), () => (mapLayers.agesFile = 'failed'));
  overlay(() => mapLayers.chosen === 'zones', () => import('$lib/grid/layers/zone-missions'), (o) => (counts = o), () => (mapLayers.counts = 'failed'));
  // Hazards: off until ticked, never stored, so a reload asks nobody; its code asks the feeds [$lib/outside].
  overlay(() => mapLayers.hazards, () => import('$lib/grid/layers/hazards'), (o) => (hazards = o), () => (mapLayers.hazardsCode = 'failed'));

  // What a layer has loaded is a new picture, and so is what it has open in Com, and the Sphere picked out.
  $effect(() => {
    void mapLayers.loaded;
    void mapLayers.sphere;
    // A hazard's screen lifts its marks however it was opened, from a tap or from history.
    void current;
    const shape = drawn?.lifted?.(current) ?? null;
    layerOpen = shape ? pathOf(shape.rings) : null;
    request();
  });

  /**
   * What the chosen layer is, where it came from, and how old, on the map itself [invariant 7; D6, D8]:
   * one short line for the layer and one for each thing over it, the rest of its words on the layers
   * screen [mapKey]; the map's own words for a layer whose files or code did not arrive, so a map drawn
   * without its layer never passes for one with nothing in it. **What ages fastest first**, Hazards' feeds,
   * whose line the key is never cut shorter than [room]; then the layer, the missions by Zone, the
   * directory's checks and the sun. With the layer first, a 360 px phone's key kept the draft label and
   * cut the feeds' age (audit, 2026-10-24).
   */
  const failedSay = 'not loaded — it needs one visit with a connection';
  const keyLines = $derived.by(() => {
    void mapLayers.loaded;
    const chosen = mapLayers.chosen;
    const own = chosen === 'zones' ? mapLayers.zones : chosen === 'timezones' ? mapLayers.times : chosen === 'spheres' ? mapLayers.spheres : 'off';
    const out: { id: string; line: string; credit: string }[] = [];
    const add = (id: string, line: string, credit = '') => void (line && out.push({ id, line, credit }));
    const over = (on: boolean, o: Overlay | null, state: string, id: string, name: string) => {
      if (on) add(id, state === 'failed' ? `${name} ${failedSay}` : (o?.legend() ?? ''), o?.credit?.());
    };
    over(mapLayers.hazards, hazards, mapLayers.hazardsCode, 'hazards', 'Hazards');
    if (chosen !== 'nations' && chosen !== 'none') add('layer', own === 'failed' ? `Layer ${failedSay}` : (drawn?.legend() ?? ''), drawn?.credit?.());
    over(chosen === 'zones', counts, mapLayers.counts, 'counts', 'Missions by Zone');
    over(agesOn, ages, mapLayers.agesFile, 'ages', 'Directory by last check');
    over(daylightDrawn(), sun, mapLayers.sun, 'sun', 'Day and night');
    return out;
  });
  /** The chosen layer's own line, wherever it is in the key. */
  const layerLine = () => keyLines.find((k) => k.id === 'layer')?.line ?? '';
  $effect(() => {
    mapKey.lines = keyLines.map(({ line, credit }) => ({ line, credit }));
    mapKey.swatches = swatches;
    void tick().then(() => resize?.());
  });
  /**
   * The overlays' own key, a row a class, under the map's lines: only while one draws classes it has to
   * name. Places' squares first, unless the ages draw the regions their own way.
   */
  const swatches = $derived.by((): readonly Swatch[] => {
    void mapLayers.loaded;
    // A province or a country a mission is filed under, lit: the key's missions line is the ring's.
    const filed: Swatch[] = lit ? [{ mark: 'lit', tone: 'muted', text: 'Missions filed under a place' }] : [];
    const own: Swatch[] = places && !agesOn ? [{ mark: 'square-ring', tone: 'muted', text: 'Regions' }, { mark: 'square-small', tone: 'muted', text: 'Places, closer in' }] : [];
    return [...filed, ...own, ...overlays().flatMap((o) => o.swatches?.() ?? [])];
  });
  /**
   * Whose the chosen layer is, as its licence asks, over the map's foot where maps carry theirs, above the
   * sheet at whatever height it is: the key keeps one short line, and the credit stays on the map [map.md §8].
   */
  const credit = $derived.by(() => {
    void mapLayers.loaded;
    return drawn?.attribution?.() ?? '';
  });

  /** What each layer is called, for a screen reader's name of the map and the word that it changed. */
  const NAMES = { nations: 'Nation States', zones: 'Zones', spheres: 'Spheres', timezones: 'Time zones', none: 'None' } as const;
  /** The canvas's name: the page's, the layer and what is over it, so it changes when they do. */
  const named = $derived.by(() => {
    const chosen = mapLayers.chosen;
    const on = [chosen === 'zones' && 'missions by Zone', agesOn && 'the directory by last check', mapLayers.hazards && 'Hazards', daylightDrawn() && 'day and night'].filter(Boolean);
    const layer = chosen !== 'nations' && chosen !== 'none' && layerLine() ? layerLine() : NAMES[chosen];
    return `${label}. Layer: ${layer}${on.length > 0 ? `; over it, ${on.join(', ')}` : ''}`;
  });
  /** A layer chosen is said once, politely, by its line in the key once that says what it is. */
  let announced = 'nations';
  $effect(() => {
    const chosen = mapLayers.chosen;
    const first = chosen === 'nations' || chosen === 'none' ? NAMES[chosen] : layerLine();
    if (chosen === announced || !first || /loading$/.test(first)) return;
    announced = chosen;
    said = `Map layer: ${first}`;
  });
  // New missions are a new picture, and only new ones are: the page hands over a new list every minute.
  $effect(() => {
    const now = active.map((m) => {
      const p = m.placement.point;
      return `${m.address} ${m.title} ${m.placement.jurisdiction} ${p ? `${p.kind} ${p.lon} ${p.lat} ${p.precision}` : ''}`;
    });
    const key = now.join('\n');
    if (key !== ringsOf) {
      ringsOf = key;
      rings = placesOfMissions(active);
      relight();
      request();
    }
    // What counts them by Zone reads them here, so no layer's code reads the mission feed itself.
    const unplaced = active.length - rings.length;
    const had = layerData.missions;
    if (!had || had.rings !== rings || had.unplaced !== unplaced || had.age !== missionsAge) {
      layerData.missions = { rings, unplaced, age: missionsAge };
      loaded();
    }
  });
  // Places on or off is a new picture, and so is the directory arriving.
  $effect(() => {
    void places;
    void agesOn;
    void directory;
    request();
  });
</script>

<div class="grid" data-grid={status}>
  <!--
    The canvas is the map: focusable, labelled, and taking the arrow keys. No role, because the
    two that fit do not survive this project's checker — "img" contradicts being focusable, and
    "application" is not counted as interactive — and this codebase suppresses no warnings. The
    zoom controls beside it are real buttons, so nothing here depends on the keys alone, and every
    place it opens is reachable without it.
  -->
  <canvas
    bind:this={canvas}
    tabindex="0"
    aria-label="{named}. Arrow keys pan, plus and minus zoom, zero shows the whole map, Enter opens what is under the centre."
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointerleave={onPointerLeave}
    onpointercancel={(e) => {
      tap = null;
      onPointerUp(e);
    }}
    onkeydown={onKey}
    onfocus={() => {
      // The reticle is the keyboard's: a tap or a click focuses the canvas too, and shows none.
      if (!canvas?.matches(':focus-visible')) return;
      focused = true;
      sayReticle();
    }}
    onblur={() => {
      focused = false;
      show(null, 0, 0);
    }}
  ></canvas>
  <!-- How much of the canvas's foot the page covers, measured rather than parsed [--map-inset]. -->
  <div class="inset" bind:this={insetEl} aria-hidden="true"></div>
  <!-- And how much it covers at half, where every screen the map opens comes up [--map-reach]. -->
  <div class="inset reach" bind:this={reachEl} aria-hidden="true"></div>
  <!-- And how much it covers now, at whichever height the sheet is [--map-sheet]. -->
  <div class="inset sheet" bind:this={sheetEl} aria-hidden="true"></div>
  <!-- What is under the pointer or the reticle, as seen; what a screen reader is told is beside it. -->
  <div class="chip" bind:this={chipEl} aria-hidden="true" data-chip style:left="{chipAt.left}px" style:top="{chipAt.top}px" style:max-width={chipMax === null ? null : `${chipMax}px`}>{chip?.text ?? ''}</div>
  <div class="sr" role="status" data-said>{said}</div>
  {#if credit && creditShown}<small class="credit" bind:this={creditEl} data-credit style:max-width={creditMax === null ? null : `${creditMax}px`}>{credit}</small>{/if}
  <!--
    The map's own lines in the key, moved into the page's key as the map mounts [cover]: what the layer
    is, whose and how old, a line each, and what each mark the overlays draw means, drawn as the canvas
    draws it, in one row. Cut to whole lines on a phone; the layers screen gives every word.
  -->
  {#snippet swatch(s: Swatch)}
    {@const i = s.text.lastIndexOf(' · ')}
    <li data-swatch={s.mark}>
      <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" class={s.tone}>
        <path class:filled={FILLED.has(s.mark)} d={SWATCH_PATHS[s.mark][0]} /><path class="hatch" d={SWATCH_PATHS[s.mark][1]} />
      </svg>{#if s.inline && i > 0}<span class="sr">{s.text.slice(0, i + 3)}</span>{s.text.slice(i + 3)}{:else}{s.text}{/if}
    </li>
  {/snippet}
  <div class="key-more" bind:this={moreEl} data-key-more data-cut={cut || null} style:max-height={room === null ? null : `${room}px`}>{#if keyLines.length > 0}<p data-legend={mapLayers.chosen}>{#each keyLines as k, n (n)}{#if n > 0}<span class="sr">{'. '}</span>{/if}<span class="line">{k.line}</span>{/each}</p>{/if}{#if swatches.length > 0}<ul class="swatches" data-swatches aria-label="Map key">{#each swatches as s (s.text)}{@render swatch(s)}{/each}</ul>{/if}</div>
  <div class="controls" bind:this={controlsEl}>
    <button type="button" aria-label="Zoom in" onclick={() => zoomAt(1.5)}>+</button>
    <button type="button" aria-label="Zoom out" onclick={() => zoomAt(1 / 1.5)}>−</button>
    <button type="button" aria-label="Show the whole map" onclick={reset}>⌂</button>
    <!-- What the map divides the Earth by: chosen in Com, so nothing it opens can cover Distress [com.md §4]. -->
    <button type="button" aria-label="Map layers" data-layers disabled={status !== 'ready' || !onpick} onclick={() => onpick?.({ kind: 'layers' })}>
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 4 3 9l9 5 9-5zm-9 9 9 5 9-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>
    </button>
  </div>
  {#if status === 'failed'}
    <!-- Offline is a normal state here [C10]. Say what happened rather than show an empty box. -->
    <strong class="state" data-grid-failed>Map not loaded — it needs one visit with a connection</strong>
  {/if}
</div>

<style>
  .grid {
    position: relative;
    width: 100%;
    height: 100%;
    background: var(--t-ground);
  }
  /* On the terminal, so the map's own lines in the page's key draw a swatch in them too. */
  :global(.terminal) {
    /*
     * The land and its lines, neutrals of the map's own. The panel's tokens put land at 1.10:1 on the
     * sea, provinces at 1.23:1 and borders at 1.73:1 on the land, which a cheap screen's glare in
     * daylight takes to 1.03, 1.07 and 1.21: no map at all at noon. These are 1.43:1, 1.55:1 and
     * 2.31:1, and the coast 3.3:1 on the sea; no hue is spent on any of them.
     */
    --map-land: #272f3b;
    --map-line: #424c59;
    --map-strong: #5b6673;
  }
  /* Low signature, amber and dim, which is the default for anyone with a callsign: 1.34:1, 1.55:1 and 2.30:1. */
  :global(:root[data-signature='low'] .terminal) {
    --map-land: #2e210d;
    --map-line: #553d15;
    --map-strong: #76551c;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    cursor: grab;
  }
  canvas:active { cursor: grabbing; }
  canvas:focus-visible { outline: 3px solid var(--t-ink); outline-offset: -3px; }
  .inset {
    position: absolute;
    inset-inline-start: 0;
    bottom: 0;
    width: 0;
    height: var(--map-inset, 0px);
    pointer-events: none;
  }
  .reach {
    height: var(--map-reach, 0px);
  }
  .sheet {
    height: var(--map-sheet, var(--map-inset, 0px));
  }
  .chip {
    position: absolute;
    /* Over the key, which it is placed clear of, but never over the sheet: the page's map layer holds it. */
    z-index: 2;
    max-width: calc(100% - 1.5rem);
    padding: 0.35rem 0.6rem;
    border: 1px solid var(--t-line-strong);
    background: var(--t-ground);
    color: var(--t-ink);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.75rem;
    letter-spacing: 0.04em;
    pointer-events: none;
    overflow-wrap: anywhere;
  }
  .chip:empty {
    display: none;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
  /* In the page's key, under its own lines: the map's, a line each, then the swatches in one row. */
  .key-more {
    position: relative;
    flex-basis: 100%;
    order: 4;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.8125rem;
    line-height: 1.3;
    color: var(--t-ink);
  }
  .key-more:empty {
    display: none;
  }
  .key-more p {
    margin: 0;
    color: inherit;
    line-height: inherit;
  }
  .key-more .line {
    display: block;
  }
  /* Cut short on a small phone: said, not hidden. Every word is on the layers screen. */
  .key-more[data-cut]::after {
    content: '…';
    position: absolute;
    inset-inline-end: 0;
    bottom: 0;
    padding-inline-start: 0.5rem;
    background: var(--t-ground);
  }
  .swatches {
    display: flex;
    flex-flow: row wrap;
    gap: 0 0.7rem;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 0.75rem;
    color: var(--t-muted);
  }
  .swatches li {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-height: 1.3em;
  }
  .swatches svg {
    flex: none;
    stroke-width: 1.5;
    fill: none;
    stroke: currentColor;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .swatches .ink { color: var(--t-ink); }
  .swatches .muted { color: var(--t-muted); }
  .swatches .faint { color: var(--t-faint); }
  /* As the canvas draws each: the filled ones filled, the rest outlines. */
  .swatches .filled { fill: currentColor; stroke: none; }
  /* Night's dots, at the spacing the canvas lays them. */
  [data-swatch='dots'] svg { color: var(--map-strong); }
  /* A province or a country a mission is filed under: the lift the map gives it, on the land. */
  [data-swatch='lit'] .filled {
    fill: var(--t-line-strong);
    fill: color-mix(in srgb, var(--t-ink) 16%, var(--map-land));
    stroke: var(--t-muted);
    stroke-width: 1;
  }
  .swatches .hatch { stroke-width: 1; }
  /* Over the map's foot, above the sheet at whatever height it is, as maps carry their credit. */
  .credit {
    position: absolute;
    inset-inline-start: 0.5rem;
    bottom: calc(var(--map-sheet, var(--map-inset, 0px)) + 0.25rem);
    max-width: calc(100% - 1rem);
    padding: 0 0.3rem;
    /* One line, cut with an ellipsis short of the controls: every word is on the layers screen. */
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    /* Plain first: a browser without color-mix drops the second and keeps the ground [panel.css]. */
    background: var(--t-ground);
    background: color-mix(in srgb, var(--t-ground) 85%, transparent);
    color: var(--t-muted);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.6875rem;
    line-height: 1.4;
    pointer-events: none;
  }
  .controls {
    position: absolute;
    inset-inline-end: 0.75rem;
    inset-block-start: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  /* The terminal's own floor: 48px is the minimum, and its buttons are 56. Square, so the
     inherited side padding is removed rather than left to squeeze the glyph. */
  .controls button {
    width: 3.5rem;
    height: 3.5rem;
    padding: 0;
    font-size: 1.4rem;
    line-height: 1;
  }
  /*
   * The floor itself on a 360 px phone, or a short one: four 56 px buttons ran to 253 px, under the sheet at
   * half on a prepaid Android's 560 px of page, and Map layers could not be reached (audit, 2026-10-24).
   */
  @media (max-width: 380px), (max-height: 600px) {
    .controls button {
      width: 3rem;
      min-width: 3rem;
      height: 3rem;
      min-height: 3rem;
    }
  }
  .controls button:focus-visible { outline: 2px solid var(--t-ink); outline-offset: 1px; }
  .controls svg {
    display: block;
    margin: auto;
  }
  /* Centred, not at the foot: on a phone the landing page's sheet covers the bottom of the map at
     every height, and a failure under it was present, "visible" to a test, and seen by nobody. */
  .state {
    position: absolute;
    inset-inline: 1rem;
    top: 50%;
    transform: translateY(-50%);
    text-align: center;
    color: var(--t-ink);
    font-size: 0.9rem;
  }
</style>
