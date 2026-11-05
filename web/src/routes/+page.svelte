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
  import { pushState, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import '$lib/terminal/tokens.css';
  import '$lib/terminal/screen.css';
  import '$lib/terminal/panel.css';
  import { Panel, Slot, Readout } from '$lib/components/panel';
  import { search, type ConsoleHit } from '$lib/console/search';
  import type {
    ConsoleRecordEntry, ConsoleCentroid, ConsoleRegionFigures
  } from '$lib/console/types';
  import { locateOnce, nearest, type Fix } from '$lib/console/position-once';
  import { get, onWipe, set } from '$lib/terminal/storage';
  import { forgetMission, pendingMission } from '$lib/missions/pending';
  import type { Feed } from '$lib/missions/live';
  import type { Screen } from '$lib/com/screens';
  import type GridMapType from '$lib/components/grid/GridMap.svelte';
  import type BuildLineType from '$lib/console/BuildLine.svelte';

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
  /** The name on this device's profile, or null with none: the head's one door says which [com-head]. */
  let profile = $state<string | null>(null);
  let hasProfile = $state(false);

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
   * Loaded after first paint. The map cannot draw until its 59 kB of geometry arrives anyway,
   * so fetching its code in parallel costs nothing a person can see — and keeps this page's
   * first-paint script inside the budget that has kept the front door fast.
   */
  let GridMap = $state<typeof GridMapType | null>(null);
  /**
   * Set when the map's or the mission feed's code did not arrive. Both come by dynamic import, so
   * on a first visit — before the service worker holds them — either can fail, and without these
   * the page would sit at a blank map and "Reaching The Record…" for as long as it is open
   * [com.md §6].
   */
  let mapUnloaded = $state(false);
  let missionsUnloaded = $state(false);
  /** Places are one switch away; missions are what the map opens on [map.md §6]. */
  let coverage = $state(false);
  /**
   * With no mission open the map opened on an empty Earth, outlines and nothing on them (the owner,
   * 2026-11-01). So Places comes on by itself once the live feed says nothing is open: never before
   * every relay has had its first say, so a relay answering empty while another is still sending does
   * not decide it; never before the feed answers, so first paint and mount still fetch no places
   * [map.md, budgets]; and never from a cached or offline feed, where the file may not arrive. Once a
   * visit, and never against the person: switched off, it stays off.
   */
  let placesOffered = false;
  $effect(() => {
    if (placesOffered || mapStatus !== 'ready' || feed.status !== 'live' || feed.waiting > 0 || active.length > 0) return;
    placesOffered = true;
    coverage = true;
  });
  /**
   * The map's own word on whether it drew and whether Places arrived. Places is offered only on a
   * drawn map: without one, or without script, it toggled and nothing changed.
   */
  let mapStatus = $state<'loading' | 'ready' | 'failed'>('loading');
  let placesStatus = $state<'off' | 'loading' | 'ready' | 'failed'>('off');
  /**
   * The key, which the map's opening view keeps the Earth out from under, and which the map puts its
   * own lines in, what the chosen layer is, whose and how old [GridMap cover].
   */
  let keyEl = $state<HTMLElement>();

  /** Missions, read live by this device from The Record [$lib/missions/live]. */
  let feed = $state<Feed>({ status: 'connecting' });
  /** Ticks each minute, so a mission that ends while the page is open stops being lit. */
  let now = $state(Date.now());
  const active = $derived(
    feed.status === 'live' || feed.status === 'cached'
      ? feed.missions.filter((m) => m.state !== 'closed' && (m.validUntil ?? 1 / 0) > now / 1000)
      : []
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
   * The map is the whole screen, and the page is four corners over it (the owner, 2026-11-05) [com.md
   * §3]: each a node that says what its corner holds, and a tap on one opens it. Com is where it opens:
   * on a phone a sheet at half or full, on a wide screen a panel on that corner's side. Closed, there is
   * only the map and the corners.
   */
  type Detent = 'half' | 'full';
  let detent = $state<Detent>('half');
  const NEXT: Record<Detent, Detent> = { half: 'full', full: 'half' };
  type Corner = 'missions' | 'map' | 'find' | 'you';
  let dragFrom: number | null = null;
  function grabDown(e: PointerEvent) {
    dragFrom = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function grabUp(e: PointerEvent) {
    if (dragFrom === null) return;
    const dy = e.clientY - dragFrom;
    dragFrom = null;
    if (dy < -40) detent = 'full';
    else if (dy > 40) {
      if (detent === 'full') detent = 'half';
      else back();
    } else detent = NEXT[detent];
  }

  /**
   * Com is a navigation stack whose root is the search [com.md §1, §2]. Which screens there are,
   * which entry's code draws each and how high the sheet opens for it is `$lib/com/screens`, loaded
   * as the page mounts: this page keeps the stack and nothing about what is on it, so a new screen
   * or a new entry leaves its first paint as it was [groups.md §13].
   *
   * The stack lives in the browser's history, one shallow entry per screen, so the phone's back
   * gesture steps back through Com exactly as Back and Escape do. Kept in component state, the
   * system back left the page with a mission open, and the list and the mission with it
   * [audit 11.I]. A reload starts at the root: SvelteKit restores no state until the next step.
   * History outlives a build, so what it holds is read as another version's until Com says otherwise.
   */
  const stack = $derived.by(() => {
    const com = (page.state as { com?: unknown }).com;
    return Array.isArray(com) ? (com as unknown[]) : [];
  });
  const top = $derived(stack.at(-1));
  /** Which corner is open, in the same history: the phone's back closes it as Back does. */
  const corner = $derived(((page.state as { corner?: unknown }).corner ?? null) as Corner | null);
  /** Whether this entry was opened over something already open, so that a step back is not to the map. */
  const over = $derived((page.state as { over?: unknown }).over === true);
  /** Whether anything is open over the map: a screen, or Find or You, which are this page's own. */
  const shown = $derived(stack.length > 0 || corner === 'find' || corner === 'you');
  /** On a wide screen, the side a view opens on: its corner's. What the map opens comes in at the end. */
  const side = $derived(corner === 'missions' || corner === 'find' ? 'start' : 'end');
  let lookupEl = $state<HTMLInputElement>();
  /** The four corners, for the map to keep its names and its opening view clear of [GridMap corners]. */
  let corners = $state<HTMLElement[]>([]);
  let dockEl = $state<HTMLElement>();
  /**
   * Com's own code: its screens, and the one component that draws whichever is on top [com.md §6].
   * Imported once, as the page mounts. A failure is final for the page: the browser keeps it, and a
   * second import fetches nothing [$lib/com/entries].
   */
  let Com = $state<typeof import('$lib/components/com') | null>(null);
  let comUnloaded = $state(false);
  let comArrives: Promise<unknown> = Promise.resolve();
  let screenEl = $state<HTMLElement>();
  let comEl = $state<HTMLElement>();
  /** Escape steps back, when focus is in Com: anywhere else it belongs to whatever has it. */
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && shown && comEl?.contains(document.activeElement)) back();
  }

  /** Every screen moves to another through this: no destination needs a callback of its own. */
  const nav = { open, back };
  /**
   * Open a screen. The sheet rises to the height its kind asks for and never falls: a mission opens
   * with the map still in view, half and never full [com.md §7]. At least half at once, so that what
   * is arriving shows; then full, if Com says so once it is here, which on a slow cell is later.
   */
  async function open(s: Screen, fresh = false) {
    const was = shown;
    const from: Corner | null = s.kind === 'missions' && fresh ? 'missions' : s.kind === 'layers' && fresh ? 'map' : fresh ? null : corner;
    pushState('', { com: fresh ? [s] : [...stack, s], corner: from, over: was });
    if (!was) detent = 'half';
    await comArrives;
    if (Com?.SCREENS[s.kind].height === 'full') detent = 'full';
    await Com?.load(s.kind);
    // Where a keyboard or screen reader goes next: the screen that just opened.
    await tick();
    screenEl?.focus();
  }
  /** One step back through the same history the system back gesture walks: off the root, the map. */
  function back() {
    if (shown) history.back();
  }
  /**
   * A corner, opened. Missions and Map open Com's own screens; Find and You are this page's, so the
   * search works at the first keystroke with nothing to load [com.md §6]. Find puts the cursor in it.
   */
  async function enter(c: Corner) {
    if (c === 'missions') return open({ kind: 'missions', province: null }, true);
    if (c === 'map') return open({ kind: 'layers' }, true);
    const was = shown;
    pushState('', { com: [], corner: c, over: was });
    if (!was) detent = 'half';
    await tick();
    (c === 'find' ? lookupEl : screenEl)?.focus();
  }

  /**
   * Signed on, Com's root opens on your own situation first [com.md §2]. Read straight from this
   * device's storage, so first paint carries no claims code: the screens load when opened.
   */
  let operator = $state(false);
  /** Counts wipes heard here or in another tab: a re-read that does not depend on the clock moving. */
  let wipes = $state(0);
  const holding = $derived.by(() => {
    void stack;
    void wipes;
    if (!operator) return 0;
    const t = Math.floor(now / 1000);
    return (get<{ ends: number }[]>('wipeable', 'mission_claims') ?? []).filter((h) => h.ends > t).length;
  });

  /**
   * Fetch one region's records so the search can see them.
   *
   * Driven by whichever of the two ways the visitor told us where they are -- the region they
   * picked by hand, or the one location found, once they search. **Picking by hand must not buy less than
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
  /** Searching is the visitor's own act: only then does the region location chose load its records. */
  $effect(() => {
    if (query.trim() && !manualRegion && nearRegion) void loadRegionIndex(nearRegion.region, nearRegion.name);
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
  /**
   * The one-shot fix, coarsened, held only until the regions' centroids arrive to place it, then
   * dropped. Placing it the moment it came missed whenever it came first — a fast fix and a slow
   * network — and the visitor was never placed at all [found writing the location test].
   */
  let fix = $state<Fix | null>(null);
  $effect(() => {
    if (!fix || centroids.length === 0) return;
    nearRegion = nearest(fix, centroids);
    fix = null;
  });
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

  /**
   * For when geolocation is denied or absent and nothing has been typed yet.
   *
   * Starts undefined, not '': the picker is in the prerendered page and can be used before the
   * scripts arrive, and Svelte's select binding adopts the page's own choice at mount only when
   * the bound value is undefined. Starting at '' put a region picked on a slow cell back to
   * "Not now" the moment the page hydrated, and nothing loaded [audit 11.I].
   */
  let manualRegion = $state<string | undefined>(undefined);
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

  /** The Build line, loaded as the page mounts [BuildLine.svelte]; null until it arrives. */
  let BuildLine = $state<typeof BuildLineType | null>(null);
  let buildUnloaded = $state(false);

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
    hasProfile = !!get('accruing', 'secret');
    profile = get<string>('accruing', 'callsign') ?? null;
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

    /*
     * Where the visitor is stays on the phone [decided 2026-10-06]. It places them — which
     * region's figures Com shows, which region the search starts from — and fetches nothing:
     * a fetch here put the visitor's address and the region they were standing in side by side
     * in the host's request log, before they had asked for anything. Their region's records load
     * when they search, like any page they choose to read.
     */
    void locateOnce().then((f) => (fix = f));

    /*
     * An operator on this device gets Distress, in its own layer that nothing covers
     * [com.md §4]. The prerendered bar is revealed as it is parsed, before the bundle arrives
     * [hooks.server.ts REVEAL]; this repeats it for a device that signed on after that ran.
     */
    if (get('accruing', 'secret')) document.getElementById('distress-early')?.removeAttribute('hidden');
    operator = !!get('accruing', 'secret');

    /*
     * Somebody left a mission to sign on so they could take part [TakePart.svelte]: now that there
     * is somebody on this device, the mission they chose opens again, once.
     */
    let pending = get('accruing', 'secret') ? (pendingMission()?.address ?? null) : null;
    if (pending) forgetMission();
    /*
     * On the next task, once the router has started and takes entries. A reload keeps the entry's
     * history state while SvelteKit shows the root, so it is cleared first: otherwise the next Back
     * stepped "back" into the screen that was open before the reload. Then the mission somebody
     * left to sign on goes into history like any screen opened here.
     */
    setTimeout(() => {
      try {
        if (stack.length === 0) replaceState('', {});
      } catch {
        /* a router that has not started keeps the old entry; the mission still opens */
      }
      if (pending) void open({ kind: 'mission', address: pending }, true);
    }, 0);

    void import('$lib/components/grid/GridMap.svelte')
      .then((m) => (GridMap = m.default))
      .catch(() => (mapUnloaded = true));
    void import('$lib/console/BuildLine.svelte')
      .then((m) => (BuildLine = m.default))
      .catch(() => (buildUnloaded = true));
    comArrives = import('$lib/components/com').then(
      (m) => void (Com = m),
      () => void (comUnloaded = true)
    );
    let stopMissions: (() => void) | null = null;
    let gone = false;
    void import('$lib/missions/live')
      .then(({ watchMissions }) => {
        if (!gone) stopMissions = watchMissions((f) => (feed = f));
      })
      .catch(() => (missionsUnloaded = true));
    const tick = setInterval(() => (now = Date.now()), 60_000);
    // A wipe in another tab takes the claims `holding` read: counted again now, not at the next tick.
    const unwiped = onWipe(() => (wipes += 1));
    return () => {
      gone = true;
      stopMissions?.();
      clearInterval(tick);
      unwiped();
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

</script>

<svelte:head>
  <title>NavCom</title>
  <meta
    name="description"
    content="Look up who takes someone tonight, and see how much of the directory anybody has checked — no setup, no account."
  />
</svelte:head>

<svelte:window onkeydown={onKey} />

<!--
  Every link out of this page reloads [data-sveltekit-reload, on everything inside]. The root carries a
  Content-Security-Policy of its own, which lets it ask the hosts Hazards and the weather warnings
  read, and nobody else (`vercel.json`, `$lib/outside`); a page SvelteKit opened in place would carry it
  on, and /terminal/who checks proofs wherever a card says they are. Com's screens are drawn in here
  too, so their links reload as well.
-->
<div class="terminal landing" data-sveltekit-reload>
  <!--
    Distress, first in the document and outside both panes, so that no sheet, map or detail can
    ever cover it [com.md §4]. Prerendered hidden and shown only on a device with an operator:
    by the script hooks.server.ts puts inside it, as it is parsed and before the bundle arrives,
    and by onMount after.

    It stays in this page's own markup, and is not one of Com's screens or anything their registry
    loads: that script can only reveal a copy the prerendered HTML already has, and the strip it
    takes is the `:has()` rule below, in this page's scope. Anywhere else it would wait on code.
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
  <main class="bridge" data-shown={shown || null} data-side={side}>
    <section class="nav" data-nav aria-label="Map">
      {#if GridMap}
        <!-- What each mission lights, and what a tap opens, is the map's own [GridMap]. -->
        <GridMap
          {active}
          places={coverage}
          current={top}
          bind:status={mapStatus}
          bind:placesStatus
          missionsAge={missionAge || null}
          cover={keyEl}
          {corners}
          dock={dockEl}
          label="Map of the Earth, with open missions lit{coverage ? ', and the directory’s places' : ''}"
          onpick={(s) => open(s, true)}
        />
      {:else}
        <!-- Prerendered, so with no script, or no map, there is still a way to the places. -->
        <div class="nav-loading" data-grid={mapUnloaded ? 'failed' : 'loading'}>
          <div class="unloaded">
            {#if mapUnloaded}
              <!-- GridMap's own words for its own failure: the same failure reads the same way. -->
              <strong data-grid-failed>Map not loaded — it needs one visit with a connection</strong>
            {/if}
            <a href="/directory/">The directory, without the map</a>
          </div>
        </div>
      {/if}
    </section>

    <!--
      Four corners over the map (the owner, 2026-11-05) [com.md §3]: each a node that says what its corner
      holds and opens it, so the map keeps the whole screen and nothing sits in its middle. Missions and the
      Map at the top, where the thumb reaches least and the eye first; Find and You at the foot, where the
      thumb is. Each works before the script arrives: a link where it can be one.
    -->
    <div class="corner" data-corner="missions" bind:this={corners[0]}>
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
          aria-expanded={corner === 'missions'}
          onclick={() => enter('missions')}
        ><b class="ring" aria-hidden="true"></b>{#if active.length > 0}<b class="count" data-missions-count>{active.length}</b>{/if}<span>{active.length > 0 ? 'Open missions' : 'No open missions'} · {missionAge}{#if refused.length > 0}<span data-refused-count> · {refused.length} not read</span>{/if}</span></button>
      {/if}
      {#if clockBehind}<strong data-clock-behind>This phone's clock is behind — check it before taking part</strong>{/if}
    </div>

    <!-- The map's own: what is drawn, whose and how old, which the map puts here as it mounts [invariant 7], and its controls. -->
    <div class="corner" data-corner="map" bind:this={keyEl}>
      <div class="corner-row" bind:this={corners[1]}>
        <button type="button" class="corner-open" data-layers aria-label="Map layers" aria-expanded={corner === 'map'} disabled={mapStatus !== 'ready'} onclick={() => enter('map')}>Map</button>
        <div class="dock" bind:this={dockEl}></div>
      </div>
    </div>

    <div class="corner" data-corner="find" bind:this={corners[2]}>
      <a
        class="corner-open"
        href="/directory/"
        data-find-open
        aria-expanded={corner === 'find'}
        onclick={(e) => {
          e.preventDefault();
          void enter('find');
        }}
      ><span class="corner-k">Find</span><span class="corner-v">{nearRegion ? `Near ${nearRegion.name}` : 'a shelter, a clinic, a city'}</span></a>
      <button type="button" class="layer" aria-pressed={coverage} disabled={mapStatus !== 'ready'} onclick={() => (coverage = !coverage)}>Places</button>
      {#if placesStatus === 'failed'}<strong data-places="failed">Places not loaded — they need one visit with a connection</strong>{/if}
    </div>

    <div class="corner" data-corner="you" bind:this={corners[3]}>
      <!--
        The one door to your own side of NavCom. With no profile on this device it is the page's call to
        action, Create profile, which the owner looked for on a first visit and did not find behind "Field
        Terminal" (2026-11-01); with one, your name, and what you hold.
      -->
      {#if hasProfile}
        <a
          class="corner-open"
          href="/terminal/"
          data-terminal-link
          aria-expanded={corner === 'you'}
          onclick={(e) => {
            e.preventDefault();
            void enter('you');
          }}
        ><span class="corner-k">You</span><span class="corner-v">{profile ?? 'You'}{operator ? ` · ${holding > 0 ? `${holding} held` : 'nothing claimed'}` : ''}</span></a>
      {:else}
        <a class="corner-open cta" href="/terminal/setup/" data-sveltekit-reload data-terminal-link data-create-profile><span class="corner-k">You</span><span class="corner-v">Create profile</span></a>
      {/if}
      {#if !shown}{@render signatureToggle()}{/if}
    </div>

    {#snippet signatureToggle()}
      <!--
        Reachable from every screen, not just one [signature.spec.ts already asserts this for the terminal]:
        in the You corner over the map, and in Com's head while something is open over it. One at a time.
        `aria-pressed` tracked low-signature while the label named the destination, so a screen reader
        announced "DOCUMENT, toggle button, pressed" in low signature: the label names the destination.
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
    {/snippet}

    <section class="com" data-com data-detent={shown ? detent : 'closed'} data-side={side} aria-label="Com" bind:this={comEl} inert={!shown}>
      <!--
        Back steps through Com's stack, and from its root back to the map. The handle, on a phone, moves
        between half and full: a real button, so a keyboard can reach it — a click with no pointer behind it
        (detail 0) is a key.
      -->
      <div class="com-head">
        <!-- Escape does the same, anywhere in Com. -->
        <!-- Back while a step back is to something else open, a screen, Find or You; Close when it is to the map. -->
        <button type="button" class="back" data-back onclick={back}>{stack.length > 1 || over ? 'Back' : 'Close'}</button>
        <button
          type="button"
          class="grab"
          aria-label={detent === 'full' ? 'Show less' : 'Show more'}
          aria-expanded={detent === 'full'}
          onpointerdown={grabDown}
          onpointerup={grabUp}
          onclick={(e) => {
            if (e.detail === 0) detent = NEXT[detent];
          }}
        ><span aria-hidden="true"></span></button>
        {#if shown}{@render signatureToggle()}{/if}
      </div>
      <div class="com-body">
        {#if stack.length > 0}
          <!--
            The screen on top of Com's stack, whatever its kind: one branch, which the registry
            and each entry's host fill in [$lib/com/screens]. Focus lands here when it opens.
          -->
          <div class="com-screen" bind:this={screenEl} tabindex="-1">
            {#if Com}
              <Com.ComScreen screen={top} {nav} {now} {feed} {active} feedUnloaded={missionsUnloaded} />
            {:else if comUnloaded}
              <!--
                The same words the map uses for the same failure [com.md §6], and the reload that is
                that visit: nothing in the page fetches Com's code again, and an installed app has no
                browser reload to reach for. On WebKit even a reload does not, yet [com.md §6].
              -->
              <strong class="screen-unloaded" data-screen-failed>Not loaded — it needs one visit with a connection</strong>
              <div class="nc-rail"><button type="button" data-reload onclick={() => location.reload()}>Reload</button></div>
            {:else}
              <Readout value="Loading" tone="cold" />
            {/if}
          </div>
        {:else if corner === 'you'}
  <!-- Your own side: what you hold, and the way to your profile and status [com.md §2]. -->
  <div class="nc-bridge" data-root="you">
    {#if operator}
      <!-- A fixed slot: it reads "nothing claimed" rather than coming and going [com.md §7]. -->
      <Panel label="Yours" post={holding > 0 ? `${holding} held` : 'nothing claimed'}>
        <button type="button" class="yours-open" data-yours onclick={() => open({ kind: 'yours' })}>
          Your missions
        </button>
      </Panel>
    {/if}
    <Panel label="You" post={profile}>
      <a class="yours-open" href="/terminal/" data-sveltekit-reload data-status-link>Your profile and status</a>
    </Panel>
  </div>
        {:else}
  <div class="nc-bridge" data-root="find">
    <Panel label="Find" post={nearRegion ? `Near ${nearRegion.name}` : null}>
      <label for="lookup" class="nc-lookup-label">Where are you, or what do you need</label>
      <input
        id="lookup"
        type="search"
        bind:value={query}
        placeholder="a shelter, a clinic, a city…"
        autocomplete="off"
        bind:this={lookupEl}
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
                <a href="/directory/{r.id}/" data-hit="record" data-sveltekit-reload>
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
          <select id="region-pick" bind:value={manualRegion}>
            <option value="">Not now</option>
            {#each regionOptions as r (r.region)}
              <option value={r.region}>{r.name}</option>
            {/each}
          </select>
        </div>
      {/if}
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
        <p class="nc-foot"><a href="/terminal/directory/{focusedRegionSlug}/" data-help-verify>Correct a listing</a></p>
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
        {#if BuildLine}
          <BuildLine />
        {:else if buildUnloaded}
          <Readout value="Unreachable" tone="cold" sub="no build receipt found" />
        {:else}
          <Readout value="Checking…" tone="cold" />
        {/if}
      </Slot>
      <p class="nc-foot"><a href="/notice/" data-sveltekit-reload>Who is responsible for what</a></p>
    </Panel>
  </div>

        {/if}

      </div>
    </section>
  </main>
</div>

<style>
  /* The one link the console's foot keeps: who answers for what is published. */
  .nc-foot { margin: .5rem 0 0; font-size: .82rem; }
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
    /* The sheet's height at half, where everything opens on a phone; full is all but a strip of map. */
    --half: 55%;
    /* How far each corner sits from the screen's edges. */
    --corner-gap: 0.5rem;
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
  /*
   * Distress takes the bottom strip when it shows; Com sits above it, never over it. Here, in this
   * page's scope, because the prerendered copy it measures is this page's markup [com.md §4].
   */
  .landing:has(.distress-layer:not([hidden])) {
    --distress-h: 3.75rem;
  }
  .bridge {
    position: absolute;
    inset: 0 0 var(--distress-h) 0;
  }
  /*
   * The whole screen, at every size (the owner, 2026-11-05): nothing permanent covers the map, so its
   * opening view is the whole Earth as large as it fits [GridMap corners]. How much the sheet covers
   * now, which the map's readout and reticle stay above, is the one thing it is told.
   */
  .nav {
    position: absolute;
    inset: 0;
    z-index: 0;
    --map-inset: 0px;
    /* On a phone, the sheet at half, where everything opens: the map cuts its key's lines to leave the Earth room above it. */
    --map-reach: var(--half);
    --map-sheet: 0px;
  }
  .bridge:has(> .com[data-detent='half']) > .nav {
    --map-sheet: var(--half);
  }
  .bridge:has(> .com[data-detent='full']) > .nav {
    --map-sheet: calc(100% - 4rem);
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
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    text-align: center;
    color: var(--t-ink);
    font-size: 0.9rem;
  }
  .unloaded a {
    display: inline-flex;
    align-items: center;
    min-height: 3rem;
    color: var(--t-ink);
  }
  /*
   * The four corners: each a node on the ground, so nothing the map draws runs through its words, the age
   * lines invariant 7 rests on among them. A caption and a line or two of what the corner holds; the whole
   * node is the way in. Gestures over a node's empty ground reach the map; only its controls take a touch.
   */
  .corner {
    position: absolute;
    z-index: 1;
    box-sizing: border-box;
    max-width: calc(50% - 1.5 * var(--corner-gap));
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.35rem;
    border: 1px solid var(--t-line-strong);
    /* Plain first: a browser without color-mix drops the second and keeps the ground [panel.css]. */
    background: var(--t-ground);
    background: color-mix(in srgb, var(--t-ground) 92%, transparent);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.75rem;
    color: var(--t-muted);
    pointer-events: none;
  }
  /* Global, so the map's own controls docked here take a touch too: they are GridMap's, scoped to it. */
  .corner :global(:is(button, a)) {
    pointer-events: auto;
  }
  [data-corner='missions'] {
    inset-block-start: calc(var(--corner-gap) + env(safe-area-inset-top, 0px));
    inset-inline-start: calc(var(--corner-gap) + env(safe-area-inset-left, 0px));
  }
  [data-corner='map'] {
    inset-block-start: calc(var(--corner-gap) + env(safe-area-inset-top, 0px));
    inset-inline-end: calc(var(--corner-gap) + env(safe-area-inset-right, 0px));
    align-items: flex-end;
  }
  [data-corner='find'] {
    inset-block-end: calc(var(--corner-gap) + env(safe-area-inset-bottom, 0px));
    inset-inline-start: calc(var(--corner-gap) + env(safe-area-inset-left, 0px));
  }
  [data-corner='you'] {
    inset-block-end: calc(var(--corner-gap) + env(safe-area-inset-bottom, 0px));
    inset-inline-end: calc(var(--corner-gap) + env(safe-area-inset-right, 0px));
    align-items: flex-end;
  }
  .corner h1 {
    margin: 0;
    font-size: 0.6875rem;
    line-height: 1.2;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--t-faint);
  }
  .corner strong {
    font-weight: 400;
  }
  /* The way into a corner: its caption and its line, at the terminal's thumb floor. */
  .corner-open {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.1rem;
    min-height: 3rem;
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--t-line);
    background: transparent;
    color: var(--t-ink);
    font: inherit;
    text-align: start;
    text-decoration: none;
    cursor: pointer;
  }
  .corner-open[aria-expanded='true'] {
    border-color: var(--t-ink);
  }
  .corner-k {
    font-size: 0.6875rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--t-faint);
  }
  .corner-v {
    font-size: 0.85rem;
    overflow-wrap: anywhere;
  }
  .corner-open.cta {
    border-color: var(--t-oncall);
  }
  .corner-open.cta .corner-v {
    color: var(--t-oncall);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  [data-corner='map'] .corner-open {
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-size: 0.75rem;
  }
  .corner-row {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.3rem;
  }
  .dock {
    display: contents;
  }
  /*
   * The missions' own mark, as the map draws one at its smallest: a ring with its centre. It was a lit
   * square, which the directory's places are now (audit, 2026-10-24); a lit province has its own row.
   */
  .corner .ring {
    flex: none;
    box-sizing: border-box;
    width: 12px;
    height: 12px;
    border: 2px solid var(--t-ink);
    border-radius: 50%;
    background: radial-gradient(circle, var(--t-ink) 1.5px, transparent 2px);
  }
  /* A layer switch, at the terminal's thumb floor, as quiet as the corner it is in. */
  .corner .layer {
    min-height: 3rem;
    padding: 0 0.7rem;
    border: 1px solid var(--t-line);
    background: transparent;
    color: var(--t-ink);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.75rem;
    font-weight: 400;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .corner .layer[aria-pressed='true'] {
    border-color: var(--t-ink);
  }
  .corner .signature {
    position: static;
    min-height: 3rem;
    font-size: 0.68rem;
  }
  /*
   * On an upright phone with a sheet open, the strip of map above it is the Earth's: Missions folds to its
   * ring and count, still saying all of it to a screen reader, and the Map corner takes the width, so its
   * controls sit on one row and the key's age line wraps least [invariant 7]. Closed, both are as they were.
   */
  .bridge[data-shown] > [data-corner='missions'] :is(h1, .missions-open > span, strong) {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .bridge[data-shown] > [data-corner='map'] {
    max-width: calc(100% - 6.5rem);
  }
  /* Covered by what opened, so not half-shown under it: a phone's sheet takes the foot. */
  .bridge[data-shown] > :is([data-corner='find'], [data-corner='you']) {
    visibility: hidden;
  }

  /* Com on a phone: a sheet at one of two heights, over the map; closed, nothing at all. */
  .com {
    position: absolute;
    z-index: 2;
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
  .com[data-detent='closed'] {
    display: none;
  }
  .com[data-detent='half'] {
    --detent: var(--half);
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
    /* The terminal's thumb floor, like everything else Com is moved with [tokens.css; audit 11.I]. */
    min-height: 3rem;
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
     end, so a right-to-left page gets its mirror image rather than a sidebar on the wrong side.
     And on a phone held sideways: a fixed peek is most of a short screen, so the heights inverted —
     half came out shorter than peek — and the sheet covered the map's own controls at every height
     [audit 11.I]. A short, wide screen has room beside the map, not beneath it. */
  @media (min-width: 48rem), (orientation: landscape) and (max-height: 30rem) {
    /*
     * On a wide screen, or a phone held sideways, a panel on the side of the corner that opened it, over
     * the map rather than beside it: the map keeps the whole screen, and only that side's corners are
     * covered while it is open. Missions and Find open at the start; the Map, You and what the map opens
     * at the end. Logical sides, so a right-to-left page gets the mirror image.
     */
    .com {
      inset-block: 0;
      inset-inline: auto 0;
      width: min(28rem, 42%);
      height: auto;
      border-block-start: 0;
      border-inline-start: 1px solid var(--t-line-strong);
      box-shadow: 0 0 1.5rem rgb(0 0 0 / 0.45);
      transition: none;
    }
    .com[data-side='start'] {
      inset-inline: 0 auto;
      border-inline-start: 0;
      border-inline-end: 1px solid var(--t-line-strong);
    }
    /* A panel beside the corner, not a sheet over the foot: the map is told nothing covers its foot. */
    .nav,
    .bridge:has(> .com[data-detent]) > .nav {
      --map-reach: 0px;
      --map-sheet: 0px;
    }
    .grab {
      display: none;
    }
    .com-head {
      justify-content: space-between;
      padding-block-start: 0.75rem;
    }
    /* The corners on the panel's side move in beside it, so all four stay in reach, the Map's controls among them. */
    .bridge[data-shown] > :is([data-corner='find'], [data-corner='you']) {
      visibility: visible;
    }
    .bridge[data-shown][data-side='start'] > :is([data-corner='missions'], [data-corner='find']) {
      inset-inline-start: calc(min(28rem, 42%) + var(--corner-gap));
    }
    .bridge[data-shown][data-side='end'] > :is([data-corner='map'], [data-corner='you']) {
      inset-inline-end: calc(min(28rem, 42%) + var(--corner-gap));
    }
    .corner,
    .bridge[data-shown] > [data-corner='map'] {
      max-width: calc(29% - 1.5 * var(--corner-gap));
    }
    .bridge[data-shown] > [data-corner='missions'] :is(h1, .missions-open > span, strong) {
      position: static;
      width: auto;
      height: auto;
      overflow: visible;
      clip-path: none;
      white-space: normal;
    }
  }

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
    min-height: 3rem;
  }
  .com-head .back {
    flex: none;
    min-height: 3rem;
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
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 3rem;
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--t-line);
    background: transparent;
    color: var(--t-ink);
    font: inherit;
    font-size: 0.85rem;
    text-align: start;
    cursor: pointer;
  }
  .missions-open .count {
    color: var(--t-ink);
    font-weight: 600;
  }
  .missions-open[aria-expanded='true'] {
    border-color: var(--t-ink);
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
