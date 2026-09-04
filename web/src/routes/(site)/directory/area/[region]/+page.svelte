<script lang="ts">
  import RecordSummary from '$lib/components/RecordSummary.svelte';
  import { labelValue, localTimeNote, type ResourceRecord } from '@navcom/core';

  let { data } = $props();
  const now = new Date(data.builtAt);
  const publishedOn = data.builtAt.slice(0, 10);

  const byType = $derived(
    Object.entries(
      (data.records as ResourceRecord[]).reduce<Record<string, ResourceRecord[]>>((acc, r) => {
        (acc[r.type] ??= []).push(r);
        return acc;
      }, {})
    ).sort((a, b) => a[0].localeCompare(b[0]))
  );
</script>

<svelte:head>
  <title>{data.region.name} — NavCom directory</title>
  <meta
    name="description"
    content="Shelters, meals and services listed for {data.region.name}. Call before you go." />
</svelte:head>

<div class="wrap">
  <p><a href="/directory/">← All areas</a></p>
  <h1>{data.region.name}</h1>

  <p class="note">
    {localTimeNote(data.region)}
    {#if data.region.status === 'seeded'}
      <strong>Seeded from public sources — nobody has checked it.</strong>
    {/if}
  </p>

  <!--
    The instruction that survives being out of date, and the reason it is above the list
    rather than under it: a reader who stops after the first entry has still read this.
  -->
  <p class="note">
    <strong>Call before you go.</strong> Hours and intake rules change without notice, and
    nothing here has been confirmed by a person.
  </p>

  {#if data.records.length === 0}
    <p class="note">
      Nothing is carried for this area yet. That is not the same as nothing being here —
      it means nobody has put it in.
    </p>
  {/if}

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
    Last build <time datetime={publishedOn}>{publishedOn}</time>.
  </p>
</div>

<style>
  .wrap { max-width: 52rem; margin: 0 auto; padding: 1rem; }
  h1 { margin: .3rem 0 .6rem; }
  .note { color: #444; margin: .4rem 0 1rem; }
  .cards { list-style: none; padding: 0; display: grid; gap: .8rem; }
  .built { color: #666; font-size: .9rem; margin-top: 2rem; }
  @media (prefers-color-scheme: dark) {
    .note { color: #bbb; }
    .built { color: #999; }
  }
</style>
