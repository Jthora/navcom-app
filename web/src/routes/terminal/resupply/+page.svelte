<script lang="ts">
  /**
   * Telling whoever restocks that something ran out.
   *
   * The quiet corner of this app. It is not urgent, it does not page anybody, and it is the
   * only screen here where the honest instruction is "this can wait until you get home".
   */
  import { operator } from '$lib/terminal/session.svelte';
  import { watch } from '$lib/terminal/watch.svelte';

  import { Slot, Readout } from '$lib/components/panel';
  let text = $state('');
  let sent = $state(false);

  async function send(e: SubmitEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    await operator.resupply(text.trim());
    if (operator.lastResponse) {
      sent = true;
      text = '';
    }
  }
</script>

<svelte:head>
  <title>Resupply · Field Terminal</title>
  <meta name="description" content="Telling whoever restocks that something ran out." />
</svelte:head>

<header>
  <p class="eyebrow"><a href="/terminal/">← Status</a></p>
  <h1>Resupply</h1>
</header>

<section>
  <p>Say what ran out. Whoever keeps the stash reads it.</p>
  <!-- Invariant 1, where somebody types. -->
  <p class="cost"><strong>Write about the supply, not the person.</strong></p>
</section>

<form onsubmit={send}>
  {#if !operator.hasWatch}
    <Slot k="Watch">
      <Readout
        value="No watch"
        tone="cold"
        sub="this goes to a watch"
      />
    </Slot>
  {:else if watch.state.state === 'dark'}
    <Slot k="Watch"><Readout value="Dark" tone="cold" sub="sends anyway, read when one is up" /></Slot>
  {/if}

  <label for="r">What ran out</label>
  <textarea id="r" bind:value={text} rows="3" placeholder="socks, size 10-12. hand warmers."></textarea>

  {#if operator.error}<p class="error">{operator.error}</p>{/if}
  {#if sent}<p class="ok" data-sent>Sent.</p>{/if}

  <button type="submit" disabled={!text.trim() || operator.busy}>
    {operator.busy ? 'Sending…' : 'Send'}
  </button>
</form>

<style>
  textarea { width: 100%; }
  .ok { color: var(--t-station); margin: 0; }
</style>
