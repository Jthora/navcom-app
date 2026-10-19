<script lang="ts" module>
  import type { ConsoleCentroid, ConsoleRecordEntry, ConsoleRegionFigures } from '$lib/console/types';

  type Regions = { centroids: ConsoleCentroid[]; figures: Record<string, ConsoleRegionFigures> };
  /**
   * The directory's region file, the one the landing page reads as it mounts: asked for once per
   * page, and answered from the browser's cache when the page already has it. Rejected and
   * forgotten when it fails, so a place opened again once there is signal asks again.
   */
  let regionsFile: Promise<Regions> | null = null;
  function regions(): Promise<Regions> {
    regionsFile ??= fetch('/console-regions.json')
      .then((r) => (r.ok ? (r.json() as Promise<Regions>) : Promise.reject(new Error(String(r.status)))))
      .catch((e) => {
        regionsFile = null;
        throw e;
      });
    return regionsFile;
  }
</script>

<script lang="ts">
  /**
   * A place opened from the map: a province or a country, a directory region's circle, or one of
   * its records [docs/design/map.md §6: every shape is a door].
   *
   * A province or country lists the missions **filed** under its code, which is a fact about the
   * package, and then the directory regions nearest the tap **by distance**: a drawn border never
   * decides which country anything is in [map.md §3]. *Nothing open in Kenya* is a real answer,
   * not a dead tap.
   *
   * Every way in is also a way in without the map: the missions line opens every mission, and the
   * search finds every region and record.
   */
  import type { Mission } from '@navcom/core';
  import { isConfidential } from '@navcom/core';
  import { Panel, Readout, Slot } from '$lib/components/panel';
  import type { Place } from '$lib/com/screens';
  import { layerData, mapLayers } from '$lib/grid/layer.svelte';
  import MissionList from './MissionList.svelte';
  import { kmBetween } from './format';

  let {
    place,
    missions,
    status,
    now,
    onopen
  }: {
    place: Place;
    missions: readonly Mission[];
    status: 'live' | 'cached' | 'connecting' | 'unavailable' | 'unloaded';
    now: number;
    onopen: (address: string) => void;
  } = $props();

  /** A region's own clocks, from its IANA zone, once Time zones has brought them [D8]: daylight saving and all. */
  const regionClock = $derived(place.region && now && mapLayers.loaded >= 0 ? (layerData.regionTime?.(place.region) ?? null) : null);
  /**
   * When it was checked, once the directory's ages have brought their dates [layers/ages.ts]: a region's
   * oldest and newest, or a record's own, read against this phone's clock. **How long ago, and nothing
   * about what that lets a page show**: the dates know nothing of a record's fields, and most carry no
   * hours at all, so the record's own page is the one that says.
   */
  const checked = $derived(
    place.region && now && mapLayers.loaded >= 0 ? (layerData.regionAges?.(place.region, place.record === null ? undefined : Number(place.record)) ?? null) : null
  );
  const ago = (d: string) => {
    const days = Math.floor((now - Date.parse(`${d}T00:00:00Z`)) / 86_400_000);
    return days < 0 ? d : days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  };

  /** How far "near" reaches. Past it, the nearest region is somewhere else, and is said to be. */
  const NEAR_KM = 250;
  /**
   * How far from `at` the tap may have meant, in km: a thumb's width at the zoom it was made at.
   * Past `NEAR_KM` a distance to the kilometre is precision the tap does not have, so the list
   * reaches as far as the tap does, nearest first, and gives no figures (review, 2026-10-18).
   */
  const within = $derived(Number(place.within ?? 0) || 0);
  const coarse = $derived(within > NEAR_KM);
  const reach = $derived(coarse ? within : NEAR_KM);

  const at = $derived.by((): [number, number] | null => {
    const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(place.at ?? '');
    return m ? [Number(m[1]), Number(m[2])] : null;
  });

  let file = $state<Regions | null | 'failed'>(null);
  $effect(() => {
    void place;
    regions().then(
      (r) => (file = r),
      () => (file = 'failed')
    );
  });

  const near = $derived.by(() => {
    if (!at || !file || file === 'failed') return [];
    return file.centroids
      .map((c) => ({ c, km: kmBetween(at, [c.lat, c.lon]) }))
      .filter((n) => n.km <= reach)
      .sort((a, b) => a.km - b.km)
      .slice(0, 5);
  });
  const figures = $derived(place.region && file && file !== 'failed' ? (file.figures[place.region] ?? null) : null);

  /**
   * One record, read back from its region's list by its place in it: the same file a search reads
   * [grid.md §1]. History outlives a build, and a list can change between builds, so the record
   * found is checked against where the tap landed before it is shown as the one tapped.
   */
  let record = $state<{ status: 'loading' } | { status: 'failed' } | { status: 'moved' } | { status: 'ready'; entry: ConsoleRecordEntry }>({
    status: 'loading'
  });
  /** Which read is the current one: Back and forward between two records must not show the slower. */
  let reading = 0;
  $effect(() => {
    const { region, record: index } = place;
    if (region === null || index === null) return;
    const mine = ++reading;
    record = { status: 'loading' };
    fetch(`/console-index/${region}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<ConsoleRecordEntry[]>) : Promise.reject(new Error(String(r.status)))))
      .then((entries) => {
        if (mine !== reading) return;
        const entry = entries[Number(index)];
        const [lat, lon] = at ?? [NaN, NaN];
        // Where the map drew it is this record's own point, to the map's precision: anything else moved.
        const same = entry?.at && Math.abs(entry.at[1] - lat) < 2e-4 && Math.abs(entry.at[0] - lon) < 2e-4;
        record = entry && same ? { status: 'ready', entry } : { status: 'moved' };
      })
      .catch(() => {
        if (mine === reading) record = { status: 'failed' };
      });
  });
  /** No handoff for a record whose location is withheld, and none for one with nowhere to hand off [map.md §5]. */
  const handoff = $derived(
    record.status === 'ready' && record.entry.at && !isConfidential(record.entry.type)
      ? `https://www.openstreetmap.org/?mlat=${record.entry.at[1]}&mlon=${record.entry.at[0]}#map=17/${record.entry.at[1]}/${record.entry.at[0]}`
      : null
  );
</script>

<div data-screen="place" data-place={place.code ?? place.region ?? ''} data-record={place.record}>
  {#if place.record !== null && place.region !== null}
    {#if record.status === 'ready'}
      {@const entry = record.entry}
      <Panel label="Place" post={entry.name} data-record-id={entry.id}>
        <Slot k="Type"><Readout value={entry.type.replace(/_/g, ' ')} tone="neutral" sub={entry.abroad ? `in ${entry.abroad}` : null} /></Slot>
        <Slot k="Region"><Readout value={place.name} tone="neutral" verbatim /></Slot>
        {#if checked}
          <Slot k="Checked">
            <Readout value={checked.record ? `Checked ${ago(checked.record)}` : 'Unknown'} tone={checked.reading === 'current' ? 'neutral' : checked.reading === 'unknown' ? 'cold' : 'warn'} sub={checked.record ? `on ${checked.record}; its page says what that still shows` : 'it carries no check date'} />
          </Slot>
        {/if}
        <div class="nc-rail">
          <a href="/directory/{entry.id}/" data-sveltekit-reload data-record-link>Open the record</a>
          {#if handoff}<a href={handoff} rel="noreferrer" data-handoff>Open in maps</a>{/if}
        </div>
      </Panel>
    {:else if record.status === 'moved'}
      <Panel label="Place" post={place.name}>
        <Slot k="Place"><Readout value="Not here now" tone="cold" sub="the directory changed since; search for it" /></Slot>
      </Panel>
    {:else if record.status === 'failed'}
      <strong class="unloaded" data-place-failed>Not loaded — it needs one visit with a connection</strong>
    {:else}
      <Readout value="Loading" tone="cold" />
    {/if}
  {:else if place.region !== null}
    <Panel label="Region" post={place.name}>
      <Slot k="Records">
        {#if figures}
          <Readout value="{figures.records} places" tone="neutral" />
        {:else if file === 'failed'}
          <Readout value="Unknown" tone="cold" sub="not loaded" />
        {:else}
          <Readout value="Loading" tone="cold" />
        {/if}
      </Slot>
      {#if Number(place.unmapped) > 0}
        <!-- Held back until D5, or with nowhere to draw: said, so the map's gap is not read as none [invariant 7]. -->
        <Slot k="Map">
          <Readout value="{place.unmapped} not on the map" tone="neutral" sub="search, or open the region" />
        </Slot>
      {/if}
      {#if checked}
        <!-- By its oldest record, the cautious word; the newest beside it, so one fresh check is not read as all of them. -->
        <Slot k="Checked">
          {#if checked.oldest}
            <Readout value="Oldest {ago(checked.oldest)}" tone={checked.reading === 'current' ? 'neutral' : 'warn'} sub="newest {checked.newest === checked.oldest ? 'the same' : ago(checked.newest ?? checked.oldest)}; each place’s page says what its check still shows" />
          {:else}
            <Readout value="Unknown" tone="cold" sub="none of its places carries a check date" />
          {/if}
        </Slot>
      {/if}
      {#if regionClock}
        <Slot k="Local time"><Readout value={regionClock.time} tone="neutral" verbatim sub="times are local to {regionClock.zone.replace(/_/g, ' ')}" /></Slot>
      {/if}
      <Slot k="Verify">
        {#if figures && figures.confirmedByPerson > 0}
          <Readout value="{figures.confirmedByPerson} confirmed by a person" tone="good" />
        {:else if figures}
          <Readout value="Nothing confirmed yet" tone="warn" sub="all of it is unverified" />
        {/if}
      </Slot>
      <div class="nc-rail">
        <a href="/directory/area/{place.region}/" data-sveltekit-reload data-area-link>Open {place.name} in the directory</a>
      </div>
    </Panel>
  {:else}
    {#if place.code !== null}
      <MissionList {missions} province={null} place={{ code: place.code, name: place.name }} {status} {now} {onopen} />
    {/if}

    <Panel label="Directory" post="Near here">
      {#if near.length > 0}
        <ul class="nc-near" data-near={coarse ? 'coarse' : 'measured'}>
          {#each near as n (n.c.region)}
            <li>
              <a href="/directory/area/{n.c.region}/" data-sveltekit-reload data-near-region={n.c.region}>{n.c.name}</a>
              {#if !coarse}<span class="nc-near-km">{Math.round(n.km)} km</span>{/if}
            </li>
          {/each}
        </ul>
        {#if coarse}
          <Readout value="Nearest first" tone="cold" sub="zoom in to measure from the tap" />
        {/if}
      {:else}
        <Slot k="Regions">
          {#if file === 'failed'}
            <Readout value="Unknown" tone="cold" sub="not loaded" />
          {:else if file === null}
            <Readout value="Loading" tone="cold" />
          {:else}
            <Readout value="None near" tone="cold" sub="no directory region within {Math.round(reach)} km" />
          {/if}
        </Slot>
      {/if}
    </Panel>
  {/if}
</div>

<style>
  .unloaded {
    color: var(--t-ink);
    font-size: 0.9rem;
  }
  .nc-near {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .nc-near li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    min-height: 3rem;
    padding: 0 0.7rem;
    border: 1px solid var(--t-line);
    background: var(--t-sunk);
  }
  .nc-near a {
    color: var(--t-ink);
    font-weight: 600;
  }
  .nc-near-km {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    color: var(--t-faint);
  }
  .nc-rail a {
    display: inline-flex;
    align-items: center;
    min-height: 3rem;
  }

</style>
