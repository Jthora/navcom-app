<script lang="ts">
  /**
   * Passing an Assist on to the others out [core `passed-on`].
   *
   * An offer, in the holder's words: who asked, where and how soon, and never the asker's own text,
   * which may be about somebody they are with [invariants 1, 8]. Taking it up is the reader's.
   */
  import { Readout } from '$lib/components/panel';

  let {
    id,
    draft,
    others,
    passedTo,
    onpass
  }: {
    id: string;
    /** What it says unless the holder changes it. */
    draft: string;
    /** How many others are out to pass it to. */
    others: number;
    passedTo: string[] | null;
    onpass: (text: string) => Promise<boolean>;
  } = $props();

  let open = $state(false);
  let text = $state('');
  let busy = $state(false);
  let failed = $state(false);

  async function pass() {
    busy = true;
    failed = false;
    try {
      if (await onpass(text)) open = false;
      else failed = true;
    } finally {
      busy = false;
    }
  }
</script>

{#if passedTo}
  <span data-passed><Readout value="Passed on" tone="neutral" sub={passedTo.join(', ')} /></span>
{:else if open}
  <label for="p-{id}">To the others out</label>
  <textarea id="p-{id}" bind:value={text} rows="2"></textarea>
  <div class="row">
    <button onclick={pass} disabled={busy || !text.trim()}>Pass on</button>
    <button onclick={() => (open = false)}>Cancel</button>
  </div>
  {#if failed}
    <span data-pass-failed><Readout value="Reached nobody" tone="warn" sub="no relay took it" /></span>
  {/if}
{:else if others > 0}
  <button data-pass-on onclick={() => { text = draft; failed = false; open = true; }}>Pass to the others out</button>
{/if}

<style>
  .row { display: flex; gap: .6rem; }
  textarea { width: 100%; }
</style>
