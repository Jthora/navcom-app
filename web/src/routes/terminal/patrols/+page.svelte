<script lang="ts">
  /**
   * Your own record of your own nights.
   *
   * Distinct from `/terminal/log/`, which is the watch's record about you. This one is
   * yours, works with no watch, and leaving the app is a decision you make.
   */
  import { onMount } from 'svelte';
  import {
    exportPatrols,
    formatDuration,
    keepsHistory,
    patrols,
    setKeepHistory,
    type Patrol
  } from '$lib/terminal/patrol';
  import { operator } from '$lib/terminal/session.svelte';
  import { Slot, Readout } from '$lib/components/panel';

  let list = $state<Patrol[]>([]);
  let keep = $state(false);
  let callsign = $state<string | null>(null);
  let includeAreas = $state(true);
  let showExport = $state(false);
  let copied = $state(false);

  onMount(() => {
    list = patrols();
    keep = keepsHistory();
    callsign = operator.callsign;
  });

  const total = $derived(list.reduce((n, p) => n + (p.ended - p.started), 0));
  const text = $derived(exportPatrols(list, { callsign, includeAreas }));

  function toggleKeep() {
    setKeepHistory(!keep);
    keep = keepsHistory();
    list = patrols();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      // Clipboard refused — the text is on screen and selectable, which is the fallback.
      copied = false;
    }
  }

  const when = (p: Patrol) => {
    const d = new Date(p.started * 1000);
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  };
  const clock = (unix: number) =>
    new Date(unix * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
</script>

<svelte:head>
  <title>Your patrols · Field Terminal</title>
  <meta name="description" content="Your own record of your own nights." />
</svelte:head>

<header>
  <p class="eyebrow"><a href="/terminal/">← Status</a></p>
  <h1>Your patrols</h1>
</header>

{#if list.length === 0}
  <section>
    <Slot k="Patrols">
      <Readout value="Nothing yet" tone="cold" sub="lands here when you stand down" />
    </Slot>
    <p class="cost">
      Your own record, not the watch's. <strong>It stays on this phone</strong> — nothing
      here is sent to a watch, a relay or anybody else — and it works with no signal at all.
    </p>
  </section>
{:else}
  <section class="tally">
    <Slot k="Patrols">
      <Readout
        value="{list.length} patrol{list.length === 1 ? '' : 's'}"
        tone="neutral"
        sub={formatDuration(total)}
      />
    </Slot>
  </section>

  <section>
    <ol class="patrols">
      {#each [...list].reverse() as p, i (i)}
        <li>
          <span class="date">{when(p)}</span>
          <span class="area">{p.area}</span>
          <span class="times">{clock(p.started)}–{clock(p.ended)} · {formatDuration(p.ended - p.started)}</span>
          {#if p.closedBy}
            <!-- Somebody confirmed you got back. That is the close of the night. -->
            <span class="home">{p.closedBy} confirmed you home</span>
          {/if}
          {#if p.note}<span class="note">{p.note}</span>{/if}
        </li>
      {/each}
    </ol>
  </section>

  <section class="act">
    <h2>Share it</h2>
    <p>
      <strong>None of this has left your phone.</strong> Sharing is something you do on
      purpose, and this is what would go.
    </p>
    <p class="cost">
      Built so that using it cannot expose anybody who did not agree to anything: no other
      operators, nothing about anyone you helped, and no coordinates at any point.
    </p>
    <label class="opt">
      <input type="checkbox" bind:checked={includeAreas} />
      Include areas
    </label>
    <button onclick={() => (showExport = !showExport)}>
      {showExport ? 'Hide' : 'Show what would be shared'}
    </button>
    {#if showExport}
      <pre data-export>{text}</pre>
      <button onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    {/if}
  </section>
{/if}

<section class="limit">
  <h2>If this phone is wiped</h2>
  <Slot k="On panic wipe">
    <Readout
      value={keep ? 'Kept' : 'Destroyed'}
      tone={keep ? 'warn' : 'good'}
      sub={keep ? 'a seized phone shows a year of them' : 'nothing about your nights survives'}
    />
  </Slot>
  <p>
    {#if keep}
      Your patrols <strong>survive a panic wipe</strong>. A year of them survives a bad
      night — and a seized phone shows a year of them.
    {:else}
      Your patrols <strong>are destroyed by a panic wipe</strong>, along with everything else
      from tonight. Nothing about your nights survives a phone being taken.
    {/if}
  </p>
  <button onclick={toggleKeep}>
    {keep ? 'Destroy them on a panic wipe' : 'Keep them through a panic wipe'}
  </button>
</section>

<style>
  .patrols { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .9rem; }
  .patrols li {
    display: flex; flex-direction: column; gap: .1rem;
    border-inline-start: 2px solid var(--t-line-strong); padding-inline-start: .8rem;
  }
  .date {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .76rem; color: var(--t-faint); text-transform: uppercase; letter-spacing: .08em;
  }
  .area { color: var(--t-ink); font-weight: 650; }
  .times { font-size: .88rem; color: var(--t-muted); }
  .home { font-size: .85rem; color: var(--t-station); }
  .note { font-size: .9rem; color: var(--t-muted); font-style: italic; margin-top: .15rem; }

  .act { gap: .6rem; }
  .opt { display: flex; align-items: center; gap: .6rem; min-height: 2.6rem; color: var(--t-muted); }
  .opt input { width: 1.2rem; height: 1.2rem; min-height: 0; }
  pre {
    background: var(--t-sunk); border: 1px solid var(--t-line-strong); padding: .8rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .8rem;
    white-space: pre-wrap; overflow-x: auto; margin: 0; color: var(--t-muted);
  }

  .limit { border-inline-start: 3px solid var(--t-line-strong); padding-inline-start: .9rem; gap: .6rem; }
</style>
