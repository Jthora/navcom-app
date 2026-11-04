<script lang="ts">
  /**
   * The playbook: for the nights a patrol meets most, what to press here and who the city says to call
   * (the owner, 2026-11-03). Carried for a night with no signal [routes.ts]. Each step from somewhere
   * else says where and when it was read there, since a city's routing can change [invariant 7].
   */
  import { PLAYS } from '$lib/playbook';

  const read = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
</script>

<svelte:head>
  <title>Playbook · Field Terminal</title>
  <meta name="description" content="What to press, and who to call, on the nights a patrol meets most." />
</svelte:head>

<header>
  <p class="eyebrow"><a href="/terminal/">← Status</a></p>
  <h1>Playbook</h1>
</header>

{#each PLAYS as play (play.id)}
  <section data-play={play.id}>
    <h2>{play.title}</h2>
    <ol>
      {#each play.steps as step, i (i)}
        <li>
          {step.say}
          {#if step.source}
            <small class="source" data-source>
              <a href={step.source.url} rel="noopener noreferrer" target="_blank">{step.source.by}</a>, read {read(step.source.checked)}
            </small>
          {/if}
        </li>
      {/each}
    </ol>
  </section>
{/each}

<style>
  section { margin-block: 1.4rem; }
  h2 { font-size: 1.05rem; margin-block-end: 0.5rem; }
  ol { margin: 0; padding-inline-start: 1.3rem; display: grid; gap: 0.55rem; list-style: decimal; }
  li { line-height: 1.5; overflow-wrap: anywhere; }
  .source { display: block; font-family: var(--font-mono); font-size: 0.7rem; color: var(--t-muted); margin-block-start: 0.15rem; }
</style>
