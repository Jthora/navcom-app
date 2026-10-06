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

  /** Where the directory already has a region. */
  let regions = $state<{ lon: number; lat: number }[]>([]);

  /*
   * The missions, as of the last build — read from navcom.app, never from The Record, so looking
   * at the map still tells nobody anything [$lib/missions/snapshot]. Typed loosely and checked
   * here rather than importing core: the page needs two fields, and core's mission module
   * brings the signature library with it.
   */
  type Snapshot = {
    taken_at: string;
    status: 'ok' | 'unavailable';
    missions: { state: string; validUntil: number; placement: { jurisdiction: string | null } }[];
  };
  let snapshot = $state<Snapshot | null>(null);

  /** Re-checked against this device's clock: a mission active at build time may have ended since. */
  const active = $derived(
    (snapshot?.missions ?? []).filter((m) => m.state !== 'closed' && m.validUntil > Date.now() / 1000)
  );
  /** Provinces to light. A national mission (`us`) lights nothing — it would light everything. */
  const lit = $derived(
    new Set(active.map((m) => m.placement.jurisdiction).filter((j): j is string => !!j && j.includes('-')))
  );
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /** Absolute, because a date cannot become false the way "3 hours ago" can. */
  const asOf = $derived.by(() => {
    const t = snapshot ? new Date(snapshot.taken_at) : null;
    if (!t || Number.isNaN(t.getTime())) return '';
    const hh = String(t.getUTCHours()).padStart(2, '0');
    const mm = String(t.getUTCMinutes()).padStart(2, '0');
    return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${hh}:${mm} UTC`;
  });

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
    fetch('/missions.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Snapshot) => {
        snapshot = d;
      })
      .catch(() => {
        snapshot = { taken_at: '', status: 'unavailable', missions: [] };
      });
  });
</script>

<svelte:head>
  <title>Grid · NavCom</title>
  <meta name="description" content="The map NavCom draws itself: country outlines, provinces where it has regions, and every directory region marked. No third-party map, and nothing sent anywhere." />
  <meta name="robots" content="noindex" />
</svelte:head>

<main class="terminal">
  <GridMap marks={regions} highlight={lit} label="World map, with provinces where NavCom has regions, each region marked, and the provinces with an open mission lit" />
  <div class="key">
    <h1><a href="/">NavCom</a> grid</h1>
    <span><i aria-hidden="true"></i>Directory regions</span>
    {#if snapshot}
      {#if snapshot.status === 'unavailable'}
        <strong data-missions="unavailable">Missions unavailable at the last build</strong>
      {:else if active.length === 0}
        <strong data-missions="none">No open missions · as of {asOf}</strong>
      {:else}
        <span data-missions="open"><b class="lit" aria-hidden="true"></b>Open missions · as of {asOf}</span>
      {/if}
    {/if}
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
  .key strong { font-weight: 400; color: var(--t-muted); }
  .key .lit {
    display: inline-block;
    width: 10px;
    height: 10px;
    background: color-mix(in srgb, var(--t-ink) 16%, var(--t-raised));
    border: 1px solid var(--t-muted);
    margin-inline-end: 0.45rem;
    vertical-align: middle;
  }
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
