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
   * Built for the device floor, a prepaid Android 8. Each layer becomes one `Path2D` in map units
   * when the file loads, and a pan or zoom only changes the canvas transform: one matrix and a
   * redraw, never per-frame geometry. Redraws happen on demand, at most once per frame.
   */
  import { onMount, tick } from 'svelte';
  import type { Mission } from '@navcom/core';
  import type { Screen } from '$lib/com/screens';
  import { decode, filedUnder, lightsOf, mercator, unmercator, type Shape, type Topology } from '$lib/grid/topology';
  import { LIT_SLOP, pick, screenAt, unitAt, type Hit, type View } from '$lib/grid/pick';
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
     * Something on the map was tapped, or chosen by keyboard: the screen that opens it. A shortcut,
     * never the only way in — whatever opens from here is also reachable without the map, by
     * keyboard and screen reader alike.
     */
    onpick?: (screen: Screen) => void;
  } = $props();

  let canvas = $state<HTMLCanvasElement>();
  let insetEl = $state<HTMLElement>();
  let chipEl = $state<HTMLElement>();
  let controlsEl = $state<HTMLElement>();

  let land: Path2D | null = null;
  let provinceLines: Path2D | null = null;
  let provinceShapes: Shape[] = [];
  let countryShapes: Shape[] = [];
  /** What the open missions light: filled, and outlined. Rebuilt only when the missions change. */
  let litFill: Path2D | null = null;
  let litLine: Path2D | null = null;
  let litIds = new Set<string>();
  /** The shape under the pointer or the reticle, lifted by its outline and never by a hue. */
  let hovered: Hit | null = null;
  let hoverLine: Path2D | null = null;

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
    const all = [...provinceShapes, ...countryShapes];
    const filled = all.filter((s) => s.id !== null && fill.has(s.id));
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
  const rings = $derived(placesOfMissions(active));
  /** Regions with places the map does not draw: their rings stay where the records take over. */
  const held = $derived(directory?.regions.filter((r) => r.kind === 'region' && (r.unmapped ?? 0) > 0) ?? []);

  // The view: which point of the unit square sits at the centre, and how many CSS px it spans.
  let cx = 0.5;
  let cy = 0.5;
  let scale = 0;
  let width = 0;
  let height = 0;
  let dpr = 1;
  /** CSS px at the canvas's foot that the page covers — the phone's sheet at peek — read from `--map-inset`. */
  let inset = 0;
  /**
   * Up to about 15 m a pixel on a phone at 52°N, so a street's records separate. The outlines are
   * 1:10m at best and look it there; what is drawn that close is the records, at the precision
   * their positions earned, and the doorstep is still the handoff's [map.md §5].
   */
  const MAX_ZOOM = 4096;
  /**
   * From here in, a region's ring gives way to its records: about 2 km a pixel on a phone at 52°N,
   * where a region is still many pixels across. A region's centre is a statistic of its records,
   * not a place, and drawn closer in it would sit on one block and read as one (review, 2026-10-18).
   */
  const RECORD_ZOOM = 32;
  /** The land band in the file, 75°N to 56°S, which the opening view centres in what nothing covers. */
  const LAND_MID = (mercator(0, 75)[1] + mercator(0, -56)[1]) / 2;

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
   * screen.
   */
  const fit = () => width;

  /** Within the world, and when the whole world is shorter than the canvas, wholly on it. */
  function clamp() {
    scale = Math.min(Math.max(scale, fit()), fit() * MAX_ZOOM);
    const halfW = width / 2 / scale;
    const halfH = height / 2 / scale;
    cx = halfW >= 0.5 ? 0.5 : Math.min(Math.max(cx, halfW), 1 - halfW);
    cy = halfH >= 0.5 ? Math.min(Math.max(cy, 1 - halfH), halfH) : Math.min(Math.max(cy, halfH), 1 - halfH);
  }

  function token(name: string, fallback: string): string {
    return (canvas && getComputedStyle(canvas).getPropertyValue(name).trim()) || fallback;
  }

  /** Whether the records are drawn, rather than their regions' rings. */
  const close = () => !!directory && directory.records.length > 0 && scale >= fit() * RECORD_ZOOM;

  /**
   * The points drawn and tappable at this zoom: missions' rings always; with Places on, regions'
   * rings, or closer in the records, with the ring of each region that has places the map does not
   * draw, so a region of held-back shelters reads as that and not as nothing [invariant 7].
   */
  function shownPoints(): readonly PlaceOfRecord[] {
    if (!places || !directory) return rings;
    return close() ? [...rings, ...directory.records, ...held] : [...rings, ...directory.regions];
  }

  let focused = $state(false);

  function draw() {
    queued = false;
    const ctx = canvas?.getContext('2d');
    if (!ctx || width === 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = token('--t-ground', '#0B0E12');
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
    const ink = token('--t-ink', '#F2F5F8');
    const muted = token('--t-muted', '#9BA5B2');
    if (litFill) {
      // A lift in brightness, never a hue: every hue on these screens is a watch state.
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = ink;
      ctx.fill(litFill, 'evenodd');
      ctx.globalAlpha = 1;
    }
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.6 / scale;
    ctx.strokeStyle = token('--t-line', '#232B35');
    ctx.stroke(provinceLines);
    ctx.lineWidth = 1 / scale;
    ctx.strokeStyle = token('--t-line-strong', '#38424F');
    ctx.stroke(land);
    if (litLine) {
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeStyle = muted;
      ctx.stroke(litLine);
    }
    for (const line of [hoverLine, pickedOn ? picked?.line : null]) {
      if (!line) continue;
      ctx.lineWidth = 2 / scale;
      ctx.strokeStyle = ink;
      ctx.stroke(line);
    }

    // Points in screen space, so each is the same size at every zoom.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const v = view();
    const near = close();
    const dots = new Path2D();
    const regionRings = new Path2D();
    const circles = new Path2D();
    for (const p of shownPoints()) {
      const [x, y] = screenAt(v, [p.x, p.y]);
      if (p.kind === 'mission') {
        // A ring the same size on screen, never smaller than what the point's precision covers:
        // a `city` point is an 11 km ring however far in somebody zooms.
        const r = Math.max(7, (p.metres * scale) / (40_075_017 * Math.cos((p.lat * Math.PI) / 180)));
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

  function hitAt(sx: number, sy: number): Hit | null {
    if (status !== 'ready') return null;
    return pick(view(), [sx, sy], { provinces: provinceShapes, countries: countryShapes, lit: litIds, points: shownPoints() });
  }

  /** `N open missions` or `Nothing open`, by the codes the missions are filed under. */
  function openAt(code: string | null): string {
    const n = code === null ? 0 : active.filter((m) => filedUnder(m.placement.jurisdiction, code)).length;
    return n === 0 ? 'Nothing open' : n === 1 ? '1 open mission' : `${n} open missions`;
  }

  function sayOf(hit: Hit): string {
    if (hit.kind === 'shape') return `${hit.shape.name ?? 'Unnamed'} · ${openAt(hit.shape.id)}`;
    const p = hit.place;
    if (p.kind === 'mission') return `${p.title} · open mission`;
    const count = (n: number) => `${n} ${n === 1 ? 'place' : 'places'}`;
    // Where its records are drawn, a region's ring stands for the ones that are not.
    if (p.kind === 'region') return close() && p.unmapped ? `${p.name} · ${count(p.unmapped)} not on the map` : `${p.name} · ${count(p.records)}`;
    return `A place in ${p.regionName}`;
  }

  /**
   * What a hit opens in Com. A shape opens as the place tapped, with where the tap landed to what
   * this zoom resolves: a thumb's width, which at the whole-Earth view on a phone is the better part
   * of a thousand kilometres, so `at` keeps whole degrees there and never finer than 0.1° anywhere,
   * and `within` says how far off it may be, so the place screen measures nothing more finely.
   */
  function screenOf(hit: Hit, sx: number, sy: number): Screen {
    if (hit.kind === 'shape') {
      const [lon, lat] = unmercator(...unitAt(view(), [sx, sy]));
      const deg = (LIT_SLOP * 360) / scale;
      const d = deg >= 1 ? 0 : 1;
      const within = String(Math.max(1, Math.round(deg * 111.32 * Math.cos((lat * Math.PI) / 180))));
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
    if (a.kind === 'shape' && b.kind === 'shape') return a.shape === b.shape;
    return a.kind === 'point' && b.kind === 'point' && a.place === b.place;
  }

  function show(hit: Hit | null, sx: number, sy: number) {
    if (!sameHit(hit, hovered)) {
      hovered = hit;
      hoverLine = hit?.kind === 'shape' ? pathOf(hit.shape.rings) : null;
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
      line: hit.kind === 'shape' ? pathOf(hit.shape.rings) : null,
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

  /**
   * The whole Earth, with its land centred in the part of the canvas nothing covers: above the
   * phone's sheet at peek, or the whole canvas beside the wide screen's sidebar. NavCom is an Earth
   * Alliance app and opens on the Earth [decided 2026-10-17; map.md §6]. Nothing moves it until a
   * person does.
   */
  function world() {
    scale = fit();
    cx = 0.5;
    cy = LAND_MID + inset / 2 / scale;
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

  onMount(() => {
    if (!canvas) return;
    const el = canvas;

    const size = () => {
      const box = el.getBoundingClientRect();
      width = box.width;
      height = box.height;
      inset = Math.min(insetEl?.getBoundingClientRect().height ?? 0, height);
      // Capped at 2: a 3x phone would quadruple the pixels filled for no visible gain.
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
      // Until a person moves it, the opening view is the opening view at whatever size this is.
      if (!touched) world();
      clamp();
      request();
    };
    const resized = new ResizeObserver(size);
    resized.observe(el);
    if (insetEl) resized.observe(insetEl);
    size();

    // Wheel must be non-passive to stop the page scrolling under the map.
    el.addEventListener('wheel', onWheel, { passive: false });
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', request);

    fetch('/grid/world.json')
      .then((r) => (r.ok ? (r.json() as Promise<Topology>) : Promise.reject(new Error(String(r.status)))))
      .then((topology) => {
        const layers = decode(topology);
        land = pathOf(layers['world']?.rings ?? []);
        provinceLines = pathOf(layers['provinces']?.rings ?? []);
        provinceShapes = layers['provinces']?.shapes ?? [];
        countryShapes = layers['world']?.shapes ?? [];
        relight();
        status = 'ready';
        request();
      })
      .catch(() => {
        status = 'failed';
      });

    return () => {
      resized.disconnect();
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
  $effect(() => {
    if (!places || directoryAsked) return;
    directoryAsked = true;
    placesStatus = 'loading';
    const json = <T,>(url: string) => fetch(url).then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(new Error(url))));
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

  // New missions are a new picture; Places on or off is too.
  $effect(() => {
    void active;
    relight();
    request();
  });
  $effect(() => {
    void places;
    void rings;
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
  <!--
    What is under the pointer or the reticle. A live region, so the keyboard's moves are said; it
    sits before the controls and the page's own layers, so none of them is ever under it.
  -->
  <div class="chip" bind:this={chipEl} role="status" data-chip style:left="{chipAt.left}px" style:top="{chipAt.top}px">{chip?.text ?? ''}</div>
  <div class="controls" bind:this={controlsEl}>
    <button type="button" aria-label="Zoom in" onclick={() => zoomAt(1.5)}>+</button>
    <button type="button" aria-label="Zoom out" onclick={() => zoomAt(1 / 1.5)}>−</button>
    <button type="button" aria-label="Show the whole map" onclick={reset}>⌂</button>
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
