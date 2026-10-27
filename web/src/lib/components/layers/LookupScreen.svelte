<script lang="ts">
  /**
   * Which Zone and Sector this phone is in, looked up on this phone [the owner's map decisions D7 and
   * D10; docs/design/map.md, Zones].
   *
   * Its position is asked for once and rounded to 500 m before it is held, as the search's is
   * [console/position-once], and it never leaves the phone: the index of every Sector on Earth is
   * fetched whole, the same file for everybody, and the answer is worked out here. Nothing chosen by
   * where the phone is is fetched, not even its container: a Sector found here opens named from the
   * index, with its Zone and Terra from the outlines, and its container's file is fetched only if
   * somebody then opens its Zone or Terra, which says so [ZoneScreen]. The fix is never put in history
   * either; Back and a reload ask again. A place on the map is answered by the map: a tap names its
   * Zone, and once that Zone's container is open, its Sector.
   *
   * The index's edges are quantised to about 400 m, so near one both Sectors are offered and the person
   * chooses. Nothing is kept from a draft (D6).
   */
  import { Panel, Readout, Slot } from '$lib/components/panel';
  import type { Nav } from '$lib/com/screens';
  import { locateOnce } from '$lib/console/position-once';
  import { layerData, loaded, mapLayers } from '$lib/grid/layer.svelte';
  import type { Found } from '$lib/grid/layers/zones-lookup';
  import { keepWork, workSector } from './work';

  let { nav }: { nav: Nav } = $props();

  /** Where a Sector sits, from the Zones' own code once it is here [layers/zones.ts]. */
  let chainOf = $state.raw<typeof import('$lib/grid/layers/zones').chainOf | null>(null);

  type State =
    | { step: 'locating' }
    | { step: 'nowhere' }
    | { step: 'looking' }
    | { step: 'absent' }
    | { step: 'failed' }
    | { step: 'stale' }
    | { step: 'found'; inside: Found | null; near: Found[] };
  let asked = $state<State>({ step: 'looking' });
  /** Which ask is the current one: Back and forward between two must not show the slower. */
  let asking = 0;

  $effect(() => {
    const mine = ++asking;
    void (async () => {
      asked = { step: 'locating' };
      const fix = await locateOnce();
      if (mine !== asking) return;
      if (!fix) {
        asked = { step: 'nowhere' };
        return;
      }
      const lonLat: [number, number] = [fix.lon, fix.lat];
      asked = { step: 'looking' };
      const zones = await import('$lib/grid/layers/zones').catch(() => null);
      if (!zones) {
        if (mine === asking) asked = { step: 'failed' };
        return;
      }
      chainOf = zones.chainOf;
      await zones.loadOutlines();
      const digest = layerData.outlines?.navcom.manifest_sha256;
      if (mine !== asking) return;
      if (!digest) {
        asked = { step: mapLayers.zones === 'absent' ? 'absent' : 'failed' };
        return;
      }
      const lookup = await import('$lib/grid/layers/zones-lookup').catch(() => null);
      const answer = lookup ? await lookup.lookUp(lonLat[0], lonLat[1], digest) : { status: 'failed' as const };
      if (mine !== asking) return;
      if (answer.status === 'ready') {
        // Named from the index, so a Sector opened from here needs nothing more fetched to say what it is.
        const names = { ...layerData.named };
        for (const f of [answer.inside, ...answer.near]) if (f) names[f.id] = f.name;
        layerData.named = names;
        loaded();
      }
      asked = answer.status === 'ready' ? { step: 'found', inside: answer.inside, near: answer.near } : { step: answer.status };
    })();
  });

  const outlines = $derived(mapLayers.loaded >= 0 ? layerData.outlines : null);
  const draft = $derived(outlines?.navcom.draft ?? true);
  const found = $derived(asked.step === 'found' ? [asked.inside, ...asked.near].filter((x): x is Found => x !== null) : []);
  let kept = $state(workSector()?.id ?? null);

  /** A Sector's Zone and Terra, from the outlines: the index named the Sector, and nothing is opened to name the rest. */
  function where(id: string): string {
    const c = outlines && chainOf ? chainOf(outlines, id, {}) : null;
    return c?.zone ? `${c.container.name} › ${c.zone.name}` : '';
  }

  function keep(f: Found) {
    const c = outlines && chainOf ? chainOf(outlines, f.id, {}) : null;
    if (!c?.zone || !outlines || draft) return;
    if (keepWork({ id: f.id, name: f.name, zone: c.zone.id!, container: c.container.id!, manifest: outlines.navcom.manifest_sha256 })) kept = f.id;
  }
</script>

<div data-screen="lookup" data-lookup={asked.step}>
  <Panel label="Which Sector" post="This phone">
    {#if asked.step === 'locating'}
      <Readout value="Asking this phone" tone="cold" sub="rounded to 500 m, and never sent" />
    {:else if asked.step === 'nowhere'}
      <Readout value="Not known" tone="cold" sub="this phone did not say where it is" />
      <div class="nc-rail"><button type="button" onclick={() => nav.open({ kind: 'layers' })}>Choose from the list</button></div>
    {:else if asked.step === 'looking'}
      <Readout value="Looking it up" tone="cold" sub="on this phone" />
    {:else if asked.step === 'absent'}
      <Readout value="Not in this build" tone="cold" sub="vendored as each of Starcom’s stages lands" />
    {:else if asked.step === 'failed'}
      <strong class="unloaded" data-lookup-failed>Not loaded — it needs one visit with a connection</strong>
    {:else if asked.step === 'stale'}
      <Readout value="A newer stage arrived" tone="warn" sub="reload to look it up in it" />
    {:else if found.length === 0}
      <Readout value="In no Sector" tone="cold" sub="no Sector in this stage holds it" />
    {:else}
      {#each found as f, i (f.id)}
        <div class="nc-found" data-found={f.id}>
          <button type="button" class="nc-found-open" onclick={() => nav.open({ kind: 'zone', id: f.id })}>
            <span class="nc-found-name">{f.name}</span>
            <span class="nc-found-meta">{where(f.id)}{i > 0 ? ' · near the edge' : ''}</span>
          </button>
          {#if !draft && kept !== f.id}
            <button type="button" class="nc-keep" data-work-keep onclick={() => keep(f)}>I work here</button>
          {:else if kept === f.id}
            <Readout value="Where you work" tone="good" sub="on this phone only" />
          {/if}
        </div>
      {/each}
      <Slot k="Sent">
        <Readout value="Nothing" tone="good" sub="looked up on this phone" />
      </Slot>
      {#if draft}
        <Slot k="Yours"><Readout value="Not kept in a draft" tone="cold" sub="ids may change before Starcom’s swap" /></Slot>
      {/if}
    {/if}
  </Panel>
</div>

<style>
  .unloaded {
    color: var(--t-ink);
    font-size: 0.9rem;
  }
  .nc-found {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .nc-found-open {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.2rem;
    flex: 1;
    min-height: 3rem;
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--t-line);
    background: var(--t-sunk);
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .nc-found-name {
    font-weight: 600;
    color: var(--t-ink);
  }
  .nc-found-meta {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--t-faint);
  }
  .nc-keep,
  .nc-rail button {
    min-height: 3rem;
    padding: 0 0.8rem;
    border: 1px solid var(--t-line);
    background: var(--t-sunk);
    color: var(--t-ink);
    font: inherit;
    cursor: pointer;
  }
</style>
