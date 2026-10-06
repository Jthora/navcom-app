<script lang="ts">
  import '$lib/terminal/tokens.css';
  import { onMount } from 'svelte';
  import GridMap from '$lib/components/grid/GridMap.svelte';
  import type { ConsoleCentroid } from '$lib/console/types';
  import type { Feed } from '$lib/missions/live';
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
   * Missions, read live by this device from The Record [$lib/missions/live] — loaded after first
   * paint, because verifying signatures brings a library the outlines do not need.
   */
  let feed = $state<Feed>({ status: 'connecting' });
  /** Ticks each minute, so a mission that ends while the page is open stops being lit. */
  let now = $state(Date.now());

  const active = $derived(
    feed.status === 'live' || feed.status === 'cached'
      ? feed.missions.filter((m) => m.state !== 'closed' && m.validUntil > now / 1000)
      : []
  );
  /** Provinces to light. A national mission (`us`) lights nothing — it would light everything. */
  const lit = $derived(
    new Set(active.map((m) => m.placement.jurisdiction).filter((j): j is string => !!j && j.includes('-')))
  );
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /** Absolute, because a date cannot become false the way "3 hours ago" can. */
  const stamp = (t: Date) =>
    `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')} UTC`;
  const age = $derived(feed.status === 'live' ? 'live' : feed.status === 'cached' ? `as of ${stamp(feed.at)}, offline` : '');

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
    let stop: (() => void) | null = null;
    let gone = false;
    void import('$lib/missions/live').then(({ subscribeMissions }) => {
      if (!gone) stop = subscribeMissions((f) => (feed = f));
    });
    const tick = setInterval(() => (now = Date.now()), 60_000);
    return () => {
      gone = true;
      stop?.();
      clearInterval(tick);
    };
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
    {#if feed.status === 'connecting'}
      <strong data-missions="connecting">Reaching The Record…</strong>
    {:else if feed.status === 'unavailable'}
      <strong data-missions="unavailable">Missions unavailable — The Record cannot be reached</strong>
    {:else if active.length === 0}
      <strong data-missions="none" data-feed={feed.status}>No open missions · {age}</strong>
    {:else}
      <span data-missions="open" data-feed={feed.status}><b class="lit" aria-hidden="true"></b>Open missions · {age}</span>
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
