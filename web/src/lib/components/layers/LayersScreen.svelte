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
   *
   * Over whichever is chosen, two things somebody can tick: **day and night**, worked out on this phone
   * from its own clock and drawn over any layer (Time zones always draws it), and over Nation States
   * **the directory by when it was last checked**. Each has its own code, loaded when ticked.
   */
  import { Panel, Readout, Slot, Why } from '$lib/components/panel';
  import type { Nav } from '$lib/com/screens';
  import { MAP_LAYERS, daylightDrawn, layerData, mapLayers, type MapLayer } from '$lib/grid/layer.svelte';
  import { forgetWork, workSector } from './work';

  let { nav }: { nav: Nav } = $props();

  const NAMES: Record<MapLayer, { name: string; what: string }> = {
    nations: { name: 'Nation States', what: 'countries, and provinces where the directory has regions' },
    zones: { name: 'Zones', what: 'Starcom’s Terrae and Maria, their Zones and Sectors' },
    spheres: { name: 'Spheres', what: 'cited lists of the countries in each, overlapping' },
    timezones: { name: 'Time zones', what: 'standard offsets from UTC, with day and night' },
    none: { name: 'None', what: 'the land, and the missions' }
  };

  const outlines = $derived(mapLayers.loaded >= 0 ? layerData.outlines : null);
  const spheresFile = $derived(mapLayers.loaded >= 0 ? layerData.spheres : null);
  const navcom = $derived(outlines?.navcom ?? null);
  let work = $state(workSector());

  /** Where the sun is overhead, as day and night worked it out, to the minute. */
  const sun = $derived(mapLayers.loaded >= 0 ? layerData.sun : null);
  const deg = (v: number, pos: string, neg: string) => `${Math.abs(Math.round(v))}°${v >= 0 ? pos : neg}`;

  /** The full key of the directory's ages, from their own code once it is here: every class, and how many regions. */
  let agesKey = $state.raw<typeof import('$lib/grid/layers/ages') | null>(null);
  $effect(() => {
    if (!mapLayers.ages || mapLayers.agesFile !== 'ready' || agesKey) return;
    void import('$lib/grid/layers/ages').then((m) => (agesKey = m), () => undefined);
  });
  const openSphere = (id: string) => nav.open({ kind: 'sphere', id, code: null });
  /** A layer chosen; leaving Spheres lets go of the Sphere hatched, so it is never found still hatched on return. */
  function choose(id: MapLayer) {
    mapLayers.chosen = id;
    if (id !== 'spheres') mapLayers.sphere = null;
  }
  const ageRows = $derived(agesKey && mapLayers.loaded >= 0 && mapLayers.agesFile === 'ready' ? agesKey.key() : []);
</script>

<div data-screen="layers" data-layer={mapLayers.chosen}>
  <Panel label="Map" post={NAMES[mapLayers.chosen].name}>
    <fieldset class="nc-layers">
      <legend>What the map divides the Earth by</legend>
      {#each MAP_LAYERS as id (id)}
        <label class="nc-layer" data-layer-option={id}>
          <input type="radio" name="map-layer" value={id} checked={mapLayers.chosen === id} onchange={() => choose(id)} />
          <span><b>{NAMES[id].name}</b> <span class="nc-layer-what">{NAMES[id].what}</span></span>
        </label>
        {#if id === 'nations' && mapLayers.chosen === 'nations'}
          <!-- Over Nation States only: each region's ring, by its oldest check, read against this phone's clock. -->
          <label class="nc-layer nc-over" data-ages-option>
            <input type="checkbox" data-ages bind:checked={mapLayers.ages} />
            <span><b>Directory by last check</b> <span class="nc-layer-what">how long ago each region’s oldest check was, on this phone’s clock</span></span>
          </label>
        {/if}
      {/each}
    </fieldset>
    <label class="nc-layer nc-check" data-daylight-option>
      {#if mapLayers.chosen === 'timezones'}
        <input type="checkbox" data-daylight checked disabled />
      {:else}
        <input type="checkbox" data-daylight bind:checked={mapLayers.daylight} />
      {/if}
      <span><b>Day and night</b> <span class="nc-layer-what">{mapLayers.chosen === 'timezones' ? 'always drawn with Time zones' : 'where the sun is up, over any layer'}</span></span>
    </label>
    {#if daylightDrawn()}
      <Slot k="Sun">
        {#if mapLayers.sun === 'failed'}
          <Readout value="Not loaded" tone="warn" sub="it needs one visit with a connection" />
        {:else if sun}
          <Readout
            value="Overhead at {deg(sun.lat, 'N', 'S')} {deg(sun.lon, 'E', 'W')}"
            tone="neutral"
            sub="{new Date(sun.at).toISOString().slice(11, 16)} UTC by this phone’s clock; worked out here, nothing fetched"
          />
        {:else}
          <Readout value="Working it out" tone="cold" />
        {/if}
      </Slot>
    {/if}
    {#if mapLayers.chosen === 'nations' && mapLayers.ages}
      <Slot k="Checked">
        {#if mapLayers.agesFile === 'failed'}
          <Readout value="Not loaded" tone="warn" sub="it needs one visit with a connection" />
        {:else if ageRows.length > 0}
          <ul class="nc-key" data-ages-key>
            {#each ageRows as row (row.reading)}
              <li data-age-row={row.reading}>
                <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" class="nc-mark nc-{row.mark}">
                  {#if row.mark === 'square'}<rect x="2" y="2" width="8" height="8" />{:else}<circle cx="6" cy="6" r={row.mark === 'dot' ? 3.5 : 4.5} />{/if}
                </svg>
                <span>{row.text}</span><span class="nc-key-n">{row.regions.toLocaleString('en-US')}</span>
              </li>
            {/each}
          </ul>
          <!-- What the windows mean, once, one layer down: no class claims it, since the dates know no fields. -->
          <div data-ages-note><Why summary="What the ages mean"><p>{agesKey?.KEY_NOTE}</p></Why></div>
        {:else}
          <Readout value="Loading" tone="cold" />
        {/if}
      </Slot>
    {/if}
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
    {:else if mapLayers.chosen === 'spheres'}
      <Slot k="Spheres">
        {#if mapLayers.spheres === 'ready' && spheresFile}
          <Readout
            value={spheresFile.navcom.draft ? 'Draft lists' : 'Cited lists'}
            tone={spheresFile.navcom.draft ? 'warn' : 'neutral'}
            sub={spheresFile.navcom.draft ? 'until their author says they are final' : null}
          />
        {:else if mapLayers.spheres === 'absent'}
          <Readout value="Not in this build" tone="cold" sub="vendored when the cited lists land" />
        {:else if mapLayers.spheres === 'failed'}
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

  {#if mapLayers.chosen === 'spheres' && mapLayers.spheres === 'ready' && spheresFile}
    <Panel label="Spheres" post="{spheresFile.spheres.length} lists">
      <!-- All alike, or one picked out, hatched: opening one picks it out on the map. -->
      <div class="nc-rail">
        <button type="button" data-sphere-all aria-pressed={mapLayers.sphere === null} onclick={() => (mapLayers.sphere = null)}>All</button>
      </div>
      <ul class="nc-areas">
        {#each spheresFile.spheres as s (s.id)}
          <li><button type="button" data-sphere-open={s.id} aria-pressed={mapLayers.sphere === s.id} onclick={() => openSphere(s.id)}>{s.name}</button></li>
        {/each}
      </ul>
      <Slot k="Credit"><Readout value={spheresFile.navcom.licence === 'CC-BY-4.0' ? 'CC BY 4.0' : (spheresFile.navcom.licence ?? 'Not said')} tone="neutral" sub={spheresFile.navcom.credit} /></Slot>
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
      you look is sent anywhere. The Spheres are cited lists of countries, copied the same way; a
      small state too small for the world’s outlines is a circle at Natural Earth’s label point.
    </p>
    <p>
      Day and night is worked out on this phone from its own clock, and nothing is fetched for it: the
      sun’s position to about a kilometre; the line to within tens of kilometres, since it is drawn in
      short straight steps and the air bends sunlight near the horizon; and all of it only as right as
      this phone’s clock. The directory’s ages are the dates its places were last checked, read against
      this phone’s clock, so they age on the map as they do on each place’s page; they say how old a
      check is, and each place’s own page says what that check still lets it show.
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
  /* Over the layer above it, so set in under it. */
  .nc-over {
    margin-inline-start: 1.6rem;
  }
  .nc-check {
    margin-block: 0.6rem 0.2rem;
  }
  .nc-key {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 0.85rem;
  }
  .nc-key li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .nc-key-n {
    margin-inline-start: auto;
    font-family: var(--font-mono);
    color: var(--t-muted);
  }
  /* The marks as the map draws them: shape carries the class, and tone only adds to it. */
  .nc-mark {
    flex: none;
    stroke-width: 1.5;
  }
  .nc-disc { fill: var(--t-ink); }
  .nc-dot { fill: var(--t-muted); }
  .nc-ring { fill: none; stroke: var(--t-muted); }
  .nc-square { fill: none; stroke: var(--t-faint); }
  .nc-areas {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .nc-areas button[aria-pressed='true'],
  .nc-rail button[aria-pressed='true'] {
    border-color: var(--t-ink);
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
