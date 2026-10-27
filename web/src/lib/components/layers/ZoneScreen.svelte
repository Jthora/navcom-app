<script lang="ts">
  /**
   * One Terra, Mare, Zone or Sector of Starcom's partition, opened from the map or from a list
   * [docs/design/map.md, Zones; D6, D10].
   *
   * Opening a Terra, a Mare or a Zone opens its container: that container's Sectors are fetched, once,
   * then and only then, never because of what is on screen. **Opening a Sector fetches nothing**: it
   * can be opened from the lookup or from where somebody works, both chosen by where a person is, and a
   * fetch of its container would tell navcom.app's host which Terra that is (D7). So a Sector is drawn
   * from what the phone already holds: its Zone and Terra from the outlines, and its name from its
   * container's file if that is already open, else from the lookup's index, else from where somebody
   * works. Its landform needs its container, and says how to fetch it and what that tells the host.
   *
   * Where it sits reads down the levels, Terra › Zone › Sector, each a way up. While the partition is a
   * draft it says so and keeps nothing; once it is final, a Sector can be kept as where somebody works,
   * on this phone only [D7].
   *
   * And what is open there: **missions, counted, never people**, from the missions already on this
   * phone, placed by the point each package gives its subject, or with none by the Zone it names, and
   * never by its jurisdiction, which names no Zone. Those are counted apart and said to be [map.md,
   * Missions on Zones].
   */
  import type { Mission } from '@navcom/core';
  import { Panel, Readout, Slot } from '$lib/components/panel';
  import type { Nav } from '$lib/com/screens';
  import type { Feed } from '$lib/missions/live';
  import { layerData, mapLayers } from '$lib/grid/layer.svelte';
  import { namedOfMissions, placesOfMissions } from '$lib/grid/places';
  import { keepWork, workSector } from './work';

  let { id, nav, active = [], feed }: { id: string; nav: Nav; active?: readonly Mission[]; feed?: Feed } = $props();

  /** What counts the missions by Zone: its own code, by `import()`, as the map loads it [budget.mjs MAP_LINES]. */
  let counting = $state.raw<typeof import('$lib/grid/layers/zone-missions') | null>(null);
  $effect(() => void import('$lib/grid/layers/zone-missions').then((m) => (counting = m), () => undefined));
  /** The feed's age, as the map's key says it; null while the missions have not been read, which is unknown. */
  const age = $derived.by(() => {
    if (feed?.status === 'live') return 'live';
    if (feed?.status !== 'cached') return null;
    const t = feed.at;
    return `as of ${t.toISOString().slice(0, 16).replace('T', ' ')} UTC, offline`;
  });
  const rings = $derived(placesOfMissions(active).flatMap((p) => (p.kind === 'mission' ? [p] : [])));
  const byName = $derived(namedOfMissions(active));

  /** The Zones' own code, which reads them: loaded by `import()`, as the map loads it [budget.mjs MAP_LINES]. */
  let zones = $state.raw<typeof import('$lib/grid/layers/zones') | null>(null);
  // The outlines, and, for a container or a Zone, that container's Sectors: loaded here too, for a screen
  // Back or a reload lands on. Never for a Sector, whose container is the one thing it must not ask for.
  $effect(() => {
    const want = id;
    void import('$lib/grid/layers/zones').then(
      async (m) => {
        zones = m;
        await m.loadOutlines();
        if (want.includes('/sector:')) return;
        const c = layerData.outlines ? m.chainOf(layerData.outlines, want, {}) : null;
        if (c) await m.openContainer(c.container.id!);
      },
      () => (mapLayers.zones = 'failed')
    );
  });

  /** What the Zones' code has loaded, read again each time it says it loaded more. */
  const data = $derived(mapLayers.loaded >= 0 ? { ...layerData } : layerData);
  const outlines = $derived(data.outlines);
  const chain = $derived(outlines && zones ? zones.chainOf(outlines, id, data.sectors) : null);
  const isSector = $derived(id.includes('/sector:'));
  const level = $derived(isSector ? 'Sector' : id.startsWith('zone:') ? 'Zone' : id.startsWith('mare:') ? 'Mare' : 'Terra');
  const opened = $derived(chain ? (data.opening[chain.container.id!] ?? 'loading') : 'loading');
  const zonesHere = $derived(chain && outlines ? outlines.zones.filter((z) => z.props.parent === chain.container.id) : []);
  const sectorsHere = $derived(chain?.zone ? (data.sectors[chain.container.id!] ?? []).filter((s) => s.id?.startsWith(`${chain.zone!.id}/`)) : []);
  const draft = $derived(outlines?.navcom.draft ?? true);
  const work = workSector();
  let kept = $state(work?.id ?? null);
  /** A Sector's name, from whatever on the phone has it: its container's file, the lookup's index, where somebody works. */
  const named = $derived(isSector ? (chain?.sector?.name ?? data.named[id] ?? (work?.id === id ? work.name : null)) : null);
  /** Whether its container's Sectors are here, so a Sector missing from them is known to be missing. */
  const containerHere = $derived(chain ? data.sectors[chain.container.id!] !== undefined : false);
  /** A Sector this stage does not hold: known only once its container is open, and never fetched to find out. */
  const gone = $derived(isSector && chain !== null && containerHere && chain.sector === null);
  const containerWord = $derived(chain?.container.props.level === 'mare' ? 'Mare' : 'Terra');
  const openMission = (address: string) => nav.open({ kind: 'mission', address });
  const counted = $derived(counting && outlines ? counting.countsOf(outlines, data.sectors, rings, data.sectorDrift, byName) : null);
  const openHere = $derived(counted?.in.get(id) ?? []);
  const nearHere = $derived(counted?.near.get(id) ?? []);

  function keep() {
    if (!isSector || !named || !chain?.zone || !outlines || draft) return;
    const ok = keepWork({
      id,
      name: named,
      zone: chain.zone.id!,
      ...(chain.zone.name ? { zoneName: chain.zone.name } : {}),
      container: chain.container.id!,
      ...(chain.container.name ? { containerName: chain.container.name } : {}),
      manifest: outlines.navcom.manifest_sha256
    });
    if (ok) kept = id;
  }
</script>

<div data-screen="zone" data-zone={id}>
  {#if mapLayers.zones === 'absent'}
    <Readout value="Not in this build" tone="cold" sub="vendored as each of Starcom’s stages lands" />
  {:else if mapLayers.zones === 'failed'}
    <strong class="unloaded" data-zone-failed>Not loaded — it needs one visit with a connection</strong>
  {:else if !outlines || !zones}
    <Readout value="Loading" tone="cold" />
  {:else if !chain || gone}
    <Panel label={level} post="Not here now">
      <Slot k="Id"><Readout value="Not in this stage" tone="cold" sub={id} /></Slot>
    </Panel>
  {:else}
    {@const here = chain.zone ?? chain.container}
    <Panel label={level} post={isSector ? (named ?? id) : (here.name ?? here.id)}>
      <nav class="nc-chain" aria-label="Where it sits" data-chain>
        <button type="button" disabled={!isSector && here === chain.container} onclick={() => nav.open({ kind: 'zone', id: chain.container.id! })}>{chain.container.name}</button>
        {#if chain.zone}<span aria-hidden="true">›</span>
          <button type="button" disabled={!isSector && here === chain.zone} onclick={() => nav.open({ kind: 'zone', id: chain.zone!.id! })}>{chain.zone.name}</button>{/if}
        {#if isSector}<span aria-hidden="true">›</span> <span class="nc-chain-here">{named ?? id}</span>{/if}
      </nav>
      {#if !isSector && chain.zone && typeof chain.zone.props.system === 'string'}
        <Slot k="System"><Readout value={chain.zone.props.system} tone="neutral" /></Slot>
      {/if}
      {#if isSector && chain.sector && typeof chain.sector.props.descriptor === 'string'}
        <Slot k="Landform"><Readout value={chain.sector.props.descriptor} tone="neutral" verbatim sub="in the IAU’s words" /></Slot>
      {:else if isSector && !chain.sector}
        <Slot k="Landform">
          <Readout value="Not fetched" tone="cold" sub="opening its Zone fetches its {containerWord}’s Sectors, and tells navcom.app which {containerWord}" />
        </Slot>
      {/if}
      {#if !chain.zone}
        <ul class="nc-areas">
          {#each zonesHere as z (z.id)}
            <li><button type="button" data-zone-open={z.id} onclick={() => nav.open({ kind: 'zone', id: z.id! })}>{z.name}</button></li>
          {/each}
        </ul>
        {#if zonesHere.length === 0}<Slot k="Zones"><Readout value="None yet" tone="cold" sub="not in this stage" /></Slot>{/if}
      {:else if !isSector}
        {#if sectorsHere.length > 0}
          <ul class="nc-areas">
            {#each sectorsHere as s (s.id)}
              <li><button type="button" data-zone-open={s.id} onclick={() => nav.open({ kind: 'zone', id: s.id! })}>{s.name}</button></li>
            {/each}
          </ul>
        {:else}
          <Slot k="Sectors">
            {#if opened === 'absent'}<Readout value="None yet" tone="cold" sub="not in this stage" />
            {:else if opened === 'failed'}<Readout value="Not loaded" tone="warn" sub="it needs one visit with a connection" />
            {:else}<Readout value="Loading" tone="cold" />{/if}
          </Slot>
        {/if}
      {/if}
      {#if isSector}
        <Slot k="Yours">
          {#if draft}
            <Readout value="Not kept in a draft" tone="cold" sub="ids may change before Starcom’s swap" />
          {:else if kept === id}
            <Readout value="Where you work" tone="good" sub="on this phone only; a wipe takes it" />
          {:else if !named}
            <Readout value="Not known here yet" tone="cold" sub="open its Zone to see it is in this stage" />
          {:else}
            <button type="button" class="nc-keep" data-work-keep onclick={keep}>I work here</button>
          {/if}
        </Slot>
      {/if}
      <Slot k="Open missions">
        {#if age === null}
          <Readout value="Not read yet" tone="cold" sub="unknown, not none: the missions have not arrived" />
        {:else if !counted}
          <Readout value="Counting" tone="cold" />
        {:else}
          <Readout
            value={counting!.openSaid(openHere.length)}
            tone="neutral"
            sub="{age}; placed by where each package puts its subject, or the Zone it names"
          />
        {/if}
      </Slot>
      {#if age !== null && openHere.length > 0}
        <ul class="nc-areas" data-zone-missions>
          {#each openHere as m (m.address)}
            <li><button type="button" data-zone-mission={m.address} onclick={() => openMission(m.address)}>{m.title}</button></li>
          {/each}
        </ul>
      {/if}
      {#each nearHere as n (n.mission.address)}
        <!-- The drawn lines are quantised; which side of one a point that close is on, they cannot say. -->
        <Slot k="Near an edge"><Readout value="Near its edge" tone="cold" sub="{n.mission.title}: may be in {n.with.join(', ')} instead" /></Slot>
      {/each}
      {#if age !== null && counted && active.length > rings.length + counted.named}
        <Slot k="Not placed">
          <Readout value="{active.length - rings.length - counted.named} by jurisdiction only" tone="cold" sub="filed under a country or province, and placed in no Zone" />
        </Slot>
      {/if}
      <Slot k="Source">
        <Readout value={draft ? `Draft, stage ${outlines.navcom.stage}` : 'Starcom, CC BY 4.0'} tone={draft ? 'warn' : 'neutral'} sub={outlines.navcom.credit} />
      </Slot>
    </Panel>
  {/if}
</div>

<style>
  .unloaded {
    color: var(--t-ink);
    font-size: 0.9rem;
  }
  .nc-chain {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    color: var(--t-muted);
  }
  .nc-chain button {
    min-height: 3rem;
    padding: 0 0.6rem;
    border: 1px solid var(--t-line);
    background: var(--t-sunk);
    color: var(--t-ink);
    font: inherit;
    cursor: pointer;
  }
  .nc-chain button:disabled {
    border-color: transparent;
    background: transparent;
    cursor: default;
  }
  .nc-chain-here {
    color: var(--t-ink);
    font-weight: 600;
  }
  .nc-areas {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .nc-areas button,
  .nc-keep {
    min-height: 3rem;
    padding: 0 0.8rem;
    border: 1px solid var(--t-line);
    background: var(--t-sunk);
    color: var(--t-ink);
    font: inherit;
    cursor: pointer;
  }
</style>
