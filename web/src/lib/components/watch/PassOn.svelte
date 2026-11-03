<script lang="ts">
  /**
   * Passing an Assist on to the others out [core `passed-on`].
   *
   * An offer, in the holder's words: who asked, where and how soon, and never the asker's own text,
   * which may be about somebody they are with [invariants 1, 8]. Taking it up is the reader's.
   *
   * To everybody out, or the teams the board is narrowed to, or the nearest few of those who share
   * where they are (2026-11-02): an Assist that needs somebody now is for whoever is close.
   */
  import { Readout } from '$lib/components/panel';
  let {
    id,
    draft,
    others,
    to,
    near,
    passedTo,
    onpass
  }: {
    id: string;
    /** What it says unless the holder changes it. */
    draft: string;
    /** How many others are out to pass it to. */
    others: number;
    /** Who they are, said: *the others out*, or the teams chosen. */
    to: string;
    /** The nearest few of them, by name, where the asker and they share where they are. */
    near: string[];
    passedTo: string[] | null;
    onpass: (text: string, nearest: boolean) => Promise<boolean>;
  } = $props();

  let open = $state(false);
  let nearest = $state(false);
  let text = $state('');
  let busy = $state(false);
  let failed = $state(false);

  function start(toNearest: boolean) {
    nearest = toNearest;
    text = draft;
    failed = false;
    open = true;
  }

  async function pass() {
    busy = true;
    failed = false;
    try {
      if (await onpass(text, nearest)) open = false;
      else failed = true;
    } finally {
      busy = false;
    }
  }
</script>

{#if passedTo}
  <span data-passed><Readout value="Passed on" tone="neutral" sub={passedTo.join(', ')} /></span>
{:else if open}
  <label for="p-{id}">To {nearest ? near.join(', ') : to}</label>
  <textarea id="p-{id}" bind:value={text} rows="2"></textarea>
  <div class="row">
    <button onclick={pass} disabled={busy || !text.trim()}>Pass on</button>
    <button onclick={() => (open = false)}>Cancel</button>
  </div>
  {#if failed}
    <span data-pass-failed><Readout value="Reached nobody" tone="warn" sub="no relay took it" /></span>
  {/if}
{:else if others > 0}
  <div class="row">
    <button data-pass-on onclick={() => start(false)}>Pass to {to}</button>
    {#if near.length > 0 && near.length < others}
      <button data-pass-near onclick={() => start(true)}>Pass to the nearest {near.length}</button>
    {/if}
  </div>
{/if}

<style>
  .row { display: flex; gap: .6rem; }
  textarea { width: 100%; }
</style>
