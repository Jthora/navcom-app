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
  import { onMount } from 'svelte';
  import '$lib/terminal/tokens.css';
  import '$lib/terminal/screen.css';
  import '$lib/terminal/panel.css';
  import { Panel, Slot, Readout, Why } from '$lib/components/panel';
  import { search, type ConsoleHit } from '$lib/console/search';
  import type { ConsoleRecordEntry } from '$lib/console/types';
  import { locateOnce, nearest } from '$lib/console/position-once';
  import type { ConsoleCentroid } from '$lib/console/types';
  import { get, set } from '$lib/terminal/storage';

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
  const regionList = $derived(
    Object.values(data.regionFigures).sort((a, b) => a.name.localeCompare(b.name))
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
          regionName: loaded!.name
        }))
      : []
  );
  const results = $derived(query.trim() ? typed : defaultResults);

  /** For when geolocation is denied or absent and nothing has been typed yet. */
  let manualRegion = $state('');
  const regionOptions = $derived(
    Object.values(data.regionFigures).sort((a, b) => a.name.localeCompare(b.name))
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
    focusedRegionSlug ? (data.regionFigures[focusedRegionSlug] ?? null) : null
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
    void locateOnce().then(async (fix) => {
      if (fix) nearRegion = nearest(fix, data.centroids);
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
    content="Look up who takes someone tonight, and see the real state of the network — no setup, no account."
  />
</svelte:head>

<div class="terminal">
  <!--
    Not "The Watchtower" — that term is precise elsewhere in this project (a specific node's
    keypair, docs/spec/bootstrap.spec.md) and reserving it there is the point: it names a
    daemon an operator can be pointed at, not a brand. This is the one screen every kind of
    visitor sees first, including the majority who will never touch a watch at all — the
    product's own name belongs here unqualified.
  -->
  <header>
    <h1>NavCom</h1>
  </header>

  <!-- A first automated accessibility pass (axe-core, this session) found this content sitting
       outside any landmark region — true of every terminal screen too, fixed there the same
       way. `<main>` is the minimal fix, not a redesign. -->
  <main>
  <!--
    Nav and Com, side by side once there is room to show it — the split is the point
    [docs/positioning.md: "On a ship's bridge, Navigation and Communications are separate
    stations. NavCom fuses them into one post."]. Stacked below `--bridge-break`, because the
    device floor this project designs for is a phone, and a bridge that only exists on a wide
    monitor is not the one this project is actually for.
  -->
  <div class="nc-bridge">
    <Panel label="Nav" post={nearRegion ? `Near ${nearRegion.name}` : null}>
      <label for="lookup" class="nc-lookup-label">Where are you, or what do you need</label>
      <input
        id="lookup"
        type="search"
        bind:value={query}
        placeholder="a shelter, a clinic, a city…"
        autocomplete="off"
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
                  <span class="nc-results-meta">{r.type.replace(/_/g, ' ')} · {r.regionName}</span>
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
          Searched on this device, with nothing sent anywhere. Places elsewhere are found by
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
            callsign, find the listing, tap report a problem. No account, and it works with
            no signal.
          </p>
          <p>
            Your correction is <strong>added</strong> under your callsign, or anonymously if
            you have not picked one — it cannot delete a listing or overrule anybody, and
            nobody has to approve it.
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
            promises — <em>"2 on-call, both SMS-reachable"</em> or
            <em>"0 on-call, Distress pages nobody and says so."</em>
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
            value={health.commit ? health.commit.slice(0, 7) : 'unknown'}
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
      </Why>
    </Panel>
  </div>

  <a class="nc-act" data-act data-tone="warn" href="/terminal/" data-sveltekit-reload>
    <span class="nc-act-label">Open the Field Terminal</span>
  </a>

  <!--
    Reachable from every screen, not just one [signature.spec.ts already asserts this for the
    terminal] — this page is another screen of the same app now, not a separate site, so the
    same rule applies here.
  -->
  <button
    class="signature"
    data-signature-toggle
    aria-pressed={sig === 'low'}
    onclick={() => {
      sig = sig === 'low' ? 'document' : 'low';
      setSignature(sig);
    }}
  >{sig === 'low' ? 'Document' : 'Low signature'}</button>
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
  .terminal {
    max-width: 68rem;
    margin: 0 auto;
    padding-inline: 1.25rem;
  }

  .nc-bridge {
    display: grid;
    gap: 1rem;
  }
  /* panel.css's own `.nc-panel { margin: 0 0 1rem }` would double up with the grid gap. */
  .nc-bridge :global(.nc-panel) {
    margin-bottom: 0;
  }
  @media (min-width: 48rem) {
    .nc-bridge {
      grid-template-columns: 1fr 1fr;
      align-items: start;
    }
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
