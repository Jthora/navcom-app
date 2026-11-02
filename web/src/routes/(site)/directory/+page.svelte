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
      <p><strong>The entries below are examples, not real places.</strong></p>
    </div>
  {/if}

  <div class="notice">
    <!--
      The terminal's one-tap correction is the easy path, and this page once said it "does not exist
      yet" long after it shipped. Both doors, then, and nothing more.
    -->
    <p>
      <strong>Spotted something wrong?</strong> Tap <strong>Report a problem</strong> in the
      <a href="/terminal/directory/">field terminal</a>, or <a href="/docs/contributing/">correct the file</a>.
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

  <!-- A zero-JavaScript page judges staleness at build, so its date is the condition on every age. -->
  <p class="built-at">
    Ages judged on <time datetime={publishedOn}>{publishedOn}</time>. If that is over a day ago,
    treat hours as <strong>call first</strong>.
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

  .built-at {
    font-size: 0.88rem;
    color: var(--muted);
    border-inline-start: 2px solid var(--line-strong);
    padding-inline-start: 0.8rem;
    margin: 1.25rem 0 0;
    max-width: var(--measure);
  }
</style>
