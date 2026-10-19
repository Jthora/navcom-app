<script lang="ts">
  /**
   * The Spheres, from the map or from the layers screen [docs/design/map.md, Spheres; D9]: one Sphere
   * by its id, the Spheres a tapped country is in by its code, or, with neither, every Sphere.
   *
   * A Sphere says what it is (its family), who is in it, each member a door to its place, how its source
   * divides it, and where the list came from: every source cited, each a link somebody chooses to follow,
   * which carries no referrer, and only an https one is a link at all. While the lists are a draft it
   * says so. Opening a Sphere picks it out on the map, hatched, and the map's key names it until another
   * is picked or the layer is changed; every Sphere, or a country, leaves none picked out.
   *
   * Its words come from the Spheres' own code, by `import()` as the map loads it, so a screen Back or a
   * reload lands on says so when that code or the lists did not arrive.
   */
  import { Panel, Readout, Slot } from '$lib/components/panel';
  import type { Nav } from '$lib/com/screens';
  import { layerData, mapLayers } from '$lib/grid/layer.svelte';
  import { countryName } from '$lib/grid/topology';

  let { id, code, nav }: { id: string | null; code: string | null; nav: Nav } = $props();

  let spheres = $state.raw<typeof import('$lib/grid/layers/spheres') | null>(null);
  $effect(() => {
    void import('$lib/grid/layers/spheres').then(
      (m) => {
        spheres = m;
        void m.loadSpheres();
      },
      () => (mapLayers.spheres = 'failed')
    );
  });
  // Picked out on the map while it is open: a Sphere hatched, or, for every Sphere or a country, none.
  $effect(() => {
    mapLayers.sphere = id;
  });

  const file = $derived(mapLayers.loaded >= 0 ? layerData.spheres : null);
  const one = $derived(id && file ? (file.spheres.find((s) => s.id === id) ?? null) : null);
  const at = $derived(code && spheres && file ? spheres.spheresAt(code) : []);
  const nameOf = (c: string) => countryName(c) ?? c.toUpperCase();
  const FAMILY = { language: 'A language’s', civilisation: 'A civilisation’s', political: 'A political community’s' } as const;
  const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const openSphere = (sphere: string) => nav.open({ kind: 'sphere', id: sphere, code: null });
  /**
   * A source's link only when it is https: the vendoring refuses any other, and this holds whatever a
   * file says, since a `javascript:` or `data:` link here would run in navcom.app's origin, where the
   * operator's keys are, on one tap. Anything else is its name, as plain text.
   */
  const linkable = (url: string | undefined): url is string => typeof url === 'string' && url.startsWith('https://');
  const place = (c: string) => ({ kind: 'place' as const, code: c, region: null, name: nameOf(c), at: null, record: null, within: null, unmapped: null });
</script>

<div data-screen="sphere" data-sphere={id ?? ''} data-code={code ?? ''}>
  {#if mapLayers.spheres === 'absent'}
    <Readout value="Not in this build" tone="cold" sub="vendored when the cited lists land" />
  {:else if mapLayers.spheres === 'failed'}
    <strong class="unloaded" data-sphere-failed>Not loaded — it needs one visit with a connection</strong>
  {:else if !file || !spheres}
    <Readout value="Loading" tone="cold" />
  {:else if id !== null}
    {#if one}
      <Panel label="Sphere" post={one.name}>
        <Slot k="Family"><Readout value={FAMILY[one.family]} tone="neutral" sub="a domain of influence; Spheres overlap" /></Slot>
        <Slot k="Members"><Readout value="{one.members.length} countries" tone="neutral" sub="each by its ISO code, from the list" /></Slot>
        <ul class="nc-areas" data-sphere-members>
          {#each one.members as m (m.code)}
            <li><button type="button" data-sphere-member={m.code} onclick={() => nav.open(place(m.code))}>{nameOf(m.code)}</button></li>
          {/each}
        </ul>
        {#each one.groups as g (g.id)}
          <Slot k={g.name}><Readout value="{g.members.length} countries" tone="neutral" sub="a group within it: {g.members.map(nameOf).join(', ')}" /></Slot>
        {/each}
        <Slot k="Sources">
          <ul class="nc-sources" data-sphere-sources>
            {#each one.sources as s (s.name)}
              <li>
                {#if linkable(s.url)}<a href={s.url} rel="noreferrer" target="_blank">{s.name}</a>{:else}{s.name}{/if}
                {#if s.licence}<span class="nc-licence">{s.licence}</span>{/if}
              </li>
            {/each}
          </ul>
        </Slot>
        <Slot k="Read"><Readout value={one.read ? day(one.read) : 'Not said'} tone={one.read ? 'neutral' : 'cold'} sub="when the list was read from its sources" /></Slot>
        <Slot k="Lists">
          <Readout value={file.navcom.draft ? 'Draft' : 'As published'} tone={file.navcom.draft ? 'warn' : 'neutral'} sub={file.navcom.credit} />
        </Slot>
      </Panel>
    {:else}
      <Panel label="Sphere" post="Not here now">
        <Slot k="Id"><Readout value="Not in these lists" tone="cold" sub={id} /></Slot>
      </Panel>
    {/if}
  {:else if code !== null}
    <Panel label="Spheres" post={nameOf(code)}>
      {#if at.length === 0}
        <Slot k="Spheres"><Readout value="In none" tone="cold" sub="no list names it" /></Slot>
      {:else}
        <!-- The most specific first: the Sphere with the fewest members. -->
        <ul class="nc-areas" data-sphere-list>
          {#each at as s (s.id)}
            <li><button type="button" data-sphere-open={s.id} onclick={() => openSphere(s.id)}>{s.name}</button></li>
          {/each}
        </ul>
      {/if}
      <div class="nc-rail"><button type="button" data-sphere-place onclick={() => nav.open(place(code))}>Open {nameOf(code)}</button></div>
      <Slot k="Lists">
        <Readout value={file.navcom.draft ? 'Draft' : 'As published'} tone={file.navcom.draft ? 'warn' : 'neutral'} sub={file.navcom.credit} />
      </Slot>
    </Panel>
  {:else}
    <Panel label="Spheres" post="{file.spheres.length} lists">
      <ul class="nc-areas" data-sphere-list>
        {#each file.spheres as s (s.id)}
          <li><button type="button" data-sphere-open={s.id} onclick={() => openSphere(s.id)}>{s.name}</button></li>
        {/each}
      </ul>
    </Panel>
  {/if}
</div>

<style>
  .unloaded {
    color: var(--t-ink);
    font-size: 0.9rem;
  }
  .nc-areas,
  .nc-sources {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .nc-sources {
    flex-direction: column;
  }
  .nc-sources a {
    display: inline-flex;
    align-items: center;
    min-height: 3rem;
    color: var(--t-ink);
  }
  .nc-licence {
    margin-inline-start: 0.5rem;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--t-faint);
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
</style>
