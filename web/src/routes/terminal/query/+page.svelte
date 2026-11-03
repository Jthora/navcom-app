<script lang="ts">
  /**
   * Query goes to the watch. There is no search box here on purpose — someone with a
   * console and both hands free does the lookup, and that division of labour *is* the
   * product.
   */
  import { onMount } from 'svelte';
  import { isUnverified } from '@navcom/core';
  import { watch } from '$lib/terminal/watch.svelte';
  import { operator } from '$lib/terminal/session.svelte';

  import { Slot, Readout } from '$lib/components/panel';
  // No watch added and a watch that is down are different situations, and an operator
  // acts differently on each. They must not render as the same sentence.
  let hasWatch = $state(true);
  let stranded = $state(false);

  let text = $state('');
  let sentAt = $state<number | null>(null);

  onMount(() => {
    hasWatch = operator.hasWatch;
    stranded = operator.watchStranded;
    watch.start();
    return () => watch.stop();
  });

  const answer = $derived(operator.lastResponse);
  /**
   * An ack is not an answer. The spec gives a query 30s to be acknowledged and 120s to be
   * answered, so an ack here means the answer is still coming — rendering it as an answer
   * with a missing badge would be the wrong shape of wrong.
   */
  const stillComing = $derived(answer?.type === 'ack');

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    sentAt = Date.now();
    await operator.query(text.trim());
  }
</script>

<svelte:head>
  <title>Query · Field Terminal</title>
  <meta name="description" content="Ask the watch." />
</svelte:head>

<header>
  <p class="eyebrow"><a href="/terminal/">← Status</a></p>
  <h1>Query</h1>
</header>

{#if !hasWatch}
  <section>
    <Slot k="Watch">
      <Readout
        value={stranded ? 'Unreachable' : 'No watch'}
        tone={stranded ? 'warn' : 'cold'}
        sub={stranded ? 'none of its relays can be reached from this page' : 'nobody to ask'}
      />
    </Slot>
  </section>
{:else if watch.state.state === 'dark'}
  <section>
    <Slot k="Watch"><Readout value="Dark" tone="cold" sub="nobody to ask" /></Slot>
  </section>
{/if}

<form onsubmit={submit}>
  <label for="q">Question</label>
  <textarea id="q" bind:value={text} placeholder="bed tonight, has a dog"></textarea>
  <!-- Invariant 1, where somebody types. -->
  <p class="note"><strong>Write about the need, not the person.</strong></p>

  {#if operator.error}
    <p class="error">{operator.error}</p>
  {/if}

  <button type="submit" disabled={operator.busy || !text.trim()}>
    {operator.busy ? 'Waiting for the watch…' : 'Ask'}
  </button>
</form>

{#if operator.asked?.type === 'query' && !answer}
  <!-- A person answers a watch held on phones: the phone goes on listening while they do. -->
  <section data-asked>
    <Slot k="Asked">
      {#if operator.asked.gaveUp}
        <Readout value="No answer heard" tone="warn" sub="it may have come while you had no signal" />
        <button type="button" data-ask-again disabled={operator.busy} onclick={() => operator.askAgain()}>Ask again</button>
      {:else}
        <Readout value="Waiting for the watch" tone="neutral" sub="the answer shows here, and on Status" />
      {/if}
    </Slot>
  </section>
{/if}

{#if answer && (sentAt || operator.asked?.type === 'query')}
  <section class="answer" data-answer>
    <h2>Answer</h2>
    <!-- An agent is never presented as a human, on any surface [invariant 5]. -->
    <p class="who">
      {answer.responder?.callsign ?? 'Watch'}
      {#if answer.responder?.kind === 'agent'}<span class="kind">agent</span>{/if}
    </p>
    {#if stillComing}
      <p class="text pending">
        {answer.text ?? 'Received. The answer is still coming.'}
      </p>
    {:else}
      <p class="text">{answer.text ?? '(no text)'}</p>

      <!-- An answer without provenance renders as unverified. It does not render as fact. -->
      {#if isUnverified(answer)}
        <p class="prov unverified" data-provenance="none">
          Unverified — no source given. <strong>Call first.</strong>
        </p>
      {:else if answer.provenance}
        <p class="prov" data-provenance>
          {answer.provenance.method ?? 'source not stated'}{#if answer.provenance.verified},
            checked {answer.provenance.verified}{:else}, <strong>never checked</strong>{/if}
        </p>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .answer { border: 2px solid var(--t-line-strong); background: var(--t-raised); padding: 1rem; gap: .5rem; }
  .who { display: flex; align-items: baseline; gap: .5rem; color: var(--t-muted); margin: 0; }
  .kind {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .68rem; letter-spacing: .1em; text-transform: uppercase;
    border: 1px solid var(--t-line-strong); padding: .1rem .35rem; color: var(--t-faint);
  }
  .text { color: var(--t-ink); font-size: 1.1rem; line-height: 1.5; margin: 0; }
  .prov { font-size: .85rem; color: var(--t-faint); margin: 0; }
  .prov.unverified { color: var(--t-oncall); }
  .text.pending { color: var(--t-muted); }
</style>
