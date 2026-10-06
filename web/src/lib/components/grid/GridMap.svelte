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
   * Built for the device floor, a prepaid Android 8. Each layer becomes one `Path2D` in map units
   * when the file loads, and a pan or zoom only changes the canvas transform: one matrix and a
   * redraw, never per-frame geometry. Redraws happen on demand, at most once per frame.
   */
  import { onMount } from 'svelte';
  import { decode, mercator, type Layer, type Topology } from '$lib/grid/topology';

  let {
    marks = [],
    highlight = new Set<string>(),
    label = 'Map'
  }: {
    /** Points to draw, in longitude and latitude. Constant size on screen whatever the zoom. */
    marks?: readonly { lon: number; lat: number }[];
    /** Provinces to light, by lower-case ISO 3166-2 code — where a mission is (`us-ca`). */
    highlight?: ReadonlySet<string>;
    /** What the map shows, for anybody who cannot see the canvas. */
    label?: string;
  } = $props();

  let canvas = $state<HTMLCanvasElement>();
  let status = $state<'loading' | 'ready' | 'failed'>('loading');

  let land: Path2D | null = null;
  let provinces: Path2D | null = null;
  let provinceShapes: Layer['shapes'] = [];
  /** The provinces in `highlight`, as one path, rebuilt only when the set changes. */
  let lit: Path2D | null = null;

  function pathOf(rings: Layer['rings']): Path2D {
    const p = new Path2D();
    for (const ring of rings) {
      p.moveTo(ring[0]!, ring[1]!);
      for (let i = 2; i < ring.length; i += 2) p.lineTo(ring[i]!, ring[i + 1]!);
      p.closePath();
    }
    return p;
  }

  function relight() {
    const chosen = provinceShapes.filter((s) => s.id !== null && highlight.has(s.id));
    lit = chosen.length > 0 ? pathOf(chosen.flatMap((s) => s.rings)) : null;
  }
  const projected = $derived(marks.map((m) => mercator(m.lon, m.lat)));

  // The view: which point of the unit square sits at the centre, and how many CSS px it spans.
  let cx = 0.5;
  let cy = 0.4;
  let scale = 0;
  let width = 0;
  let height = 0;
  let dpr = 1;
  /** Data is 1:10m at best. Past this the outlines invent precision; the handoff takes over. */
  const MAX_ZOOM = 64;

  let queued = false;
  function request() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(draw);
  }

  const fit = () => Math.max(width, height * 0.9);

  function clamp() {
    scale = Math.min(Math.max(scale, fit()), fit() * MAX_ZOOM);
    const halfW = width / 2 / scale;
    const halfH = height / 2 / scale;
    cx = halfW >= 0.5 ? 0.5 : Math.min(Math.max(cx, halfW), 1 - halfW);
    cy = halfH >= 0.5 ? 0.5 : Math.min(Math.max(cy, halfH), 1 - halfH);
  }

  function token(name: string, fallback: string): string {
    return (canvas && getComputedStyle(canvas).getPropertyValue(name).trim()) || fallback;
  }

  function draw() {
    queued = false;
    const ctx = canvas?.getContext('2d');
    if (!ctx || width === 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = token('--t-ground', '#0B0E12');
    ctx.fillRect(0, 0, width, height);
    if (!land || !provinces) return;

    const ox = width / 2 - cx * scale;
    const oy = height / 2 - cy * scale;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
    ctx.fillStyle = token('--t-raised', '#141920');
    ctx.fill(land, 'evenodd');
    if (lit) {
      // A lift in brightness, never a hue: every hue on these screens is a watch state.
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = token('--t-ink', '#F2F5F8');
      ctx.fill(lit, 'evenodd');
      ctx.globalAlpha = 1;
    }
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.6 / scale;
    ctx.strokeStyle = token('--t-line', '#232B35');
    ctx.stroke(provinces);
    ctx.lineWidth = 1 / scale;
    ctx.strokeStyle = token('--t-line-strong', '#38424F');
    ctx.stroke(land);
    if (lit) {
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeStyle = token('--t-muted', '#9BA5B2');
      ctx.stroke(lit);
    }

    // Marks in screen space, so a region is the same size at every zoom.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = token('--t-muted', '#9BA5B2');
    ctx.beginPath();
    for (const [mx, my] of projected) {
      const x = mx * scale + ox;
      const y = my * scale + oy;
      if (x < -3 || y < -3 || x > width + 3 || y > height + 3) continue;
      ctx.moveTo(x + 2, y);
      ctx.arc(x, y, 2, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  /** Zoom by `factor`, keeping the point under (sx, sy) where it is. */
  function zoomAt(factor: number, sx = width / 2, sy = height / 2) {
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

  function world() {
    scale = fit();
    cx = 0.5;
    cy = 0.4;
    clamp();
  }

  /**
   * Frames where most of the marks are, and says whether it could.
   *
   * The 5th to 95th percentile, not the bounding box: a handful of distant regions — Hawaii,
   * Australia, the UK — would otherwise stretch the frame straight back out to the whole world,
   * which is the view that opened on Greenwich with most of the US off the edge of a phone. It
   * follows the data, so the frame moves on its own as coverage grows elsewhere.
   */
  function frameMarks(): boolean {
    if (projected.length < 10 || width === 0) return false;
    const xs = projected.map((p) => p[0]).sort((a, b) => a - b);
    const ys = projected.map((p) => p[1]).sort((a, b) => a - b);
    const at = (v: number[], f: number) => v[Math.round(f * (v.length - 1))]!;
    const [x0, x1, y0, y1] = [at(xs, 0.05), at(xs, 0.95), at(ys, 0.05), at(ys, 0.95)];
    const pad = 1.3;
    scale = Math.min(width / Math.max((x1 - x0) * pad, 1e-4), height / Math.max((y1 - y0) * pad, 1e-4));
    cx = (x0 + x1) / 2;
    cy = (y0 + y1) / 2;
    clamp();
    return true;
  }

  /** The whole map, as the button says — and a person asked for it, so it stays there. */
  function reset() {
    touched = true;
    world();
    request();
  }

  // Pointers: one drags, two pinch. Pointer events cover mouse, touch and pen alike.
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;

  function onPointerDown(e: PointerEvent) {
    canvas?.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    }
  }

  function onPointerMove(e: PointerEvent) {
    const last = pointers.get(e.pointerId);
    if (!last) return;
    const now = { x: e.offsetX, y: e.offsetY };
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
    pointers.delete(e.pointerId);
    pinch = 0;
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
      '0': reset
    };
    const act = keys[e.key];
    if (act) {
      e.preventDefault();
      act();
    }
  }

  onMount(() => {
    if (!canvas) return;
    const el = canvas;

    const size = () => {
      const box = el.getBoundingClientRect();
      width = box.width;
      height = box.height;
      // Capped at 2: a 3x phone would quadruple the pixels filled for no visible gain.
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
      if (scale === 0 && !frameMarks()) world();
      clamp();
      request();
    };
    const resized = new ResizeObserver(size);
    resized.observe(el);
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
        provinces = pathOf(layers['provinces']?.rings ?? []);
        provinceShapes = layers['provinces']?.shapes ?? [];
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

  // A different set of provinces to light is a new path and a redraw.
  $effect(() => {
    void highlight;
    relight();
    request();
  });

  // New marks frame the map, until a person has moved it; after that they are only redrawn.
  $effect(() => {
    void projected;
    if (!touched) frameMarks();
    request();
  });
</script>

<div class="grid" data-grid={status}>
  <!--
    The canvas is the map: focusable, labelled, and taking the arrow keys. No role, because the
    two that fit do not survive this project's checker — "img" contradicts being focusable, and
    "application" is not counted as interactive — and this codebase suppresses no warnings. The
    zoom controls beside it are real buttons, so nothing here depends on the keys alone.
  -->
  <canvas
    bind:this={canvas}
    tabindex="0"
    aria-label="{label}. Arrow keys pan, plus and minus zoom, zero shows the whole map."
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onkeydown={onKey}
  ></canvas>
  <div class="controls">
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
  .state {
    position: absolute;
    inset-inline: 1rem;
    inset-block-end: 1rem;
    color: var(--t-ink);
    font-size: 0.9rem;
  }
</style>
