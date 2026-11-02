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
   * Over whichever is chosen, things somebody can tick: **day and night**, worked out on this phone
   * from its own clock and drawn over any layer (Time zones always draws it); over Nation States **the
   * directory by when it was last checked**; and over any layer **Hazards**, the one thing on the map
   * that asks anybody outside navcom.app. Each has its own code, loaded when ticked.
   *
   * **Hazards says what it asks before it is ticked**, beside the box: which three hosts, that each sees
   * this phone's address and not where you are looking, and what each round costs [$lib/outside]. The
   * choice lasts the page's life and is never stored, so a reload asks nobody.
   */
  import { Panel, Readout, Slot } from '$lib/components/panel';
  import type { Nav } from '$lib/com/screens';
  import { MAP_LAYERS, daylightDrawn, layerData, mapLayers, type MapLayer } from '$lib/grid/layer.svelte';
  import { HAZARD_FEEDS, HAZARDS_PEAK_KB, HAZARDS_ROUND_KB, agoOf, type HazardFeedId } from '$lib/outside';
  import { forgetWork, workSector } from './work';
  import MapKey from './MapKey.svelte';

  let { nav }: { nav: Nav } = $props();

  const NAMES: Record<MapLayer, { name: string; what: string }> = {
    nations: { name: 'Nation States', what: 'countries and provinces' },
    zones: { name: 'Zones', what: 'Starcom’s Terrae, Maria, Zones and Sectors' },
    spheres: { name: 'Spheres', what: 'lists of countries and organisations of states' },
    timezones: { name: 'Time zones', what: 'standard offsets from UTC' },
    none: { name: 'None', what: 'land and missions only' }
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

  /** What Hazards has read, per feed, moving on each minute it is on and with every answer. */
  const hazardsHeld = $derived(mapLayers.loaded >= 0 ? layerData.hazards : null);
  const hazardsAt = $derived(mapLayers.loaded >= 0 ? Date.now() : 0);
  const CAPPED = 'too large; not asked again on this page';
  /**
   * One feed's row: how many it listed and when, or that it was not read, which is unknown and never
   * none. *Nothing listed* only when nothing was left out either; an ask of it that did not answer by
   * what it lists.
   */
  function feedRow(id: HazardFeedId): string {
    const f = hazardsHeld?.feeds[id];
    if (!f || f.state === 'unread') return 'not read: unknown';
    if (f.state === 'loading') return 'asking';
    if (f.state === 'failed') return `not read: unknown · ${f.malformed ? 'its answer could not be read' : 'the ask failed'}`;
    if (f.state === 'too-large') return `not read: unknown · ${CAPPED}`;
    const extra = [
      ...f.missing.map((m) => `${m.part} not read: unknown, ${m.why === 'too-large' ? CAPPED : 'the ask failed'}`),
      f.notDrawn > 0 ? `${f.notDrawn} given only as an area, not drawn` : '',
      f.dropped + f.capped > 0 ? `${f.dropped + f.capped} left out` : ''
    ]
      .filter(Boolean)
      .map((x) => ` · ${x}`)
      .join('');
    const none = f.count + f.dropped + f.notDrawn + f.capped === 0 && f.missing.length === 0 ? 'nothing listed' : 'nothing drawn';
    return `${f.count === 0 ? none : `${f.count.toLocaleString('en-US')} listed`} · read ${agoOf(f.readAt ?? hazardsAt, hazardsAt)}${extra}`;
  }
</script>

<div data-screen="layers" data-layer={mapLayers.chosen}>
  <Panel label="Map" post={NAMES[mapLayers.chosen].name}>
    <fieldset class="nc-layers">
      <legend>Layer</legend>
      {#each MAP_LAYERS as id (id)}
        <label class="nc-layer" data-layer-option={id}>
          <input type="radio" name="map-layer" value={id} checked={mapLayers.chosen === id} onchange={() => choose(id)} />
          <span><b>{NAMES[id].name}</b> <span class="nc-layer-what">{NAMES[id].what}</span></span>
        </label>
        {#if id === 'nations' && mapLayers.chosen === 'nations'}
          <!-- Over Nation States only: each region's ring, by its oldest check, read against this phone's clock. -->
          <label class="nc-layer nc-over" data-ages-option>
            <input type="checkbox" data-ages bind:checked={mapLayers.ages} />
            <span><b>Directory by last check</b> <span class="nc-layer-what">how long ago each region was checked</span></span>
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
      <span><b>Day and night</b> <span class="nc-layer-what">{mapLayers.chosen === 'timezones' ? 'always on with Time zones' : 'where the sun is up'}</span></span>
    </label>
    <label class="nc-layer nc-check" data-hazards-option>
      <input type="checkbox" data-hazards bind:checked={mapLayers.hazards} aria-describedby="nc-hazards-ask" />
      <span><b>Hazards</b> <span class="nc-layer-what">fires, volcanoes, storms, floods, droughts and earthquakes</span></span>
    </label>
    <!--
      The one layer that asks anybody outside navcom.app, so who it asks and what they learn is said
      before it is chosen, beside the box [D10]. One line since 2026-11-01.
    -->
    <div class="nc-ask" id="nc-hazards-ask" data-hazards-ask>
      <span>
        Asks {#each HAZARD_FEEDS as f, i (f.id)}<b class="nc-host">{f.host}</b>{i === HAZARD_FEEDS.length - 2 ? ' and ' : i < HAZARD_FEEDS.length - 1 ? ', ' : ''}{/each},
        each of which sees this phone’s internet address, not where you are looking on the map. Every
        10 minutes while the map is open: about {HAZARDS_ROUND_KB} kB, up to {HAZARDS_PEAK_KB} kB in a fire season.
      </span>
    </div>
    {#if mapLayers.hazards}
      <Slot k="Hazards">
        {#if mapLayers.hazardsCode === 'failed'}
          <Readout value="Not loaded" tone="warn" sub="it needs one visit with a connection" />
        {:else}
          <ul class="nc-key" data-hazards-feeds>
            {#each HAZARD_FEEDS as f (f.id)}
              <li data-hazard-feed={f.id} data-state={hazardsHeld?.feeds[f.id].state ?? 'unread'}>
                <span>{f.name}</span><span class="nc-key-n">{feedRow(f.id)}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </Slot>
    {/if}
    {#if daylightDrawn()}
      <Slot k="Sun">
        {#if mapLayers.sun === 'failed'}
          <Readout value="Not loaded" tone="warn" sub="it needs one visit with a connection" />
        {:else if sun}
          <Readout
            value="Overhead at {deg(sun.lat, 'N', 'S')} {deg(sun.lon, 'E', 'W')}"
            tone="neutral"
            sub="{new Date(sun.at).toISOString().slice(11, 16)} UTC by this phone’s clock"
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
                  <path d={row.mark === 'square-small' ? 'M3 3h6v6H3z' : 'M1.5 1.5h9v9h-9z'} />{#if row.mark === 'square-cross'}<path d="M1.5 1.5l9 9M10.5 1.5l-9 9" />{/if}
                </svg>
                <span>{row.text}</span><span class="nc-key-n">{row.regions.toLocaleString('en-US')}</span>
              </li>
            {/each}
          </ul>
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

  <!-- The map's whole key: every line its key says, with the rest of its words, and every mark drawn as it is drawn. -->
  <MapKey />

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
    {#if spheresFile.organisations?.length}
      <!-- Organisations of states, on the same layer: only a member is shaded when one is opened. -->
      <Panel label="Organisations" post="{spheresFile.organisations.length} of states">
        <ul class="nc-areas">
          {#each spheresFile.organisations as o (o.id)}
            <li><button type="button" data-sphere-open={o.id} aria-pressed={mapLayers.sphere === o.id} onclick={() => openSphere(o.id)}>{o.name}</button></li>
          {/each}
        </ul>
      </Panel>
    {/if}
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
  /* What Hazards asks, beside its box, before anybody ticks it. */
  .nc-ask {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    margin-block: 0.3rem 0.4rem;
    padding-inline-start: 0.7rem;
    border-inline-start: 2px solid var(--t-line-strong);
    color: var(--t-muted);
    font-size: 0.82rem;
    line-height: 1.4;
  }
  .nc-host {
    color: var(--t-ink);
    font-family: var(--font-mono);
    font-weight: 600;
    overflow-wrap: anywhere;
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
  .nc-square { fill: var(--t-ink); }
  .nc-square-small { fill: var(--t-muted); }
  .nc-square-ring { fill: none; stroke: var(--t-muted); }
  .nc-square-cross { fill: none; stroke: var(--t-faint); }
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
