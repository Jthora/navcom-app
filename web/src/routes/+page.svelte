<script lang="ts">
  /**
   * The root console. Not a page about NavCom — Nav and Com, fused, working the instant you
   * land: a real search over the real directory (Nav) beside the real, derived state of the
   * network (Com) [docs/positioning.md: "NavCom fuses them into one post."].
   *
   * A search box here, where `/terminal/query/` and `/terminal/directory/` both refuse one on
   * purpose ("Query goes to the watch... someone with a console and both hands free does the
   * lookup, and that division of labour is the product"). Those screens are for an operator
   * mid-shift with both hands full; this is for someone deciding whether this is worth their
   * trust at all, with a keyboard in front of them. The two are allowed to differ on purpose.
   */
  import { onMount, tick } from 'svelte';
  import '$lib/terminal/tokens.css';
  import '$lib/terminal/screen.css';
  import '$lib/terminal/panel.css';
  import { Panel, Slot, Readout, Why } from '$lib/components/panel';
  import { search, type ConsoleHit } from '$lib/console/search';
  import type {
    ConsoleRecordEntry, ConsoleCentroid, ConsoleRegionFigures
  } from '$lib/console/types';
  import { locateOnce, nearest } from '$lib/console/position-once';
  import { get, set } from '$lib/terminal/storage';
  import type { Feed } from '$lib/missions/live';
  import type GridMapType from '$lib/components/grid/GridMap.svelte';

  /**
   * A local, deliberately-not-imported equivalent of $lib/terminal/signature's own
   * apply()/setSignature() — importing them (even just these two, not `signature()` itself)
   * still pulled in the full crypto stack, because `apply`'s own default parameter is
   * `signature()`, and a bundler can't tree-shake a function whose default-argument
   * expression calls something. Confirmed by measuring: 71.8kB with the import, unchanged
   * from before the fix that was supposed to remove it. These two lines are all this page
   * actually needs from that module.
   */
  function applySignature(value: 'low' | 'document'): void {
    document.documentElement.dataset.signature = value;
  }
  function setSignature(value: 'low' | 'document'): void {
    set('accruing', 'signature', value);
    applySignature(value);
  }

  let { data } = $props();
  let sig = $state<'low' | 'document'>('document');

  let query = $state('');
  /**
   * What the search can currently see.
   *
   * Regions always; one region's records once they have arrived. The scope is a value rather
   * than a module global so the screen can say plainly which of the two it just searched --
   * a search that quietly covers less than a person assumes is worse than one that covers
   * less and says so.
   */
  let loaded = $state<{ region: string; name: string; entries: ConsoleRecordEntry[] } | null>(null);

  /**
   * Centroids and figures, fetched rather than embedded.
   *
   * Neither is needed for the first keystroke -- a centroid only once a location fix returns,
   * figures only once a region is focused. At 1,912 regions they were 402 kB of inline data
   * on a page with a 120 kB budget. `regionList` (slug and name) stays in the page so search
   * works immediately; this arrives a moment later.
   *
   * A failed fetch is a silent no-op: search still works, the Network panel simply stays
   * network-wide instead of narrowing to one area.
   */
  let centroids = $state<ConsoleCentroid[]>([]);
  let figures = $state<Record<string, ConsoleRegionFigures>>({});

  /*
   * Nav: the map, filling the screen behind Com [docs/design/map.md, com.md].
   *
   * Loaded after first paint. The map cannot draw until its 55 kB of geometry arrives anyway,
   * so fetching its code in parallel costs nothing a person can see — and keeps this page's
   * first-paint script inside the budget that has kept the front door fast.
   */
  let GridMap = $state<typeof GridMapType | null>(null);
  /**
   * Set when the map's or the missions' code did not arrive. Both come by dynamic import, so on a
   * first visit — before the service worker holds them — either can fail, and without these the
   * page would sit at a blank map and "Reaching The Record…" for as long as it is open [com.md §6].
   */
  let mapUnloaded = $state(false);
  let missionsUnloaded = $state(false);
  /** Where the regions are: what the map opens on, whether or not it draws them. */
  const regionPoints = $derived(centroids.map((c) => ({ lon: c.lon, lat: c.lat })));
  /** Coverage is one switch away; missions are what the map opens on [map.md §6]. */
  let coverage = $state(false);

  /** Missions, read live by this device from The Record [$lib/missions/live]. */
  let feed = $state<Feed>({ status: 'connecting' });
  /** Ticks each minute, so a mission that ends while the page is open stops being lit. */
  let now = $state(Date.now());
  const active = $derived(
    feed.status === 'live' || feed.status === 'cached'
      ? feed.missions.filter((m) => m.state !== 'closed' && m.validUntil > now / 1000)
      : []
  );
  /** What is still open, by address: a claim on a mission closed early holds no place in the cap. */
  const openSet = $derived(new Set(active.map((m) => m.address)));
  /** Provinces to light. A national mission (`us`) lights nothing — it would light everything. */
  const lit = $derived(
    new Set(active.map((m) => m.placement.jurisdiction).filter((j): j is string => !!j && j.includes('-')))
  );
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const stamp = (t: Date) =>
    `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')} UTC`;
  const missionAge = $derived(
    feed.status === 'live' ? 'live' : feed.status === 'cached' ? `as of ${stamp(feed.at)}, offline` : ''
  );
  /** Packages NavCom would not show: counted in the key, so a dark map is never mistaken for a quiet night. */
  const refused = $derived(feed.status === 'live' || feed.status === 'cached' ? feed.refused : []);
  const clockBehind = $derived((feed.status === 'live' || feed.status === 'cached') && feed.clockBehind);

  /*
   * Com, on a phone, is a sheet over the map with three heights [com.md §3]: peek shows the
   * search, so somebody who needs a bed tonight can type at once; half shows results; full
   * shows everything. On a wide screen it is a sidebar and the heights do not apply.
   */
  type Detent = 'peek' | 'half' | 'full';
  let detent = $state<Detent>('peek');
  const NEXT: Record<Detent, Detent> = { peek: 'half', half: 'full', full: 'peek' };
  let dragFrom: number | null = null;
  function grabDown(e: PointerEvent) {
    dragFrom = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function grabUp(e: PointerEvent) {
    if (dragFrom === null) return;
    const dy = e.clientY - dragFrom;
    dragFrom = null;
    if (dy < -40) detent = detent === 'peek' ? 'half' : 'full';
    else if (dy > 40) detent = detent === 'full' ? 'half' : 'peek';
    else detent = NEXT[detent];
  }
  /** Typing should show what it finds: the search lifts the sheet to half. */
  const lift = () => {
    if (detent === 'peek') detent = 'half';
  };

  /**
   * Com is a navigation stack whose root is the search [com.md §1, §2]. Missions are its first
   * screens: the list, narrowed to a province when one is tapped, and one mission.
   */
  type Screen =
    | { kind: 'missions'; province: string | null }
    | { kind: 'mission'; address: string }
    | { kind: 'yours' }
    | { kind: 'report'; address: string }
    | { kind: 'reports'; address: string };
  let stack = $state<Screen[]>([]);
  const top = $derived(stack.at(-1) ?? null);
  /** Loaded the first time a screen opens: code first paint never needs [com.md §6]. */
  let screens = $state<typeof import('$lib/components/missions') | null>(null);
  let screensUnloaded = $state(false);
  let screenEl = $state<HTMLElement>();
  let comEl = $state<HTMLElement>();
  /** Escape steps back, when focus is in Com: anywhere else it belongs to whatever has it. */
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && stack.length > 0 && comEl?.contains(document.activeElement)) back();
  }

  /** Open a screen. A mission opens with the map still in view: half, never full [com.md §7]. */
  async function open(s: Screen, fresh = false) {
    stack = fresh ? [s] : [...stack, s];
    if (detent === 'peek') detent = 'half';
    if (!screens) {
      screensUnloaded = false;
      try {
        screens = await import('$lib/components/missions');
      } catch {
        screensUnloaded = true;
      }
    }
    // Where a keyboard or screen reader goes next: the screen that just opened.
    await tick();
    screenEl?.focus();
  }
  function back() {
    stack = stack.slice(0, -1);
  }

  /**
   * Signed on, Com's root opens on your own situation first [com.md §2]. Read straight from this
   * device's storage, so first paint carries no claims code: the screens load when opened.
   */
  let operator = $state(false);
  const holding = $derived.by(() => {
    void stack;
    if (!operator) return 0;
    const t = Math.floor(now / 1000);
    return (get<{ ends: number }[]>('wipeable', 'mission_claims') ?? []).filter((h) => h.ends > t).length;
  });

  /**
   * Fetch one region's records so the search can see them.
   *
   * Driven by whichever of the two ways the visitor told us where they are -- the one-shot
   * location fix, or the region they picked by hand. **Picking by hand must not buy less than
   * allowing location**, which is the trap in offering both: the manual control existed for
   * "geolocation said no", and it would have been the weaker path.
   *
   * A failed fetch is a silent no-op, exactly as a denied location is. The search still covers
   * every region, and a console that announced a missing index would be reporting its own
   * plumbing to somebody deciding whether to trust the project.
   */
  async function loadRegionIndex(region: string, name: string): Promise<void> {
    if (loaded?.region === region) return;
    try {
      const res = await fetch(`/console-index/${region}.json`);
      if (!res.ok) return;
      loaded = { region, name, entries: (await res.json()) as ConsoleRecordEntry[] };
    } catch {
      /* offline, blocked, or gone: regions still search */
    }
  }

  $effect(() => {
    if (!manualRegion) return;
    const r = regionList.find((x) => x.region === manualRegion);
    if (r) void loadRegionIndex(r.region, r.name);
  });
  /** `regionFigures` is keyed by slug; the search wants them in a stable order. */
  /*
   * Search runs off the embedded [slug, name] pairs; `records` comes from `figures` once it
   * lands, and reads 0 until then rather than blocking the search on a fetch.
   */
  const regionList = $derived(
    (data.regionList as [string, string][]).map(([region, name]) => ({
      region, name,
      records: figures[region]?.records ?? 0,
      confirmedByPerson: figures[region]?.confirmedByPerson ?? 0,
      freshest: figures[region]?.freshest ?? null,
      languages: figures[region]?.languages ?? ['en']
    }))
  );
  const typed = $derived(search({ regions: regionList, loaded }, query));

  let nearRegion = $state<ConsoleCentroid | null>(null);
  /*
   * What is shown before anybody types: the nearest region's own places, once loaded.
   *
   * Previously sliced out of the embedded all-records index. That index is gone -- the loaded
   * region *is* the nearest region, so this is the same list from the file that replaced it.
   */
  const defaultResults = $derived<ConsoleHit[]>(
    loaded
      ? loaded.entries.slice(0, 30).map((e) => ({
          kind: 'record' as const,
          id: e.id,
          name: e.name,
          type: e.type,
          region: loaded!.region,
          regionName: loaded!.name,
          ...(e.abroad ? { abroad: e.abroad } : {})
        }))
      : []
  );
  const results = $derived(query.trim() ? typed : defaultResults);

  /** For when geolocation is denied or absent and nothing has been typed yet. */
  let manualRegion = $state('');
  /*
   * From the embedded list, not from `figures`.
   *
   * This derived from `figures`, which arrives by `fetch` — so the picker shipped in the
   * prerendered HTML containing nothing but "Not now", under a label asking the reader to
   * *"pick a region"*. It filled in a moment later if the fetch succeeded, and never if it
   * did not. A control offered to somebody with no options in it is the failure this project
   * names after `panicWipe`, introduced here while fixing a budget problem: moving the
   * figures out of the page was right, and this rode along with it.
   *
   * `regionList` is the [slug, name] pairs that stay embedded precisely so search works with
   * nothing fetched, and slug and name are all a picker needs. Records and freshness still
   * come from `figures` when they arrive; choosing a region does not wait on them.
   */
  const regionOptions = $derived(
    [...regionList].sort((a, b) => a.name.localeCompare(b.name))
  );

  /**
   * The one thing Nav and Com actually share — searching or being placed somewhere changes
   * what Com reports, in the same glance. Priority: a live search result names the most
   * specific intent; a manual pick is deliberate; geolocation is the passive default.
   */
  const focusedRegionSlug = $derived.by(() => {
    if (query.trim() && typed.length > 0) return typed[0].region;
    if (manualRegion) return manualRegion;
    if (nearRegion) return nearRegion.region;
    return null;
  });
  const focusedFigures = $derived(
    focusedRegionSlug ? (figures[focusedRegionSlug] ?? null) : null
  );

  interface Health {
    commit: string | null;
    clean: boolean | null;
    built_on: 'ci' | 'local';
    suites: { ran: string; counts: { passed: number; total: number } | null };
  }
  let health = $state<Health | null>(null);
  let healthTried = $state(false);

  /**
   * Same rule as $lib/terminal/signature's own `signature()`/`defaultSignature()`,
   * reimplemented rather than imported: that function's fallback path calls `loadIdentity()`,
   * which pulls in the full crypto stack (~20kB gzipped) just to check whether a secret is
   * stored — a real, measured budget regression (49.7kB -> 71.6kB) for a check this page only
   * needs the boolean answer to. A raw storage read of the same field answers "does an
   * identity exist" without deriving the keypair itself.
   */
  function readSignature(): 'low' | 'document' {
    const stored = get<string>('accruing', 'signature');
    if (stored === 'low' || stored === 'document') return stored;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-contrast: more)')?.matches) {
      return 'document';
    }
    return get('accruing', 'secret') ? 'low' : 'document';
  }

  onMount(() => {
    // Same marker `/terminal/*` sets — this page is prerendered then hydrated too, and a
    // test (or a person) that raced the gap rather than waited for it is the failure mode
    // that convention exists to prevent (see e2e/device.ts's `open()`).
    document.documentElement.dataset.hydrated = 'true';
    // Applied before anything else, same as the terminal layout — a device already set to
    // low signature must never show a frame at full brightness first. This page previously
    // never read the preference at all, so a visitor who set it inside /terminal/ and later
    // landed back on / (the brand link, a bookmark) silently lost it here.
    sig = readSignature();
    applySignature(sig);
    void (async () => {
      try {
        const res = await fetch('/console-regions.json');
        if (res.ok) {
          const j = (await res.json()) as {
            centroids: ConsoleCentroid[];
            figures: Record<string, ConsoleRegionFigures>;
          };
          centroids = j.centroids;
          figures = j.figures;
        }
      } catch {
        /* offline or blocked: search still works off the embedded list */
      }
    })();

    void locateOnce().then(async (fix) => {
      if (fix) nearRegion = nearest(fix, centroids);
      /*
       * Load the one region's records the visitor is most likely to test us on.
       *
       * A failed fetch is a silent no-op, exactly as a denied location is: the search still
       * covers every region, and a console that shouted about a missing index would be
       * reporting its own plumbing to somebody deciding whether to trust the project.
       */
      if (nearRegion) await loadRegionIndex(nearRegion.region, nearRegion.name);
    });
    /*
     * Bounded, because a fetch that *hangs* is the case this readout is worst at.
     *
     * A failure resolves honestly to "Unreachable" — both `.then` and `.catch` set
     * `healthTried`. A hang sets nothing, and the panel reads "Checking…" for as long as the
     * page is open. On a captive portal or a dead cell, which is exactly the first-visit
     * case, that is a pending state that never resolves and reads as a fact still arriving.
     */
    const healthTimeout = new AbortController();
    const healthGaveUp = setTimeout(() => healthTimeout.abort(), 8_000);
    void fetch('/.well-known/navcom-health.json', { signal: healthTimeout.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        health = j;
        healthTried = true;
      })
      .catch(() => {
        healthTried = true;
      })
      .finally(() => clearTimeout(healthGaveUp));

    /*
     * An operator on this device gets Distress, in its own layer that nothing covers
     * [com.md §4]. The prerendered bar is revealed by the bootstrap before the bundle arrives
     * [hooks.server.ts]; this repeats it for a device that signed on after that ran.
     */
    if (get('accruing', 'secret')) document.getElementById('distress-early')?.removeAttribute('hidden');
    operator = !!get('accruing', 'secret');

    /*
     * Somebody left a mission to sign on so they could take part [TakePart.svelte]: now that there
     * is somebody on this device, the mission they chose opens again, once.
     */
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem('navcom.pending-mission');
      if (pending && get('accruing', 'secret')) sessionStorage.removeItem('navcom.pending-mission');
      else pending = null;
    } catch {
      pending = null;
    }
    if (pending) void open({ kind: 'mission', address: pending }, true);

    void import('$lib/components/grid/GridMap.svelte')
      .then((m) => (GridMap = m.default))
      .catch(() => (mapUnloaded = true));
    let stopMissions: (() => void) | null = null;
    let gone = false;
    void import('$lib/missions/live')
      .then(({ subscribeMissions }) => {
        if (!gone) stopMissions = subscribeMissions((f) => (feed = f));
      })
      .catch(() => (missionsUnloaded = true));
    const tick = setInterval(() => (now = Date.now()), 60_000);
    return () => {
      gone = true;
      stopMissions?.();
      clearInterval(tick);
    };
  });

  /**
   * Computed from the visitor's own clock, not baked in at build time — this page hydrates,
   * so unlike the zero-JS site it can say "3 days ago" honestly instead of freezing a relative
   * age at whatever moment it was built [invariant 9].
   */
  function daysAgo(iso: string): string {
    const then = new Date(iso + 'T00:00:00Z').getTime();
    const days = Math.floor((Date.now() - then) / 86_400_000);
    /*
     * A negative age is not "today", it is a check dated in this device's future -- which
     * means the clock is wrong, and `FUTURE_TOLERANCE_DAYS` already settles what a date that
     * cannot be weighed is worth. The clamp that used to be here turned exactly that into
     * the freshest answer available, which is the same false all-clear the directory's copy
     * age used to compute. Costs nothing to say instead.
     */
    if (days < 0) return 'unknown — this clock is wrong';
    if (days === 0) return 'today';
    if (days === 1) return '1 day ago';
    return `${days} days ago`;
  }
  const freshestLabel = $derived(data.coverage.freshest ? daysAgo(data.coverage.freshest) : null);

  /**
   * "en" -> "English", via the browser's own `Intl.DisplayNames` — no lookup table to
   * maintain, and it degrades to the raw code rather than throwing on one it doesn't know.
   */
  function languageLabel(codes: string[]): string | null {
    if (codes.length === 0) return null;
    try {
      const names = new Intl.DisplayNames(['en'], { type: 'language' });
      return codes.map((c) => names.of(c) ?? c).join(', ');
    } catch {
      return codes.join(', ');
    }
  }

  const healthSub = $derived.by(() => {
    if (!health) return null;
    const parts: string[] = [];
    if (health.clean === true) parts.push('clean tree');
    else if (health.clean === false) parts.push('uncommitted changes');
    if (health.suites?.counts) {
      parts.push(`${health.suites.counts.passed}/${health.suites.counts.total} tests`);
    }
    if (health.suites?.ran) parts.push(health.suites.ran);
    return parts.length ? parts.join(' · ') : null;
  });
</script>

<svelte:head>
  <title>NavCom</title>
  <meta
    name="description"
    content="Look up who takes someone tonight, and see how much of the directory anybody has checked — no setup, no account."
  />
</svelte:head>

<svelte:window onkeydown={onKey} />

<div class="terminal landing">
  <!--
    Distress, first in the document and outside both panes, so that no sheet, map or detail can
    ever cover it [com.md §4]. Prerendered hidden and shown only on a device with an operator:
    by the bootstrap before the bundle arrives, and by onMount after.
  -->
  <!-- A landmark of its own, so a screen reader's landmark list finds it like the map and Com. -->
  <section id="distress-early" class="distress-layer" aria-label="Distress" hidden>
    <a class="nc-act" data-act data-tone="alarm" href="/terminal/distress/" data-sveltekit-reload>
      <span class="nc-act-label">Distress</span>
    </a>
  </section>

  <!--
    Nav and Com [docs/positioning.md: "On a ship's bridge, Navigation and Communications are
    separate stations. NavCom fuses them into one post."]. Nav is the map, filling the screen;
    Com is a sheet over it on a phone and a sidebar beside it on a wide screen [com.md §3].
  -->
  <main class="bridge">
    <section class="nav" data-nav aria-label="Map">
      {#if GridMap}
        <GridMap
          marks={coverage ? regionPoints : []}
          frame={regionPoints}
          highlight={lit}
          label="Map of the provinces with an open mission{coverage ? ', and every directory region' : ''}"
          onpick={(province) => open({ kind: 'missions', province }, true)}
        />
      {:else}
        <div class="nav-loading" data-grid={mapUnloaded ? 'failed' : 'loading'}>
          {#if mapUnloaded}
            <!-- GridMap's own words for its own failure: the same failure reads the same way. -->
            <strong class="unloaded" data-grid-failed>Map not loaded — it needs one visit with a connection</strong>
          {/if}
        </div>
      {/if}
      <div class="nav-key">
        <!--
          Not "The Watchtower" — that term names a specific node's keypair elsewhere
          [docs/spec/bootstrap.spec.md]. This is the one screen every kind of visitor sees
          first, and the product's own name belongs here unqualified.
        -->
        <h1>NavCom</h1>
        {#if missionsUnloaded}
          <strong data-missions="unloaded">Missions not loaded — they need one visit with a connection</strong>
        {:else if feed.status === 'connecting'}
          <strong data-missions="connecting">Reaching The Record…</strong>
        {:else if feed.status === 'unavailable'}
          <strong data-missions="unavailable">Missions unavailable — neither The Record nor its mirror can be reached</strong>
        {:else if active.length === 0 && refused.length === 0}
          <strong data-missions="none" data-feed={feed.status}>No open missions · {missionAge}</strong>
        {:else}
          <!-- The way into the missions that needs no map: a keyboard and a screen reader get here too. -->
          <button
            type="button"
            class="missions-open"
            data-missions="open"
            data-feed={feed.status}
            onclick={() => open({ kind: 'missions', province: null }, true)}
          ><b class="lit" aria-hidden="true"></b>{active.length > 0 ? 'Open missions' : 'No open missions'} · {missionAge}{#if refused.length > 0}<span data-refused-count> · {refused.length} not read</span>{/if}</button>
        {/if}
        {#if clockBehind}<strong data-clock-behind>This phone's clock is behind — check it before taking part</strong>{/if}
        <button type="button" class="layer" aria-pressed={coverage} onclick={() => (coverage = !coverage)}>
          Coverage
        </button>
      </div>
    </section>

    <section class="com" data-com data-detent={detent} aria-label="Com" bind:this={comEl}>
      <!--
        The sheet's handle: drag it, or tap it, to change how much of Com shows. A real button,
        so a keyboard can reach it — a click with no pointer behind it (detail 0) is a key.
      -->
      <div class="com-head">
        {#if top}
          <!-- Escape does the same, anywhere in Com. -->
          <button type="button" class="back" data-back onclick={back}>Back</button>
        {/if}
      <button
        type="button"
        class="grab"
        aria-label={detent === 'full' ? 'Show less' : 'Show more'}
        aria-expanded={detent !== 'peek'}
        onpointerdown={grabDown}
        onpointerup={grabUp}
        onclick={(e) => {
          if (e.detail === 0) detent = NEXT[detent];
        }}
      ><span aria-hidden="true"></span></button>
        <!--
          Reachable from every screen, not just one [signature.spec.ts already asserts this for the
          terminal] — this page is another screen of the same app now, not a separate site, so the
          same rule applies here.
        -->
        <!--
          Same fix as the terminal's, because this was the same defect copied.

          `aria-pressed` tracked low-signature while the label named the destination, so a screen
          reader announced "DOCUMENT, toggle button, pressed" while the page was in low signature —
          the two halves contradicting each other, each individually valid, which is why an
          automated pass cannot find it.
        -->
        <button
          class="signature"
          data-signature-toggle
          aria-label={sig === 'low' ? 'Switch to document mode' : 'Switch to low signature'}
          onclick={() => {
            sig = sig === 'low' ? 'document' : 'low';
            setSignature(sig);
          }}
        >{sig === 'low' ? 'Document' : 'Low signature'}</button>
      </div>
      <div class="com-body">
        {#if top}
          <!-- The screen on top of Com's stack. Focus lands here when it opens. -->
          <div class="com-screen" bind:this={screenEl} tabindex="-1">
            <!--
              A screen that throws is said to have failed, here, and nothing else stops: without a
              boundary one bad render reset the whole page's updates [audit 11.X].
            -->
            <svelte:boundary>
              {#snippet failed(_error, reset)}
                <strong class="screen-unloaded" data-screen-failed>This screen could not be shown</strong>
                <button type="button" class="back" onclick={reset}>Try again</button>
              {/snippet}
            {#if screens}
              {#if top.kind === 'missions'}
                <screens.MissionList
                  missions={active}
                  province={top.province}
                  status={missionsUnloaded ? 'unloaded' : feed.status}
                  {refused}
                  {now}
                  onopen={(address) => open({ kind: 'mission', address })}
                />
              {:else if top.kind === 'yours'}
                <screens.YoursScreen
                  {now}
                  open={openSet}
                  onopen={(address) => open({ kind: 'mission', address })}
                  onreport={(address) => open({ kind: 'report', address })}
                />
              {:else if top.kind === 'report'}
                <screens.ReportScreen address={top.address} {now} ondone={back} />
              {:else if top.kind === 'reports'}
                <screens.ReportsScreen address={top.address} missions={active} {now} />
              {:else if top.kind === 'mission'}
                {@const address = top.address}
                {@const m = active.find((x) => x.address === address)}
                {#if m}
                  <screens.MissionPage mission={m} {now} open={openSet} asOf={feed.status === 'cached' ? feed.at : null} onreports={() => open({ kind: 'reports', address })} />
                {:else if feed.status === 'connecting'}
                  <Readout value="Loading" tone="cold" />
                {:else}
                  <!-- It ended, or was closed, while open here: said, not left blank. -->
                  {@const why = refused.find((r) => r.address === address)?.because}
                  <Panel label="Mission" post="Gone">
                    <!-- A package NavCom could not read is not one that ended: said as what it is [11.E]. -->
                    <Slot k="Open"><Readout value={why ? 'Could not be read' : 'No longer open'} tone="cold" sub={why ?? 'it ended or was closed'} /></Slot>
                  </Panel>
                {/if}
              {/if}
            {:else if screensUnloaded}
              <!-- The same words the map uses for the same failure [com.md §6]. -->
              <strong class="screen-unloaded" data-screen-failed>Not loaded — it needs one visit with a connection</strong>
            {:else}
              <Readout value="Loading" tone="cold" />
            {/if}
            </svelte:boundary>
          </div>
        {:else}
  <div class="nc-bridge">
    {#if operator}
      <Panel label="Yours" post={holding > 0 ? `${holding} held` : null}>
        <button type="button" class="yours-open" data-yours onclick={() => open({ kind: 'yours' })}>
          Your missions
        </button>
      </Panel>
    {/if}
    <Panel label="Find" post={nearRegion ? `Near ${nearRegion.name}` : null}>
      <label for="lookup" class="nc-lookup-label">Where are you, or what do you need</label>
      <input
        id="lookup"
        type="search"
        bind:value={query}
        placeholder="a shelter, a clinic, a city…"
        autocomplete="off"
        onfocus={lift}
      />
      {#if results.length > 0}
        <ul class="nc-results">
          <!--
            Two kinds of hit, and they are not interchangeable. A record is the answer somebody
            typed a shelter's name to get; a region is the answer to a city, and the door to a
            city whose records are not loaded here. Marked in the markup rather than inferred
            from a shape, so a test can tell them apart.
          -->
          {#each results as r (r.kind === 'record' ? r.id : 'region:' + r.region)}
            <li>
              {#if r.kind === 'record'}
                <a href="/directory/{r.id}/" data-hit="record">
                  <span class="nc-results-name">{r.name}</span>
                  <span class="nc-results-meta">{r.type.replace(/_/g, ' ')} · {r.regionName}{#if r.abroad} · <strong data-abroad>in {r.abroad}</strong>{/if}</span>
                </a>
              {:else}
                <!--
                  The region's own page, not an anchor on the flat index. The first attempt
                  linked to `/directory/#<region>`, which does not exist -- the public index
                  has one anchor, `#main` -- so it would have dropped somebody at the top of a
                  1,405-entry list to find by eye what they had just searched for. That is the
                  exact failure the "opens onto the record it named" test was written to stop,
                  and it caught this.
                -->
                <a href="/terminal/directory/{r.region}/" data-hit="region">
                  <span class="nc-results-name">{r.name}</span>
                  <span class="nc-results-meta">
                    {r.records === 0 ? 'no records carried yet' : `${r.records} places`}
                  </span>
                </a>
              {/if}
            </li>
          {/each}
        </ul>
      {:else if query.trim()}
        <p class="nc-results-empty">Nothing matches yet — try a city or a type of place.</p>
      {/if}
      {#if !query.trim()}
        <div class="nc-manual">
          <label for="region-pick">No signal, or geolocation said no? Pick a region</label>
          <select id="region-pick" bind:value={manualRegion} onfocus={lift}>
            <option value="">Not now</option>
            {#each regionOptions as r (r.region)}
              <option value={r.region}>{r.name}</option>
            {/each}
          </select>
        </div>
      {/if}
      <Why summary="What this searches">
        <p>
          <strong>Every region this directory covers</strong>, always — and
          {#if loaded}
            <strong>every place in {loaded.name}</strong>, because that is the area nearest you.
          {:else}
            no individual places yet: pick a region below, or allow location, and this searches
            that area's places too.
          {/if}
        </p>
        <p>
          What you type is searched on this device and sent nowhere. Picking a region, or
          allowing location, downloads that area's list. Places elsewhere are found by
          finding their city first — the whole directory is too large to carry on one page, and
          a search that silently covered only part of it would be worse than one that says so.
        </p>
      </Why>
    </Panel>

    <!--
      aria-live: this panel's content changes when a region is picked (the fusion this page
      exists for), and a screen-reader user picking one from the select below would otherwise
      never hear that anything happened. `polite` rather than `assertive` — it's a state
      update, not an alert.
    -->
    <Panel
      label="Network"
      post={focusedFigures ? focusedFigures.name : null}
      aria-live="polite"
    >
      {#if focusedFigures}
        <!--
          The fusion: what you did in Nav (searched, or were placed somewhere) changes what
          Com reports, in the same glance — this region's own figures, not the network-wide
          ones. Never a watch/coverage claim [docs/spec/bootstrap.spec.md] — directory facts
          only, computed in $lib/console/figures.ts.
        -->
        <Slot k="Records">
          <Readout
            value="{focusedFigures.records} in {focusedFigures.name}"
            tone="neutral"
            sub={languageLabel(focusedFigures.languages)}
          />
        </Slot>
        <Slot k="Freshest">
          {#if focusedFigures.freshest}
            <Readout value={daysAgo(focusedFigures.freshest)} tone="neutral" sub="most recent check here" />
          {:else}
            <Readout value="—" tone="cold" sub="nothing verified here yet" />
          {/if}
        </Slot>
        <Slot k="Verify">
          {#if focusedFigures.confirmedByPerson > 0}
            <Readout
              value="{focusedFigures.confirmedByPerson} confirmed by a person"
              tone="good"
              sub="of {focusedFigures.records} total"
            />
          {:else}
            <Readout value="Nothing confirmed yet" tone="warn" sub="all of it is unverified" />
          {/if}
        </Slot>
        <Why summary="Help verify {focusedFigures.name}">
          <p>
            Do you know this area? If anything is wrong — especially who they take, or what
            happens to somebody with no ID — the fastest fix is the
            <a href="/terminal/directory/{focusedRegionSlug}/">field terminal</a>: pick a
            callsign, find the listing, tap report a problem. No account, and once you have
            opened that area with signal, it works without.
          </p>
          <p>
            Your correction is <strong>added</strong> under your callsign, or without one — still
            signed by this phone's own key, so it is not anonymous — and it cannot delete a
            listing or overrule anybody, and nobody has to approve it.
          </p>
        </Why>
        <Slot k="Holding watch">
          <Readout value="Not claimed here" tone="cold" />
        </Slot>
        <Why summary="What that would mean">
          <p>
            Nobody is asserted to be watching {focusedFigures.name} — nothing here discovers a
            Watchtower, by design: a list of Watchtowers is a list of where operators are.
            Holding watch, generally, means answering Query, Assist and Distress for operators
            working an area, backed by a capability receipt that states plainly what that
            promises — something like <em>two on-call, both reachable by text</em>, or
            <em>nobody on-call, and Distress will say so</em>.
          </p>
          <p>
            If somebody hands you a Watchtower, or you want to start one,
            <a href="/terminal/setup/">setup</a> is one screen and nothing is required first.
          </p>
        </Why>
      {:else}
        <Slot k="Coverage">
          <Readout
            value="{data.coverage.regionsWithData} of {data.coverage.regionsTotal} areas"
            tone="neutral"
            sub="{data.coverage.records} records"
          />
        </Slot>
        <Slot k="Freshest">
          {#if freshestLabel}
            <Readout value={freshestLabel} tone="neutral" sub="most recent check, anywhere" />
          {:else}
            <Readout value="—" tone="cold" sub="nothing verified yet" />
          {/if}
        </Slot>
      {/if}
      <Slot k="Build">
        {#if health}
          <Readout
            value={health.commit ? health.commit.slice(0, 7) : 'unknown'} verbatim
            tone={health.clean === false ? 'warn' : 'neutral'}
            sub={healthSub}
          />
        {:else if healthTried}
          <Readout value="Unreachable" tone="cold" sub="no build receipt found" />
        {:else}
          <Readout value="Checking…" tone="cold" />
        {/if}
      </Slot>
      <Why summary="What this is">
        <p>
          Regions and records are counted from the same directory anyone can browse — nothing
          here is asserted twice. The build line is this deploy's own verify-then-ship receipt:
          the actual commit and test count behind what you are using right now, not a claim
          about it.
        </p>
        <p>
          Anything an operator publishes is theirs to answer for, not NavCom's —
          <a href="/notice/">who is responsible for what</a>.
        </p>
      </Why>
    </Panel>
  </div>

  <a class="nc-act" data-act data-tone="warn" href="/terminal/" data-sveltekit-reload>
    <span class="nc-act-label">Open the Field Terminal</span>
  </a>
        {/if}

      </div>
    </section>
  </main>
</div>

<style>
  /*
   * A console, not a phone screen stretched wide. `terminal/+layout.svelte`'s own 30rem
   * column doesn't apply here — Svelte scopes it to that component — so without this the
   * root page has no width constraint of its own and stretches edge to edge on a desktop
   * monitor: the white-margin bug's sibling, an unstructured full-bleed stack rather than an
   * absence of background.
   */
  /*
   * The whole screen is the bridge: the map fills it, Com sits over it on a phone and beside it
   * on a wide screen. The 68rem centred column this page used to have was a console's layout;
   * a map has to reach the edges.
   */
  /*
   * Exactly the screen. `.terminal` gives every screen `min-height: 100dvh` and a 4rem bottom
   * pad to keep content clear of the corner toggle; on this page that made the bridge 64px taller
   * than the phone, and the bottom of the sheet — most of the search field — hung below the edge.
   * The toggle lives in the sheet's head here, so neither rule applies.
   */
  .landing {
    position: fixed;
    inset: 0;
    min-height: 0;
    padding: 0;
    background: var(--t-ground, #0b0e12);
    --distress-h: 0px;
  }
  /*
   * And the document given a height, only while this page is showing. With every child fixed,
   * the document is zero pixels tall: a browser renders that happily, and anything that asks
   * whether the page is showing — an accessibility tree, a test — is told nothing is.
   */
  :global(html:has(.landing)),
  :global(body:has(.landing)) {
    height: 100%;
  }
  /* Distress takes the bottom strip when it shows; Com sits above it, never over it. */
  .landing:has(.distress-layer:not([hidden])) {
    --distress-h: 3.75rem;
  }
  .bridge {
    position: absolute;
    inset: 0 0 var(--distress-h) 0;
  }
  .nav {
    position: absolute;
    inset: 0;
  }
  .nav-loading {
    position: absolute;
    inset: 0;
    background: var(--t-ground, #0b0e12);
  }
  /* Where GridMap puts its own failure, centred, for the same reason [GridMap.svelte]. */
  .unloaded {
    position: absolute;
    inset-inline: 1rem;
    top: 50%;
    transform: translateY(-50%);
    text-align: center;
    color: var(--t-ink);
    font-size: 0.9rem;
  }
  .nav-key {
    position: absolute;
    inset-inline-start: calc(0.75rem + env(safe-area-inset-left, 0px));
    inset-block-start: calc(0.75rem + env(safe-area-inset-top, 0px));
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.4rem;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.75rem;
    color: var(--t-muted);
    max-width: calc(100% - 6rem);
  }
  .nav-key h1 {
    font-size: 1rem;
    letter-spacing: 0.08em;
  }
  .nav-key strong {
    font-weight: 400;
  }
  .nav-key .lit {
    display: inline-block;
    width: 10px;
    height: 10px;
    background: color-mix(in srgb, var(--t-ink) 16%, var(--t-raised));
    border: 1px solid var(--t-muted);
    margin-inline-end: 0.45rem;
    vertical-align: middle;
  }
  /* A layer switch, at the terminal's thumb floor rather than its full action height. */
  .nav-key .layer {
    min-height: 3rem;
    padding: 0 0.9rem;
    font-size: 0.85rem;
  }
  .nav-key .layer[aria-pressed='true'] {
    border-color: var(--t-ink);
  }

  /* Com on a phone: a sheet at one of three heights, over the map. */
  .com {
    position: absolute;
    inset-inline: 0;
    bottom: 0;
    height: var(--detent);
    display: flex;
    flex-direction: column;
    background: var(--t-ground, #0b0e12);
    border-top: 1px solid var(--t-line-strong);
    box-shadow: 0 -0.5rem 1.5rem rgb(0 0 0 / 0.45);
    transition: height 0.2s ease;
  }
  /*
   * Measured, not guessed: the search field ends 162px into the sheet on a Pixel 5 and 176px on
   * an iPhone SE, where its label wraps. Peek shows all of it with room to spare.
   */
  .com[data-detent='peek'] {
    --detent: 12.75rem;
  }
  .com[data-detent='half'] {
    --detent: 55%;
  }
  .com[data-detent='full'] {
    --detent: calc(100% - 4rem);
  }
  @media (prefers-reduced-motion: reduce) {
    .com {
      transition: none;
    }
  }
  .grab {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 2.25rem;
    padding: 0;
    background: transparent;
    border: 0;
    cursor: grab;
    touch-action: none;
  }
  .grab span {
    width: 3rem;
    height: 0.3rem;
    border-radius: 0.15rem;
    background: var(--t-line-strong);
  }
  .com-body {
    flex: 1;
    overflow-y: auto;
    padding: 0 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .distress-layer {
    position: fixed;
    inset-inline: 0;
    bottom: 0;
    z-index: 30;
    height: var(--distress-h);
    padding: 0.3rem 0.75rem calc(0.3rem + env(safe-area-inset-bottom, 0px));
    background: var(--t-ground, #0b0e12);
    border-top: 1px solid var(--t-line-strong);
  }
  .distress-layer .nc-act {
    width: 100%;
    min-height: 100%;
  }

  /* Com on a wide screen: a sidebar beside the map, all of it showing, no heights. At the inline
     end, so a right-to-left page gets its mirror image rather than a sidebar on the wrong side. */
  @media (min-width: 48rem) {
    .com {
      inset-block: 0;
      inset-inline: auto 0;
      width: min(28rem, 42%);
      height: auto;
      border-block-start: 0;
      border-inline-start: 1px solid var(--t-line-strong);
      box-shadow: none;
      transition: none;
    }
    .nav {
      inset-block: 0;
      inset-inline: 0 min(28rem, 42%);
    }
    .grab {
      display: none;
    }
    .com-head {
      justify-content: flex-end;
      padding-block-start: 0.75rem;
    }
    .com-head .back {
      margin-inline-end: auto;
    }
  }

  /*
   * The sheet's head: the handle, and the display-mode toggle beside it. The terminal floats the
   * toggle in a corner, which on this page put it over the search; at the foot of Com it was out
   * of reach whenever the sheet was low. In the head it is reachable at every height and on a
   * wide screen, and it covers nothing because it is part of the sheet.
   */
  .com-head {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding-inline-end: 0.75rem;
  }
  .com-head .grab {
    flex: 1;
  }
  .com-head .signature {
    position: static;
  }
  .com-head .back {
    flex: none;
    min-height: 2.75rem;
    padding: 0 0.9rem;
    margin-inline-start: 0.75rem;
    border: 1px solid var(--t-line);
    background: transparent;
    color: var(--t-ink);
    font-family: var(--font-mono);
    font-size: 0.72rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
  }
  .com-screen {
    display: grid;
    gap: 1rem;
    outline: none;
  }
  .com-screen :global(.nc-panel) {
    margin: 0;
  }
  .screen-unloaded {
    color: var(--t-ink);
    font-size: 0.9rem;
  }
  .yours-open {
    width: 100%;
    min-height: 3rem;
    padding: 0 0.8rem;
    border: 1px solid var(--t-line-strong);
    background: var(--t-sunk);
    color: var(--t-ink);
    font: inherit;
    font-weight: 600;
    text-align: start;
    cursor: pointer;
  }
  /* The missions line in the map's key, as the button it is. */
  .missions-open {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 2.75rem;
    padding: 0 0.6rem;
    margin-inline-start: -0.6rem;
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .missions-open:hover {
    border-color: var(--t-line);
  }

  .nc-bridge {
    display: grid;
    gap: 1rem;
  }
  /* panel.css's own `.nc-panel { margin: 0 0 1rem }` would double up with the grid gap. */
  .nc-bridge :global(.nc-panel) {
    margin-bottom: 0;
  }

  .nc-lookup-label {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--t-faint);
  }

  .nc-results {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .nc-results li a {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--t-line);
    background: var(--t-sunk);
    text-decoration: none;
  }
  .nc-results-name {
    font-weight: 600;
    color: var(--t-ink);
  }
  .nc-results-meta {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--t-faint);
  }
  .nc-results-empty {
    color: var(--t-faint);
    font-size: 0.9rem;
  }

  .nc-manual {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .nc-manual label {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--t-faint);
  }

  .nc-act {
    text-decoration: none;
  }
</style>
