<script lang="ts">
  /**
   * What the watch has written about you [C33].
   *
   * The hard part of this screen is not rendering entries — it is being honest about what
   * checking them proves. Three different situations must not look alike:
   *
   *  1. Verified against a root this device saw the watch publish. Real.
   *  2. Proofs that verify against a root the watch supplied with them. **Worth nothing** —
   *     the watch produced both sides.
   *  3. Entries that never verified at all.
   *
   * And under all three sits the limit none of them close: an entry the watch simply never
   * wrote is invisible here, and every proof still passes.
   */
  import { onMount } from 'svelte';
  import { Slot, Readout } from '$lib/components/panel';
  import type { ReviewCheck } from '@navcom/core';
  import { operator } from '$lib/terminal/session.svelte';
  import { watch } from '$lib/terminal/watch.svelte';
  import { seenRoots } from '$lib/terminal/roots';

  let result = $state<{ own: ReviewCheck; escalation: ReviewCheck | null } | null>(null);
  let asked = $state(false);
  let roots = $state(0);

  onMount(() => {
    roots = seenRoots().length;
    watch.start();
    return () => watch.stop();
  });

  async function ask() {
    asked = true;
    result = await operator.reviewLog();
    roots = seenRoots().length;
  }

  const check = $derived(result?.own ?? null);

  const notSeen = $derived(
    check?.problems.some((p) => p.kind === 'root-not-seen') ?? false
  );

  function when(at: number): string {
    return new Date(at * 1000).toISOString().replace('T', ' ').slice(0, 16);
  }

  const WORDING: Record<string, string> = {
    'took-watch': 'took the watch',
    'handed-over': 'handed the watch over',
    acked: 'acknowledged your signal',
    answered: 'answered you',
    'marked-overdue': 'marked you overdue',
    contacted: 'contact with you',
    escalated: 'your Distress',
    'drill-run': 'ran a drill',
    'drill-result': 'drill result'
  };
</script>

<svelte:head>
  <title>Your record · Field Terminal</title>
  <meta name="description" content="What the watch has written about you." />
</svelte:head>

<header>
  <p class="eyebrow"><a href="/terminal/">← Status</a></p>
  <h1>Your record</h1>
</header>

<section>
  <p>The watch writes down what it does.</p>
  <Slot k="Commitments seen">
    <Readout
      value="{roots} published"
      tone={roots === 0 ? 'cold' : 'neutral'}
      sub="seen by this device"
    />
  </Slot>
</section>

<button data-ask onclick={ask} disabled={operator.busy || watch.state.state === 'dark'}>
  {operator.busy ? 'Asking…' : 'Ask the watch'}
</button>

{#if watch.state.state === 'dark'}
  <Slot k="Log">
    <Readout value="No watch to ask" tone="cold" sub="your record is on the node, not here" />
  </Slot>
{/if}

{#if operator.error}
  <p class="error">{operator.error}</p>
{/if}

{#if asked && check}
  <!-- The verdict comes before the entries, because it says what they are worth. -->
  {#if check.sound}
    <section class="verdict good" data-verdict="verified">
      <h2>Checked</h2>
      <!-- The limit beside the tick: a check passes on a log that never had an entry. -->
      <p>None of these can have been changed since. A missing entry would not show.</p>
    </section>
  {:else if notSeen}
    <section class="verdict warn" data-verdict="unchecked">
      <h2>Not checked</h2>
      <p>This device has never seen the watch publish the commitment it answered with.</p>
      <p class="cost">Leave this open and ask again later.</p>
    </section>
  {:else}
    <section class="verdict bad" data-verdict="failed">
      <h2>Did not check out</h2>
      <p>
        Some of what the watch sent does not match what it publicly committed to.
        <strong>That is not a glitch.</strong>
      </p>
    </section>
  {/if}

  <section class="entries">
    <h2>{check.entries.length} entr{check.entries.length === 1 ? 'y' : 'ies'}</h2>
    {#if check.entries.length === 0}
      <p>Nothing recorded about you.</p>
    {:else}
      <ol>
        {#each check.entries as { entry, proven }, i (i)}
          <li class:unproven={!proven}>
            <span class="at">{when(entry.at)}</span>
            <span class="what">{WORDING[entry.action] ?? entry.action}</span>
            <span class="outcome">{entry.outcome.replace(/-/g, ' ')}</span>
            {#if !proven}<span class="flag">unproven</span>{/if}
          </li>
        {/each}
      </ol>
    {/if}
  </section>

  {#if result?.escalation}
    <section class="escalation">
      <h2>What the escalation executor recorded</h2>
      <p><strong>Not checkable yet</strong>: this is the executor's own word.</p>
      <section class="entries">
        <h3>
          {result.escalation.entries.length}
          entr{result.escalation.entries.length === 1 ? 'y' : 'ies'}
        </h3>
        {#if result.escalation.entries.length === 0}
          <p>Nothing recorded about you there either.</p>
        {:else}
          <ol>
            {#each result.escalation.entries as { entry }, i (i)}
              <li>
                <span class="at">{when(entry.at)}</span>
                <span class="what">{WORDING[entry.action] ?? entry.action}</span>
                <span class="outcome">{entry.outcome.replace(/-/g, ' ')}</span>
              </li>
            {/each}
          </ol>
        {/if}
      </section>
    </section>
  {/if}

{:else if asked && !operator.busy && !operator.error}
  <section>
    <p>This watch keeps no accountability log.</p>
  </section>
{/if}

<style>
  button { width: 100%; }
  .verdict { border: 2px solid var(--t-line-strong); padding: 1rem 1.1rem; }
  .verdict.good { border-color: var(--t-station); }
  .verdict.good h2 { color: var(--t-station); }
  .verdict.warn { border-color: var(--t-oncall); }
  .verdict.warn h2 { color: var(--t-oncall); }
  .verdict.bad { border-color: var(--t-dark); background: var(--t-sunk); }
  .verdict.bad h2 { color: var(--t-dark); }

  ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .55rem; }
  li { display: grid; grid-template-columns: auto 1fr; gap: .1rem .7rem; align-items: baseline;
       border-inline-start: 2px solid var(--t-line); padding-inline-start: .7rem; }
  li.unproven { border-inline-start-color: var(--t-dark); }
  .at { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .78rem;
        color: var(--t-faint); grid-row: 1 / span 2; }
  .what { color: var(--t-ink); }
  .outcome { grid-column: 2; font-size: .88rem; color: var(--t-muted); }
  .flag { grid-column: 2; font-size: .72rem; letter-spacing: .1em; text-transform: uppercase;
          color: var(--t-dark); }

  .escalation {
    border: 2px solid var(--t-line-strong); padding: 1rem 1.1rem; display: flex;
    flex-direction: column; gap: .6rem;
  }
  .escalation h2 { font-size: 1rem; }
  .escalation h3 { font-size: .9rem; color: var(--t-muted); margin: 0; }
</style>
