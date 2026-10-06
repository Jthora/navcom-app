<script lang="ts">
  import '$lib/terminal/tokens.css';
  import { onMount } from 'svelte';
  import GridMap from '$lib/components/grid/GridMap.svelte';
  import type { ConsoleCentroid } from '$lib/console/types';
  import { get } from '$lib/terminal/storage';

  /*
   * Low signature, read the way the console reads it — and copied rather than imported for the
   * console's own reason: `$lib/terminal/signature` pulls the whole crypto stack through a default
   * parameter the bundler cannot shake out (measured there at 71.8 kB). A device set to low must
   * never be shown this map at full brightness. Temporary, like this route: 11.3 moves the map onto
   * the console, which already has these lines.
   */
  function readSignature(): 'low' | 'document' {
    const stored = get<string>('accruing', 'signature');
    if (stored === 'low' || stored === 'document') return stored;
    if (window.matchMedia?.('(prefers-contrast: more)')?.matches) return 'document';
    return get('accruing', 'secret') ? 'low' : 'document';
  }

  /** Where the directory already has a region — the honest content until missions exist. */
  let regions = $state<{ lon: number; lat: number }[]>([]);

  onMount(() => {
    // The same flag the console and the terminal raise once their handlers are attached, so a
    // test (or a fast thumb) never reaches a zoom button before it is wired. [e2e/device.ts]
    document.documentElement.dataset.signature = readSignature();
    document.documentElement.dataset.hydrated = 'true';
    fetch('/console-regions.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { centroids: ConsoleCentroid[] }) => {
        regions = d.centroids.map((c) => ({ lon: c.lon, lat: c.lat }));
      })
      // The outlines still draw; a missing layer of dots is not worth a failure state.
      .catch(() => undefined);
  });
</script>

<svelte:head>
  <title>Grid · NavCom</title>
  <meta name="description" content="The map NavCom draws itself: country outlines, provinces where it has regions, and every directory region marked. No third-party map, and nothing sent anywhere." />
  <meta name="robots" content="noindex" />
</svelte:head>

<main class="terminal">
  <GridMap marks={regions} label="World map, with provinces where NavCom has regions, and each region marked" />
  <div class="key">
    <h1><a href="/">NavCom</a> grid</h1>
    <span><i aria-hidden="true"></i>Directory regions</span>
    <a class="notice" href="/notice/">Notice</a>
  </div>
</main>

<style>
  :global(html, body) { height: 100%; margin: 0; background: var(--t-ground); }
  main {
    position: fixed;
    inset: 0;
    padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px)
      env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
  }
  .key {
    position: absolute;
    inset-inline-start: calc(0.75rem + env(safe-area-inset-left, 0px));
    inset-block-start: calc(0.75rem + env(safe-area-inset-top, 0px));
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.75rem;
    color: var(--t-muted);
  }
  .key h1 { margin: 0; font-size: 0.8rem; font-weight: 400; color: var(--t-muted); letter-spacing: 0.08em; }
  .key h1 a { color: var(--t-ink); text-decoration: none; font-weight: 700; }
  .key .notice { color: var(--t-muted); }
  .key i {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--t-muted);
    margin-inline-end: 0.45rem;
    vertical-align: middle;
  }
</style>
