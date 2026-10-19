<script lang="ts">
  /**
   * What the map divides the Earth by, one at a time [docs/design/map.md, Layers; Starcom's picker].
   *
   * Nation States is today's map. Zones are Starcom's partition, vendored by NavCom at each stage
   * and labelled a draft until Starcom's swap (D6). Time zones are standard offsets as Natural Earth
   * drew them (D8). None leaves the land and the missions. Choosing one fetches its own files, once,
   * from navcom.app, and nothing anywhere else [D10]: the map is drawn by this phone.
   *
   * Every hue on these screens is a watch state, so the layers are drawn in neutral weights only.
   */
  import { Panel, Readout, Slot, Why } from '$lib/components/panel';
  import type { Nav } from '$lib/com/screens';
  import { MAP_LAYERS, layerData, mapLayers, type MapLayer } from '$lib/grid/layer.svelte';
  import { forgetWork, workSector } from './work';

  let { nav }: { nav: Nav } = $props();

  const NAMES: Record<MapLayer, { name: string; what: string }> = {
    nations: { name: 'Nation States', what: 'countries, and provinces where the directory has regions' },
    zones: { name: 'Zones', what: 'Starcom’s Terrae and Maria, their Zones and Sectors' },
    timezones: { name: 'Time zones', what: 'standard offsets from UTC' },
    none: { name: 'None', what: 'the land, and the missions' }
  };

  const outlines = $derived(mapLayers.loaded >= 0 ? layerData.outlines : null);
  const navcom = $derived(outlines?.navcom ?? null);
  let work = $state(workSector());
</script>

<div data-screen="layers" data-layer={mapLayers.chosen}>
  <Panel label="Map" post={NAMES[mapLayers.chosen].name}>
    <fieldset class="nc-layers">
      <legend>What the map divides the Earth by</legend>
      {#each MAP_LAYERS as id (id)}
        <label class="nc-layer" data-layer-option={id}>
          <input type="radio" name="map-layer" value={id} checked={mapLayers.chosen === id} onchange={() => (mapLayers.chosen = id)} />
          <span><b>{NAMES[id].name}</b> <span class="nc-layer-what">{NAMES[id].what}</span></span>
        </label>
      {/each}
    </fieldset>
    {#if mapLayers.chosen === 'zones'}
      <Slot k="Zones">
        {#if mapLayers.zones === 'ready' && navcom}
          <Readout
            value={navcom.draft ? `Draft, stage ${navcom.stage}` : 'Starcom’s partition'}
            tone={navcom.draft ? 'warn' : 'neutral'}
            sub={navcom.draft ? 'view only: ids may change before Starcom’s swap' : null}
          />
        {:else if mapLayers.zones === 'absent'}
          <Readout value="Not in this build" tone="cold" sub="vendored as each of Starcom’s stages lands" />
        {:else if mapLayers.zones === 'failed'}
          <Readout value="Not loaded" tone="warn" sub="it needs one visit with a connection" />
        {:else}
          <Readout value="Loading" tone="cold" />
        {/if}
      </Slot>
    {:else if mapLayers.chosen === 'timezones'}
      <Slot k="Time zones">
        {#if mapLayers.times === 'failed'}
          <Readout value="Not loaded" tone="warn" sub="it needs one visit with a connection" />
        {:else}
          <Readout value="Standard time" tone="neutral" sub="as drawn in 2012; no daylight saving" />
        {/if}
      </Slot>
    {/if}
  </Panel>

  {#if mapLayers.chosen === 'zones' && mapLayers.zones === 'ready' && outlines && navcom}
    <Panel label="Zones" post="{outlines.containers.length} Terrae and Maria">
      <ul class="nc-areas">
        {#each outlines.containers as c (c.id)}
          <li><button type="button" data-zone-open={c.id} onclick={() => nav.open({ kind: 'zone', id: c.id! })}>{c.name}</button></li>
        {/each}
      </ul>
      <div class="nc-rail">
        <button type="button" data-lookup-here onclick={() => nav.open({ kind: 'lookup' })}>Which Sector is this phone in?</button>
      </div>
      <Slot k="Credit"><Readout value="CC BY 4.0" tone="neutral" sub={navcom.credit} /></Slot>
    </Panel>
  {/if}

  {#if work}
    <Panel label="Where you work" post="On this phone">
      <Slot k="Sector"><Readout value={work.name} tone="neutral" verbatim sub="kept here only; a wipe takes it" /></Slot>
      <div class="nc-rail">
        <button type="button" data-work-open onclick={() => nav.open({ kind: 'zone', id: work!.id })}>Open it</button>
        <button type="button" data-work-forget onclick={() => { forgetWork(); work = null; }}>Forget it</button>
      </div>
    </Panel>
  {/if}

  <Why summary="Where the layers come from">
    <p>
      Nation States and Time zones are Natural Earth’s, which is in the public domain. Zones are
      Starcom’s partition of the whole Earth, licensed CC BY 4.0, which NavCom copies into its own
      build at each stage and checks first: nothing is fetched from Starcom, and nothing about where
      you look is sent anywhere.
    </p>
  </Why>
</div>

<style>
  .nc-layers {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .nc-layers legend {
    margin-bottom: 0.4rem;
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--t-faint);
  }
  .nc-layer {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    min-height: 3rem;
    padding: 0.4rem 0.7rem;
    border: 1px solid var(--t-line);
    background: var(--t-sunk);
    color: var(--t-ink);
    cursor: pointer;
  }
  .nc-layer:has(input:checked) {
    border-color: var(--t-ink);
  }
  .nc-layer input {
    width: 1.25rem;
    height: 1.25rem;
    margin: 0;
    accent-color: var(--t-ink);
  }
  .nc-layer-what {
    display: block;
    font-size: 0.8rem;
    color: var(--t-muted);
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
  .nc-rail button {
    min-height: 3rem;
    padding: 0 0.8rem;
    border: 1px solid var(--t-line);
    background: var(--t-sunk);
    color: var(--t-ink);
    font: inherit;
    cursor: pointer;
  }
  .nc-rail {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
</style>
