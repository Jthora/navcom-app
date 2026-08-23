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
  <p>
    Say what you ran out of. It goes to the watch, and whoever keeps the stash reads it.
  </p>
  <p class="cost">
    <!--
      The design decision, stated where somebody might otherwise expect the other thing.
      A tally is what most apps would build here and it is the wrong shape twice over.
    -->
    <strong>Nothing counts what you handed out.</strong> Not here, not in your patrol record,
    not anywhere — your record stays on your phone and nothing about what you carried or gave
    away is ever sent. This is a request, not a report, and there is no number in it to
    compare against anybody.
  </p>
  <p class="cost">
    <strong>Write about the supply, not the person</strong> — what ran out and what size, not
    who needed it or where they were. Nothing about anybody you helped belongs in this app.
  </p>
  <p class="cost">
    This is the least urgent thing you can send. It <strong>pages nobody</strong> and it can
    wait until you are somewhere warm.
  </p>
</section>

<form onsubmit={send}>
  {#if !operator.hasWatch}
    <p class="cost">
      <strong>Resupply goes to a watch, and you have not added one.</strong> That is the
      ordinary case for somebody working alone — there is nobody keeping a shared stash, and
      nothing here is missing.
    </p>
  {:else if watch.state.state === 'dark'}
    <Slot k="Watch"><Readout value="Dark" tone="cold" sub="sends anyway, read when one is up" /></Slot>
    <p class="cost">No watch is up. This will send, and it will be read when one is.</p>
  {/if}

  <label for="r">What ran out</label>
  <textarea id="r" bind:value={text} rows="3" placeholder="socks, size 10-12. hand warmers."></textarea>

  {#if operator.error}<p class="error">{operator.error}</p>{/if}
  {#if sent}<p class="ok" data-sent>Sent. Whoever keeps the stash will see it.</p>{/if}

  <button type="submit" disabled={!text.trim() || operator.busy}>
    {operator.busy ? 'Sending…' : 'Send'}
  </button>
</form>

<style>
  textarea { width: 100%; }
  .ok { color: var(--t-station); margin: 0; }
</style>
