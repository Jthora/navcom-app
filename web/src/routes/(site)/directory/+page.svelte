<script lang="ts">
  import RecordSummary from '$lib/components/RecordSummary.svelte';
  import { labelValue } from '$lib/directory/load';
  import { localTimeNote } from '@navcom/core';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const now = $derived(new Date(data.builtAt));
  const publishedOn = $derived(data.builtAt.slice(0, 10));

  const realCount = $derived(data.records.filter((r) => !r.id.startsWith('EXAMPLE')).length);

  const byType = $derived(
    Object.entries(
      data.records.reduce<Record<string, typeof data.records>>((acc, r) => {
        (acc[r.type] ??= []).push(r);
        return acc;
      }, {})
    ).sort(([a], [b]) => a.localeCompare(b))
  );
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

  {#each data.regions as region (region.slug)}
    <p class="region">
      <strong>{region.name}</strong> ({region.country}) · {localTimeNote(region)}
      {#if region.status === 'seeded'}
        <span class="unchecked">Seeded from public sources — nobody has checked it.</span>
      {:else if region.status === 'example'}
        <span class="unchecked">Example data. Not a real place.</span>
      {/if}
    </p>
  {/each}

  <p class="built-at">
    Checked-on dates below are exact. This page was rebuilt
    <time datetime={publishedOn}>{publishedOn}</time>, and anything close to going stale is
    shown as <strong>call first</strong> a day early rather than a day late.
  </p>

  {#each byType as [type, records] (type)}
    <section>
      <h2>{labelValue(type)}</h2>
      <ul class="cards">
        {#each records as record (record.id)}
          <li><RecordSummary {record} {now} /></li>
        {/each}
      </ul>
    </section>
  {/each}

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

  .region {
    font-size: .92rem;
    color: var(--muted);
    padding: .6rem 0;
    border-bottom: 1px solid var(--line);
  }
  .region strong { color: var(--ink); }
  .unchecked { display: block; color: var(--accent); }

  .notice .quiet { color: var(--muted); font-size: .9rem; }

  .built-at {
    font-size: 0.88rem;
    color: var(--muted);
    border-inline-start: 2px solid var(--line-strong);
    padding-inline-start: 0.8rem;
    margin: 1.25rem 0 0;
    max-width: var(--measure);
  }

  section { margin-top: 2.5rem; display: flex; flex-direction: column; gap: 1rem; }

  h2 {
    font-size: 1.05rem;
    font-family: var(--font-body);
    font-weight: 700;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--muted);
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--line-strong);
  }

  .cards { display: flex; flex-direction: column; gap: 1rem; }

  .built {
    margin-top: 3rem;
    padding-top: 1rem;
    border-top: 1px solid var(--line);
    font-family: var(--font-mono);
    font-size: 0.78rem;
    color: var(--faint);
  }
</style>
