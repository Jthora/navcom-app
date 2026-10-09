<script lang="ts">
  /**
   * The *Heard on* count, one layer down [relay-lists §7]: §7's sentence verbatim, what counts,
   * each relay with where it came from, when the watch was last heard there and any refusal of
   * this phone's last signal, the relays nothing is sent to, and that **a count of relays is not a
   * count of people**.
   *
   * Placed inside the receipt's own `Why` by the screens, so it adds no disclosure of its own:
   * `[data-capability] [data-why]` stays one element. Nothing is said until a read has had its
   * verdict, because before then a count of none would be a claim nothing supports.
   */
  import { HEARD_RULE, NOT_PEOPLE, heardLine, withheldLine } from '$lib/terminal/heard-copy';
  import type { Heard } from '$lib/terminal/heard.svelte';

  let { heard }: { heard: Heard } = $props();
</script>

{#if heard.asked}
  <div class="heard" data-heard-why>
    <p data-heard-line><strong>{heardLine(heard.known ? heard.on.length : null, heard.of)}.</strong> {HEARD_RULE}</p>
    <ul>
      {#each heard.relays as r (r.url)}
        <li data-heard-relay={r.url} data-heard={r.heard ? 'true' : 'false'}>{r.text}</li>
      {/each}
      {#each heard.withheld as w, i (i)}
        <li data-heard-withheld={w.url}>{withheldLine(w)}</li>
      {/each}
    </ul>
    <p data-not-people>{NOT_PEOPLE}</p>
  </div>
{/if}

<style>
  /* Logical, not physical: `rtl.test.ts` fails a stylesheet that would indent the wrong side. */
  .heard ul { margin: 0 0 0.6rem; padding-inline-start: 1.1rem; display: grid; gap: 0.3rem; overflow-wrap: anywhere; }
</style>
