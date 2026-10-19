<script lang="ts">
  /**
   * The grid: the map NavCom draws itself. [docs/design/map.md]
   *
   * Outlines we own, on a canvas, with no third-party request of any kind — looking at the map
   * tells nobody anything. Street-level detail is somebody else's app, reached by handing off a
   * pin, never by loading their tiles here.
   *
   * Sits inside `.terminal`, whose tokens it draws with — only `--t-ground` is global. It takes
   * the neutrals and never a hue, because every hue on these screens is a watch state.
   *
   * **Every shape and point is a door** [map.md §6]. A hover names what is under the pointer and
   * what is open there; a tap opens it in Com, and what it took stays lifted while that place is
   * open, because a finger has no hover; the keyboard gets the same through a reticle at the centre
   * of what nothing covers. What is under a point is `$lib/grid/pick`, shared by all three.
   *
   * **Points are places on record, and nothing else** [invariant 1]. The map takes no coordinates:
   * it draws the rings of verified missions and, with Places on, the directory's own regions and
   * records, each made by `$lib/grid/places`, which is the only module that can make one.
   *
   * **One layer at a time** [map.md, Layers]: Nation States, which is what the map always drew;
   * Starcom's Zones, in three neutral weights, container heaviest; Time zones, as alternating lifts;
   * or none. The choice is `$lib/grid/layer.svelte`, made in Com's layers screen, and each layer's
   * code and files arrive by `import()` only once it is chosen [budget.mjs MAP_LINES]. A layer's areas
   * answer a tap and a hover the way a country does under Nation States; points answer first in all.
   * Over a layer, overlays that answer no tap of their own: day and night, worked out on the phone;
   * the directory's regions by when they were last checked; open missions counted by Zone. Each is
   * a module of its own, loaded the same way, and says in the key what it is and how old.
   *
   * Built for the device floor, a prepaid Android 8. Each layer becomes one `Path2D` in map units
   * when the file loads, and a pan or zoom only changes the canvas transform: one matrix and a
   * redraw, never per-frame geometry. Redraws happen on demand, at most once per frame.
   */
  import { onMount, tick } from 'svelte';
  import type { Mission } from '@navcom/core';
  import type { Screen } from '$lib/com/screens';
  import { HEIGHT, METRES_PER_UNIT, decode, edgeOfEarth, filedUnder, inside, lightsOf, unproject, type Shape, type Topology } from '$lib/grid/topology';
  import { LIT_SLOP, pick, screenAt, unitAt, type Hit, type View } from '$lib/grid/pick';
  import { daylightDrawn, layerData, loaded, mapLayers, type DrawnLayer, type Ink, type Overlay, type Swatch } from '$lib/grid/layer.svelte';
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
    legend = $bindable(null),
    missionsAge = null,
    cover,
    onpick
  }: {
    /** The missions open now. Each lights where it is filed: its province, or else its country. */
    active?: readonly Mission[];
    /** Places: the directory's regions, and its records once zoomed in. Fetched the first time it is on. */
    places?: boolean;
    /** What the map shows, for anybody who cannot see the canvas. */
    label?: string;
    /** The screen on top of Com, so what a tap took stays lifted while it is the one open. */
    current?: unknown;
    /** Whether the map has drawn, so the page offers Places only once there is a map to draw them on. */
    status?: 'loading' | 'ready' | 'failed';
    /** Whether Places' files arrived, so the map's key can say so when they did not [invariant 7]. */
    placesStatus?: 'off' | 'loading' | 'ready' | 'failed';
    /**
     * What the chosen layer is, whose, and how old, for the page's key to say [invariant 7; D6, D8]. In
     * the key rather than on the canvas: the key is at the top, and the sheet, which a layer's screens
     * open at half, covers the canvas's foot, where a readout of what is drawn was present and unseen.
     */
    legend?: { layer: string; text: string } | null;
    /**
     * How old the missions are, as the key says it (`live`, or `as of …, offline`), or null while they
     * have not been read, which is unknown and never none: what counts them by Zone says so.
     */
    missionsAge?: string | null;
    /** What the page lays over the canvas's top: its key. The opening view keeps the Earth out from under it. */
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
  let chipEl = $state<HTMLElement>();
  let controlsEl = $state<HTMLElement>();
  let swatchEl = $state<HTMLElement>();

  let land: Path2D | null = null;
  let provinceLines: Path2D | null = null;
  let provinceShapes: Shape[] = [];
  let countryShapes: Shape[] = [];
  /** What the open missions light: filled, and outlined. Rebuilt only when the missions change. */
  let litFill: Path2D | null = null;
  let litLine: Path2D | null = null;
  let litIds = new Set<string>();
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
  const overlays = (): Overlay[] => [sun, ages, counts].filter((o): o is Overlay => o !== null);

  function pathOf(rings: Shape['rings']): Path2D {
    const p = new Path2D();
    for (const ring of rings) {
      p.moveTo(ring[0]!, ring[1]!);
      for (let i = 2; i < ring.length; i += 2) p.lineTo(ring[i]!, ring[i + 1]!);
      p.closePath();
    }
    return p;
  }

  /**
   * Every mission lands somewhere [lightsOf]. A mission filed under a province lights it where the
   * file has one, and otherwise lights its country, so `ke-30` lights Kenya; a national mission
   * outlines its country, because filling it would light everything. Only what is filled answers a
   * tap ahead of the provinces: an outline would answer for every state inside it.
   */
  function relight() {
    const { fill, outline } = lightsOf(
      active.map((m) => m.placement.jurisdiction),
      new Set(provinceShapes.map((s) => s.id))
    );
    litProvinces = provinceShapes.filter((s) => s.id !== null && fill.has(s.id));
    litCountries = countryShapes.filter((s) => s.id !== null && fill.has(s.id));
    const filled = [...litProvinces, ...litCountries];
    const lined = [...filled, ...countryShapes.filter((s) => s.id !== null && outline.has(s.id))];
    litFill = filled.length > 0 ? pathOf(filled.flatMap((s) => s.rings)) : null;
    litLine = lined.length > 0 ? pathOf(lined.flatMap((s) => s.rings)) : null;
    litIds = fill;
  }

  /**
   * What the last tap or Enter took, lifted in ink while the screen it opened is the one on top of
   * Com, and again when Back returns to it. Touch has no hover, so without this nothing on the map
   * showed a finger what it had taken, and a thumb-wide tap at the whole-Earth view can take a
   * neighbour [LIT_SLOP].
   */
  let picked: { key: string; line: Path2D | null; place: PlaceOfRecord | null } | null = null;
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
  /** Regions with places the map does not draw: their rings stay where the records take over. */
  const held = $derived(directory?.regions.filter((r) => r.kind === 'region' && (r.unmapped ?? 0) > 0) ?? []);

  // The view: which point of the map's rectangle sits at the centre, and how many CSS px its width spans.
  let cx = 0.5;
  let cy = HEIGHT / 2;
  let scale = 0;
  let width = 0;
  let height = 0;
  let dpr = 1;
  /**
   * What lies over the canvas, in CSS px from its top left: the page's key and the map's own controls,
   * measured whenever either changes size. The opening view keeps the Earth out from under them.
   */
  let covers: { l: number; t: number; r: number; b: number }[] = [];
  /**
   * CSS px at the canvas's foot the page covers at the height Com opens to for whatever the map opens,
   * the phone's sheet at half, read from `--map-reach`. The opening view keeps the Earth above it, so
   * what a tap lifts, and the layer the picker draws, are in view while their screen is open.
   */
  let reach = 0;
  /** CSS px at the canvas's foot that the page covers — the phone's sheet at peek — read from `--map-inset`. */
  let inset = 0;
  /**
   * Up to about 20 m a pixel on a phone at 52°N, so a street's records separate. The outlines are
   * 1:10m at best and look it there; what is drawn that close is the records, at the precision
   * their positions earned, and the doorstep is still the handoff's [map.md §5].
   */
  const MAX_ZOOM = 4096;
  /**
   * From here in, a region's ring gives way to its records: about 2.7 km a pixel on a phone, by area,
   * where a region is still many pixels across. A region's centre is a statistic of its records,
   * not a place, and drawn closer in it would sit on one block and read as one (review, 2026-10-18).
   */
  const RECORD_ZOOM = 32;
  /** The Earth's own edge, drawn round it: off it there is nothing, not sea [topology.ts edgeOfEarth]. */
  const earth = edgeOfEarth();
  const edge = typeof Path2D === 'undefined' ? null : pathOf([earth]);

  const view = (): View => ({ cx, cy, scale, width, height });
  /** Where the keyboard's reticle sits: the centre of the part of the canvas nothing covers. */
  const reticle = (): [number, number] => [width / 2, Math.max(0, height - inset) / 2];

  let queued = false;
  function request() {
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
   * Within the world, and when the whole world is shorter than the canvas, wholly on it. The world is
   * one unit wide and `HEIGHT` tall, about half as tall as it is wide [topology.ts project].
   */
  function clamp() {
    scale = Math.min(Math.max(scale, fit()), fit() * MAX_ZOOM);
    const halfW = width / 2 / scale;
    const halfH = height / 2 / scale;
    cx = halfW >= 0.5 ? Math.min(Math.max(cx, 1 - halfW), halfW) : Math.min(Math.max(cx, halfW), 1 - halfW);
    cy = halfH >= HEIGHT / 2 ? Math.min(Math.max(cy, HEIGHT - halfH), halfH) : Math.min(Math.max(cy, halfH), HEIGHT - halfH);
  }

  function token(name: string, fallback: string): string {
    return (canvas && getComputedStyle(canvas).getPropertyValue(name).trim()) || fallback;
  }

  /** Whether the directory's regions are drawn by when they were last checked: over Nation States, while ticked. */
  const agesOn = $derived(mapLayers.chosen === 'nations' && mapLayers.ages);

  /** Whether the records are drawn, rather than their regions' rings: only with Places on. */
  const close = () => places && !!directory && directory.records.length > 0 && scale >= fit() * RECORD_ZOOM;

  /** The directory's places drawn at this zoom: its regions, or closer in with Places on, its records. */
  function directoryShown(): readonly PlaceOfRecord[] {
    if (!directory || !(places || agesOn)) return [];
    return close() ? directory.records : directory.regions;
  }

  /**
   * The points drawn and tappable at this zoom: missions' rings always; with Places on, regions'
   * rings, or closer in the records, with the ring of each region that has places the map does not
   * draw, so a region of held-back shelters reads as that and not as nothing [invariant 7]. With the
   * directory's ages on, the regions' rings without Places too.
   */
  function shownPoints(): readonly PlaceOfRecord[] {
    const shown = directoryShown();
    if (shown.length === 0) return rings;
    return close() ? [...rings, ...shown, ...held] : [...rings, ...shown];
  }

  let focused = $state(false);

  /** The neutrals, read once a frame from what the page now says: Low signature changes every one. */
  function inks(): Ink {
    const style = canvas ? getComputedStyle(canvas) : null;
    const t = (name: string, fallback: string) => style?.getPropertyValue(name).trim() || fallback;
    return {
      ink: t('--t-ink', '#F2F5F8'),
      muted: t('--t-muted', '#9BA5B2'),
      faint: t('--t-faint', '#78828F'),
      line: t('--t-line', '#232B35'),
      strong: t('--t-line-strong', '#38424F'),
      sunk: t('--t-sunk', '#05070A'),
      ground: t('--t-ground', '#0B0E12')
    };
  }

  function draw() {
    queued = false;
    const ctx = canvas?.getContext('2d');
    if (!ctx || width === 0) return;
    const tones = inks();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = tones.ground;
    ctx.fillRect(0, 0, width, height);
    if (!land || !provinceLines) return;

    const ox = width / 2 - cx * scale;
    const oy = height / 2 - cy * scale;
    // The view, where a browser test can read it to tap a place by its longitude and latitude.
    canvas!.dataset.view = `${cx} ${cy} ${scale}`;
    canvas!.dataset.reticle = reticle().join(' ');
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
    ctx.fillStyle = token('--t-raised', '#141920');
    ctx.fill(land, 'evenodd');
    const { ink, muted } = tones;
    if (edge) {
      ctx.lineWidth = 1 / scale;
      ctx.strokeStyle = tones.line;
      ctx.stroke(edge);
    }
    const chosen = mapLayers.chosen;
    const over = overlays();
    drawn?.fill?.(ctx, tones);
    for (const o of over) o.under?.(ctx, scale, tones, edge);
    if (litFill) {
      // A lift in brightness, never a hue: every hue on these screens is a watch state.
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = ink;
      ctx.fill(litFill, 'evenodd');
      ctx.globalAlpha = 1;
    }
    ctx.lineJoin = 'round';
    if (chosen === 'nations' || chosen === 'timezones') {
      // The borders, as ever; faintly under the time zones, for where the bands are.
      if (chosen === 'nations') {
        ctx.lineWidth = 0.6 / scale;
        ctx.strokeStyle = tones.line;
        ctx.stroke(provinceLines);
      }
      ctx.lineWidth = (chosen === 'nations' ? 1 : 0.6) / scale;
      ctx.strokeStyle = chosen === 'nations' ? tones.strong : tones.line;
      ctx.stroke(land);
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

    // Points in screen space, so each is the same size at every zoom.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const v = view();
    const near = close();
    const dots = new Path2D();
    const regionRings = new Path2D();
    const circles = new Path2D();
    // An overlay that draws the directory's points its own way, by when each was checked, draws them here.
    const shown = directoryShown();
    const drewOwn = shown.length > 0 && over.some((o) => o.points?.(ctx, v, tones, shown) === true);
    for (const p of drewOwn ? (near ? [...rings, ...held] : rings) : shownPoints()) {
      const [x, y] = screenAt(v, [p.x, p.y]);
      if (p.kind === 'mission') {
        // A ring the same size on screen, never smaller than what the point's precision covers:
        // a `city` point is an 11 km ring however far in somebody zooms. Equal Earth keeps areas, so
        // a circle on the ground is drawn with its own area wherever it is [METRES_PER_UNIT].
        const r = Math.max(7, (p.metres * scale) / METRES_PER_UNIT);
        if (x < -r || y < -r || x > width + r || y > height + r) continue;
        circles.moveTo(x + r, y);
        circles.arc(x, y, r, 0, Math.PI * 2);
        continue;
      }
      // A region is a hollow ring, larger and dashed where its records are drawn round it, so its
      // centre is never mistaken for a record's dot; a record is a dot.
      const r = p.kind === 'record' ? 2 : near ? 8 : 4;
      if (x < -r || y < -r || x > width + r || y > height + r) continue;
      const path = p.kind === 'record' ? dots : regionRings;
      path.moveTo(x + r, y);
      path.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fillStyle = muted;
    ctx.fill(dots);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = muted;
    if (near) ctx.setLineDash([3, 3]);
    ctx.stroke(regionRings);
    ctx.setLineDash([]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = ink;
    ctx.stroke(circles);
    for (const o of over) o.marks?.(ctx, v, tones);
    ctx.lineWidth = 2;
    ctx.strokeStyle = ink;
    for (const lifted of [hovered?.kind === 'point' ? hovered.place : null, pickedOn ? picked?.place : null]) {
      if (!lifted) continue;
      const [x, y] = screenAt(v, [lifted.x, lifted.y]);
      ctx.beginPath();
      ctx.arc(x, y, lifted.kind === 'mission' ? 11 : lifted.kind === 'region' ? (near ? 12 : 8) : 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (focused) {
      // The keyboard's reticle: what Enter opens is what is under it.
      const [rx, ry] = reticle();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = ink;
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

  // ─── What is under a point, and what it says ──────────────────────────────────────────────

  /**
   * What is under (sx, sy) in the layer chosen: points first in every layer, then a shape a mission
   * fills, within the same slack it has under Nation States, then the layer's own areas. The missions
   * light whichever layer is drawn, and a lit shape is a door in every one of them [map.md §6, §8]. A
   * layer with nothing loaded answers as Nation States, so a tap is never dead.
   */
  function hitAt(sx: number, sy: number): Hit | null {
    if (status !== 'ready') return null;
    const v = view();
    const at: [number, number] = [sx, sy];
    const layer = drawn;
    if (layer) {
      // Given only the lit shapes, `pick` answers a point, then a lit shape, then nothing.
      const first = pick(v, at, { provinces: litProvinces, countries: litCountries, lit: litIds, points: shownPoints() });
      if (first) return first;
      const shape = layer.hit(v, at);
      if (shape !== undefined) return shape ? { kind: 'area', shape } : null;
    }
    return pick(v, at, { provinces: provinceShapes, countries: countryShapes, lit: litIds, points: shownPoints() });
  }

  /** `N open missions` or `Nothing open`, by the codes the missions are filed under. */
  function openAt(code: string | null): string {
    const n = code === null ? 0 : active.filter((m) => filedUnder(m.placement.jurisdiction, code)).length;
    return n === 0 ? 'Nothing open' : n === 1 ? '1 open mission' : `${n} open missions`;
  }

  /** What the layer and the overlays add, each its own phrase: a region's clocks, when it was checked, what is open in a Zone. */
  const also = (said: string, more: (string | null | undefined)[]) => [said, ...more.filter(Boolean)].join(' · ');

  function sayOf(hit: Hit): string {
    if (hit.kind === 'shape') return `${hit.shape.name ?? 'Unnamed'} · ${openAt(hit.shape.id)}`;
    if (hit.kind === 'area') return also(drawn?.say(hit.shape) ?? hit.shape.name ?? 'Unnamed', overlays().map((o) => o.about?.(hit.shape)));
    const p = hit.place;
    if (p.kind === 'mission') return `${p.title} · open mission`;
    const count = (n: number) => `${n} ${n === 1 ? 'place' : 'places'}`;
    if (p.kind === 'region') {
      // Where its records are drawn, a region's ring stands for the ones that are not.
      const said = close() && p.unmapped ? `${p.name} · ${count(p.unmapped)} not on the map` : `${p.name} · ${count(p.records)}`;
      // With Time zones drawn, its own clocks: its IANA zone knows daylight saving, the bands do not.
      return also(said, [drawn?.region?.(p.region), ...overlays().map((o) => o.region?.(p.region))]);
    }
    return also(`A place in ${p.regionName}`, overlays().map((o) => o.region?.(p.region, p.index)));
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

  /** The readout over the map: what is under the pointer, or under the reticle. */
  let chip = $state<{ text: string; x: number; y: number } | null>(null);
  let chipAt = $state<{ left: number; top: number }>({ left: 0, top: 0 });

  function sameHit(a: Hit | null, b: Hit | null): boolean {
    if (!a || !b) return a === b;
    if (a.kind === 'point' || b.kind === 'point') return a.kind === 'point' && b.kind === 'point' && a.place === b.place;
    return a.kind === b.kind && a.shape === b.shape;
  }

  function show(hit: Hit | null, sx: number, sy: number) {
    if (!sameHit(hit, hovered)) {
      hovered = hit;
      hoverLine = hit && hit.kind !== 'point' ? pathOf(hit.shape.rings) : null;
      request();
    }
    chip = hit ? { text: sayOf(hit), x: sx, y: sy } : null;
    if (canvas) canvas.style.cursor = hit && onpick ? 'pointer' : '';
  }

  /**
   * Kept inside the canvas and above what covers its foot, and clear of the zoom controls. Measured
   * once the text is in, so a long name moves left rather than off the edge.
   */
  async function placeChip() {
    await tick();
    if (!chip || !chipEl) return;
    const w = chipEl.offsetWidth;
    const h = chipEl.offsetHeight;
    const pad = 6;
    const floor = Math.max(pad, height - inset - pad);
    let left = Math.min(Math.max(chip.x + 14, pad), width - w - pad);
    let top = Math.min(Math.max(chip.y - h - 10, pad), floor - h);
    if (controlsEl) {
      const c = { l: controlsEl.offsetLeft - pad, t: controlsEl.offsetTop - pad, b: controlsEl.offsetTop + controlsEl.offsetHeight + pad };
      if (left + w > c.l && top < c.b && top + h > c.t) left = Math.max(pad, c.l - w);
    }
    chipAt = { left, top: Math.max(pad, top) };
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
      show(hitAt(...hoverPoint), ...hoverPoint);
      void placeChip();
    });
  }

  /** The reticle's own readout, after every keyboard move: polite, so it never interrupts. */
  function sayReticle() {
    const [rx, ry] = reticle();
    show(hitAt(rx, ry), rx, ry);
    void placeChip();
  }

  function open(sx: number, sy: number) {
    if (!onpick) return;
    const hit = hitAt(sx, sy);
    if (!hit) return;
    const screen = screenOf(hit, sx, sy);
    picked = {
      key: JSON.stringify(screen),
      line: hit.kind !== 'point' ? pathOf(hit.shape.rings) : null,
      place: hit.kind === 'point' ? hit.place : null
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
   * The whole Earth in the part of the canvas nothing covers [decided 2026-10-17; map.md §3, §6]: above
   * the phone's sheet, at half, where every screen the map opens comes up, the layer picker among them,
   * and clear of the page's key and the map's own controls. As wide as the canvas where it can be,
   * centred between the sheet and the highest line it can sit under with nothing over the Earth's own
   * outline: no line at all on a wide screen, where the key and the controls sit in its empty corners. On
   * a phone, where the controls' column runs down the side the world would fill, narrower, in what is
   * left of the controls and below the key, so the whole map is the whole map and stays in view while Com
   * is open. Where that would leave it less than half the screen's width, the same above the sheet at
   * peek; and on a screen too small even for that, full width and as clear of them as it fits. Nothing
   * moves it until a person does.
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
      if (fits >= width / 2) {
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
    if (pointers.size === 1) {
      panBy(now.x - last.x, now.y - last.y);
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
    if (tap?.id === e.pointerId && Math.hypot(e.offsetX - tap.x, e.offsetY - tap.y) < TAP_SLOP) open(e.offsetX, e.offsetY);
    tap = null;
    pointers.delete(e.pointerId);
    pinch = 0;
  }

  function onPointerLeave() {
    hoverPoint = null;
    if (!focused) show(null, 0, 0);
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
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

  /** Measures the canvas and what covers it again: set once the canvas is mounted. */
  let resize = () => {};
  let resized: ResizeObserver | null = null;
  /*
   * The overlays' key comes and goes with them, after the map has mounted: measured while it is there,
   * and measured again once it has gone, so the opening view keeps the Earth clear of it and no longer.
   */
  $effect(() => {
    const el = swatchEl;
    if (!el || !resized) return;
    resized.observe(el);
    return () => {
      resized?.unobserve(el);
      queueMicrotask(resize);
    };
  });

  onMount(() => {
    if (!canvas) return;
    const el = canvas;

    const size = () => {
      const box = el.getBoundingClientRect();
      width = box.width;
      height = box.height;
      inset = Math.min(insetEl?.getBoundingClientRect().height ?? 0, height);
      reach = Math.min(reachEl?.getBoundingClientRect().height ?? 0, height);
      covers = [cover, controlsEl].flatMap((c) => {
        if (!c) return [];
        const r = c.getBoundingClientRect();
        const l = r.left - box.left, t = r.top - box.top;
        return r.width > 0 && r.height > 0 ? [{ l, t, r: l + r.width, b: t + r.height }] : [];
      });
      // A key of the overlays' own goes under the page's, wherever that ends: covering where it is about
      // to be put, not where it was, which a move alone would never say to a size observer.
      const key = cover?.getBoundingClientRect();
      swatchAt = key && key.height > 0 ? { left: key.left - box.left, top: key.bottom - box.top + 6 } : { left: 12, top: 12 };
      const swatch = swatchEl?.getBoundingClientRect();
      if (swatch && swatch.width > 0 && swatch.height > 0) {
        covers.push({ l: swatchAt.left, t: swatchAt.top, r: swatchAt.left + swatch.width, b: swatchAt.top + swatch.height });
      }
      // Capped at 2: a 3x phone would quadruple the pixels filled for no visible gain.
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
      // Until a person moves it, the opening view is the opening view at whatever size this is.
      if (!touched) world();
      clamp();
      request();
    };
    resize = size;
    const observer = new ResizeObserver(size);
    resized = observer;
    observer.observe(el);
    if (insetEl) observer.observe(insetEl);
    if (reachEl) observer.observe(reachEl);
    if (cover) observer.observe(cover);
    if (swatchEl) observer.observe(swatchEl);
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
      .then((topology) => {
        const layers = decode(topology);
        land = pathOf(layers['world']?.rings ?? []);
        provinceLines = pathOf(layers['provinces']?.rings ?? []);
        provinceShapes = layers['provinces']?.shapes ?? [];
        countryShapes = layers['world']?.shapes ?? [];
        layerData.countries = countryShapes;
        relight();
        status = 'ready';
        request();
      })
      .catch(() => {
        status = 'failed';
      });

    return () => {
      observer.disconnect();
      resized = null;
      signature.disconnect();
      el.removeEventListener('wheel', onWheel);
      scheme.removeEventListener('change', request);
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

  // What a layer has loaded is a new picture, and so is what it has open in Com, and the Sphere picked out.
  $effect(() => {
    void mapLayers.loaded;
    void mapLayers.sphere;
    const shape = drawn?.lifted?.(current) ?? null;
    layerOpen = shape ? pathOf(shape.rings) : null;
    request();
  });

  /**
   * What the chosen layer is, where it came from, and how old, on the map itself [invariant 7; D6, D8]:
   * the layer's own words once its code is here, and the map's for a layer whose files or code did not
   * arrive, so a map drawn without its layer never passes for one with nothing in it.
   */
  const failedSay = 'not loaded — it needs one visit with a connection';
  const said = $derived.by(() => {
    void mapLayers.loaded;
    const chosen = mapLayers.chosen;
    const own = chosen === 'zones' ? mapLayers.zones : chosen === 'timezones' ? mapLayers.times : chosen === 'spheres' ? mapLayers.spheres : 'off';
    const lines = [chosen === 'nations' || chosen === 'none' ? '' : own === 'failed' ? `Layer ${failedSay}` : (drawn?.legend() ?? '')];
    // One short line for each overlay, under the layer's, so a taller key pushes the Earth down as little as it can.
    for (const [on, o, state, name] of [
      [daylightDrawn(), sun, mapLayers.sun, 'Day and night'],
      [agesOn, ages, mapLayers.agesFile, 'Regions by last check'],
      [chosen === 'zones', counts, mapLayers.counts, 'Missions by Zone']
    ] as const) {
      if (on) lines.push(state === 'failed' ? `${name} ${failedSay}` : (o?.legend() ?? ''));
    }
    return lines.filter(Boolean).join('\n');
  });
  $effect(() => {
    legend = said ? { layer: mapLayers.chosen, text: said } : null;
  });
  /** The overlays' own key, a row a class, under the page's: only while one draws classes it has to name. */
  const swatches = $derived.by((): readonly Swatch[] => {
    void mapLayers.loaded;
    return overlays().flatMap((o) => o.swatches?.() ?? []);
  });
  let swatchAt = $state({ left: 12, top: 12 });
  /** Night's dots in a swatch, as day and night lays them: a 6 px grid, and its tiles' middles. */
  const NIGHT_DOTS = [[0, 0], [6, 0], [3, 3], [9, 3], [0, 6], [6, 6], [3, 9], [9, 9]].map(([x, y]) => `M${x! + 1} ${y! + 1}h1v1h-1z`).join('');

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
    aria-label="{label}. Arrow keys pan, plus and minus zoom, zero shows the whole map, Enter opens what is under the centre."
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
  <!--
    What is under the pointer or the reticle. A live region, so the keyboard's moves are said; it
    sits before the controls and the page's own layers, so none of them is ever under it.
  -->
  <div class="chip" bind:this={chipEl} role="status" data-chip style:left="{chipAt.left}px" style:top="{chipAt.top}px">{chip?.text ?? ''}</div>
  <!--
    The overlays' own key: what each mark they draw means, drawn as the canvas draws it, under the
    page's key and clear of the Earth [covers]. Present only while something draws classes to name.
  -->
  {#if swatches.length > 0}
    <ul class="swatches" bind:this={swatchEl} data-swatches style:left="{swatchAt.left}px" style:top="{swatchAt.top}px">
      {#each swatches as s (s.text)}
        <li data-swatch={s.mark}>
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" class={s.tone}>
            {#if s.mark === 'square'}<rect x="2" y="2" width="8" height="8" />{:else if s.mark === 'dots'}<path d={NIGHT_DOTS} />{:else}<circle cx="6" cy="6" r={s.mark === 'dot' ? 3.5 : 4.5} />{/if}
          </svg>{s.text}
        </li>
      {/each}
    </ul>
  {/if}
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
  .chip {
    position: absolute;
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
  /* Empty, it is still a live region, so what it says next is heard; it is just not seen. */
  .chip:empty {
    padding: 0;
    border: 0;
  }
  .swatches {
    position: absolute;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    margin: 0;
    padding: 0;
    list-style: none;
    max-width: calc(100% - 6rem);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.7rem;
    color: var(--t-muted);
    pointer-events: none;
  }
  .swatches li {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .swatches svg {
    flex: none;
    stroke-width: 1.5;
  }
  /* As the canvas draws each: a disc and a dot filled, a ring and a square hollow. */
  .swatches .ink { color: var(--t-ink); }
  .swatches .muted { color: var(--t-muted); }
  .swatches .faint { color: var(--t-faint); }
  [data-swatch='disc'] svg,
  [data-swatch='dot'] svg { fill: currentColor; stroke: none; }
  [data-swatch='ring'] svg,
  [data-swatch='square'] svg { fill: none; stroke: currentColor; }
  /* Night's dots, at the spacing the canvas lays them, and as faint. */
  [data-swatch='dots'] svg { fill: currentColor; stroke: none; opacity: 0.8; }
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
