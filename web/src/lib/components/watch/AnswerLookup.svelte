<script lang="ts">
  /**
   * Looking up a place to answer somebody, beside the answer box [`$lib/terminal/lookup`].
   *
   * Narrowing a list already on this phone, which asks nobody [CLAUDE.md, the search-box row]: the
   * area's records are the area screen's own, fetched as that screen's data, so an area this phone
   * has opened before answers with no signal. It starts in the area nearest where the asker is,
   * when their ask carried a fix, and otherwise where this phone last looked.
   *
   * Corrections operators sent about a place are on the area screen, not here, so it opens beside
   * the board rather than in place of it: leaving the Watch screen ends the board.
   */
  import { preloadData } from '$app/navigation';
  import { labelValue, type ResourceRecord } from '@navcom/core';
  import { nearest, type Fix } from '$lib/console/position-once';
  import type { ConsoleCentroid } from '$lib/console/types';
  import { get, set } from '$lib/terminal/storage';
  import { distance, narrow } from '$lib/terminal/lookup';
  import { Readout } from '$lib/components/panel';

  let { near = null, onpick }: { near?: Fix | null; onpick: (r: ResourceRecord) => void } = $props();

  const FIELD = 'watch_region';
  let open = $state(false);
  let centroids = $state<ConsoleCentroid[] | null>(null);
  let region = $state<ConsoleCentroid | null>(null);
  let records = $state<ResourceRecord[] | null>(null);
  let failed = $state(false);
  let typed = $state('');
  let areaTyped = $state('');

  async function start() {
    open = true;
    failed = false;
    try {
      centroids ??= ((await (await fetch('/console-regions.json')).json()) as { centroids: ConsoleCentroid[] }).centroids;
    } catch {
      centroids = [];
    }
    const last = get<string>('accruing', FIELD);
    const pick = (near && centroids.length > 0 ? nearest(near, centroids) : null) ?? centroids.find((c) => c.region === last) ?? null;
    if (pick) await choose(pick);
  }

  async function choose(c: ConsoleCentroid) {
    region = c;
    records = null;
    failed = false;
    areaTyped = '';
    set('accruing', FIELD, c.region);
    try {
      const got = await preloadData(`/terminal/directory/${c.region}/`);
      if (got.type === 'loaded' && got.status === 200) {
        records = ((got.data as { records?: ResourceRecord[] }).records ?? []) as ResourceRecord[];
      } else failed = true;
    } catch {
      failed = true;
    }
  }

  const areas = $derived(
    centroids && areaTyped.trim()
      ? centroids.filter((c) => c.name.toLowerCase().includes(areaTyped.trim().toLowerCase())).slice(0, 5)
      : []
  );
  const found = $derived(records ? narrow(records, typed, near) : []);
</script>

{#if !open}
  <button type="button" data-lookup-open onclick={start}>Add a place</button>
{:else}
  <div class="lookup" data-lookup>
    <div class="area">
      {#if region}
        <Readout value={region.name} tone="neutral" sub={near ? 'nearest where they are' : 'where you last looked'} />
        <a href="/terminal/directory/{region.region}/" target="_blank" rel="noopener">Open the area</a>
      {/if}
      <label for="lookup-area">{region ? 'Another area' : 'Area'}</label>
      <input id="lookup-area" bind:value={areaTyped} autocomplete="off" placeholder="New York" />
      {#each areas as c (c.region)}
        <button type="button" class="pick" onclick={() => choose(c)}>{c.name}</button>
      {/each}
    </div>

    {#if region}
      {#if failed}
        <Readout value="Not loaded" tone="warn" sub="this area has not been opened on this phone, and there is no signal" />
      {:else if records === null}
        <Readout value="Loading" tone="cold" />
      {:else}
        <label for="lookup-place">Place</label>
        <input id="lookup-place" bind:value={typed} autocomplete="off" placeholder="drop-in, meal, a name…" />
        {#if found.length === 0}
          <Readout value="Nothing matches" tone="cold" />
        {/if}
        {#each found as f (f.record.id)}
          <button type="button" class="pick place" data-lookup-place onclick={() => onpick(f.record)}>
            <span class="name">{f.record.name}</span>
            <span class="meta">{labelValue(f.record.type)}{f.metres !== null ? ` · ${distance(f.metres)}` : ''}{f.record.phone ? ` · ${f.record.phone}` : ''}</span>
          </button>
        {/each}
      {/if}
    {/if}
    <button type="button" onclick={() => (open = false)}>Close</button>
  </div>
{/if}

<style>
  .lookup, .area { display: flex; flex-direction: column; gap: .45rem; }
  .lookup { border: 1px solid var(--t-line); padding: .7rem; }
  .pick { text-align: start; }
  .place { display: flex; flex-direction: column; gap: .15rem; }
  .name { color: var(--t-ink); font-weight: 600; }
  .meta {
    color: var(--t-muted); font-size: .78rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  input { width: 100%; }
</style>
