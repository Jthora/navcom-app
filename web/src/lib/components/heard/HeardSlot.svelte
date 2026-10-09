<script lang="ts">
  /**
   * *Heard on*: how many of the relays a `Distress` from this phone goes to the watch is heard on
   * [relay-lists §7, invariant 9].
   *
   * The key carries "Heard on" because the count as a sentence — *Heard on 2 of 3 relays* — is six
   * words, and a readout stops at five. The sentence itself is in `HeardWhy`, word for word.
   *
   * Two ways to be shown:
   *
   * - **Live** (`heard`), on Status and sign-on, from the read those screens already make. A dash
   *   until a read has had its verdict: no count is not a count of none.
   * - **Held** (`held`), on the `Distress` screen, which opens no read of its own until a `Distress`
   *   starts: the count this phone last held, and how long ago it read it, or *Not read yet*.
   *
   * A read no relay answered is *Unknown*, both ways: this phone could not ask, which is not the
   * watch heard nowhere [invariant 7].
   */
  import { Slot, Readout } from '$lib/components/panel';
  import { ago, heardReadout } from '$lib/terminal/heard-copy';
  import type { Heard, HeldCount } from '$lib/terminal/heard.svelte';

  let {
    heard = null,
    held = undefined,
    nowMs
  }: {
    heard?: Heard | null;
    /** Given (null included) for the held reading the `Distress` screen shows. */
    held?: HeldCount | null;
    nowMs: number;
  } = $props();

  const live = $derived(heard && heard.asked ? heardReadout(heard.known ? heard.on.length : null, heard.of) : null);
  const kept = $derived(held ? heardReadout(held.on, held.of) : null);
  const keptAgo = $derived(held ? ago((nowMs - held.atMs) / 1000) : '');
</script>

{#if held !== undefined}
  <Slot k="Heard on">
    {#if held && kept}
      <Readout
        value={kept.value}
        tone={kept.tone}
        sub={held.on === null ? `${kept.sub}, ${keptAgo} ago` : `as last read, ${keptAgo} ago`}
      />
    {:else}
      <Readout value="Not read yet" tone="cold" sub="nothing read since this app opened" />
    {/if}
  </Slot>
{:else if live}
  <Slot k="Heard on">
    <Readout value={live.value} tone={live.tone} sub={live.sub} />
  </Slot>
{:else}
  <Slot k="Heard on" />
{/if}
