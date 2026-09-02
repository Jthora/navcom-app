<script lang="ts">
  /**
   * Pick an area to carry offline.
   *
   * Opening one caches it, which is the whole mechanism -- there is no "download" button
   * and no progress bar, because visiting the page IS the download.
   */
  import { onMount } from 'svelte';
  import { offline } from '$lib/terminal/offline.svelte';
  import { Readout, Why } from '$lib/components/panel';

  let { data } = $props();

  // Checked rather than promised. "Opening it is what saves it" is true and says nothing
  // about whether it worked, and an operator who believes they carry an area and does not
  // finds out with no signal.
  onMount(() => void offline.check(data.areas.map((a) => a.region.slug)));

  /** Counted, never typed: this sentence is wrong the day somebody seeds a sixty-ninth area. */
  const areaCount = $derived(data.areas.length);
  const countryCount = $derived(new Set(data.areas.map((a) => a.region.country)).size);

  const byCountry = $derived(
    Object.entries(
      data.areas.reduce<Record<string, typeof data.areas>>((acc, a) => {
        (acc[a.region.country] ??= []).push(a);
        return acc;
      }, {})
    ).sort(([a], [b]) => a.localeCompare(b))
  );
</script>

<svelte:head>
  <title>Areas · Field Terminal</title>
  <meta name="description" content="Which area to carry offline." />
</svelte:head>

<header>
  <p class="eyebrow"><a href="/terminal/">← Status</a></p>
  <h1>Areas</h1>
</header>

<section>
  <p>
    Open the one you work in. <strong>Opening it is what saves it</strong> — after that it
    is on this phone and works with no signal at all.
  </p>
  <Why summary="Why only some areas">
    <p>
      Only what you open is kept. Carrying every area would fill a cheap phone with places
      you will never go.
    </p>
  </Why>
</section>

{#each byCountry as [country, areas] (country)}
  <section class="country">
    <h2>{country}</h2>
    <ul>
      {#each areas as { region, records } (region.slug)}
        <li>
          <a class="area" href="/terminal/directory/{region.slug}/">
            <span class="name">{region.name}</span>
            {#if offline.areas[region.slug] === 'yes'}
              <span data-carried={region.slug}><Readout value="On this phone" tone="good" /></span>
            {/if}
            <!--
              Words rather than a bare 0. "Nothing yet" is a state an operator can act on;
              a zero reads like a broken row, and this is the row the cold start depends on
              somebody tapping.
            -->
            <Readout
              value={records === 0 ? 'Nothing yet' : String(records)}
              tone={records === 0 ? 'cold' : 'neutral'}
            />
          </a>
        </li>
      {/each}
    </ul>
  </section>
{/each}

<!--
  The sentence that was not here.

  Sixty-eight areas were listed and nothing acknowledged the person whose city is not among
  them — they scrolled a list of somewhere else and got no explanation. A silent absence, which
  is the failure this project prohibits everywhere else, on the layer `CLAUDE.md` calls the
  default and not a degraded state.

  It cannot offer a fix yet, because there is not one: `places.add()` needs a region slug and
  regions are prerendered from `data/regions/`. So it says that plainly rather than implying a
  path that does not exist.
-->
<section class="missing" data-area-missing>
  <h2>Yours might not be here</h2>
  <p>
    {areaCount} areas, in {countryCount} countries. If the one you work in is not among them,
    <strong>this app cannot add it yet</strong> — a place has to go into an area that already
    exists, and nothing here makes a new one.
  </p>
  <p class="cost">
    That is a real gap, and it shuts the cached directory out for everybody outside these
    areas. Until it is built the only way in is to ask whoever runs this —
    <a href="/docs/contributing/">how to contribute</a> says where.
  </p>
</section>


<style>
  ul { list-style: none; margin: 0; padding: 0; }
  li { border-bottom: 1px solid var(--t-line); }
  .area {
    display: flex; justify-content: space-between; align-items: center; gap: 1rem;
    min-height: 3.4rem; text-decoration: none; color: var(--t-ink);
  }
  .name { font-size: 1.02rem; }
  /* Set apart from the list rather than styled as another row: it is not an area you can
     open, and looking like one would be its own small lie. */
  .missing { border-top: 1px solid var(--t-line); margin-top: 1.4rem; padding-top: 1.1rem; }
</style>
