<script lang="ts">
  import { labelValue } from '@navcom/core';
  import { localTimeNote } from '@navcom/core';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const now = $derived(new Date(data.builtAt));
  const publishedOn = $derived(data.builtAt.slice(0, 10));

  const counts = $derived(data.counts);
  const realCount = $derived(data.realCount);

</script>

<svelte:head>
  <title>Directory · NavCom</title>
  <meta
    name="description"
    content="Shelters, meals, showers, warming centres and more — with the intake rules that decide whether someone actually gets in, and how recently anyone checked."
  />
</svelte:head>

<div class="wrap">
  <p class="eyebrow">Resource directory</p>
  <h1>What is open, and who they will take</h1>

  {#if realCount === 0}
    <div class="notice notice--warn">
      <p class="notice__label">No real entries yet</p>
      <p>
        This directory has not been seeded for any city. The entries below are examples
        that exist to demonstrate how records are displayed — <strong>they are not real
        places and the addresses are not real.</strong>
      </p>
    </div>
  {/if}

  <div class="notice">
    <p>
      <strong>Spotted something wrong?</strong> This page is read-only, but the data is not
      locked away — it is a plain file anyone can correct. See
      <a href="/docs/contributing/">how to correct an entry</a>.
    </p>
    <p class="quiet">
      <!--
        This said the terminal's one-tap correction "does not exist yet" long after it shipped
        — three test files cover it, including a two-device story where what one operator
        learned at a door reaches the next one's phone. The one page with public reach was
        telling everybody the easy path was unavailable.
      -->
      Faster: open the <a href="/terminal/directory/">field terminal</a>, pick a callsign, and
      tap <strong>report a problem</strong> on any listing. It takes one screen, no account, and
      corrections queue up with no signal and go out when you next have some.
    </p>
  </div>

  <!--
    Areas, not records.
    
    This page used to render every record in the country: at 8,428 that was 11 MB of raw HTML
    and 350 kB gzipped against a 250 kB budget — unopenable on a slow connection, listing
    places for people whose connections are the worst. Each area now links to its own page.
  -->
  <ul class="areas">
    {#each data.regions as region (region.slug)}
      <li>
        <a href="/directory/area/{region.slug}/">{region.name}</a>
        <span class="meta">
          {region.country} · {counts[region.slug] ?? 0}
          {(counts[region.slug] ?? 0) === 1 ? 'place' : 'places'}
          {#if region.status === 'seeded'}· not checked by anyone{/if}
        </span>
      </li>
    {/each}
  </ul>

  <p class="built-at">
    Checked-on dates below are exact. This page was rebuilt
    <time datetime={publishedOn}>{publishedOn}</time>, and anything close to going stale is
    shown as <strong>call first</strong> a day early rather than a day late.
  </p>


  <p class="built">
    Rebuilt daily. Last build <time datetime={publishedOn}>{publishedOn}</time>.
  </p>
</div>

<style>
  h1 {
    font-size: clamp(1.7rem, 5vw, 2.3rem);
    line-height: 1.15;
    letter-spacing: -0.015em;
    margin: 0.5rem 0 1.25rem;
  }

  .notice { margin-bottom: 1rem; }

  .notice .quiet { color: var(--muted); font-size: .9rem; }

  .built-at {
    font-size: 0.88rem;
    color: var(--muted);
    border-inline-start: 2px solid var(--line-strong);
    padding-inline-start: 0.8rem;
    margin: 1.25rem 0 0;
    max-width: var(--measure);
  }

  .built {
    margin-top: 3rem;
    padding-top: 1rem;
    border-top: 1px solid var(--line);
    font-family: var(--font-mono);
    font-size: 0.78rem;
    color: var(--faint);
  }
</style>
