<script lang="ts">
  /**
   * The floor: who is out, ordered by time.
   *
   * When somebody crosses their window they rise past the others, and **the movement is the
   * event** — nothing needs to be diffed against what you last read, and peripheral vision is
   * best in the world at detecting exactly this and worst at reading text.
   *
   * Two constraints make it honest rather than impressive:
   *
   * - **Names, never a tally.** No "2 out, 1 overdue". A number invites gaming and a name does
   *   not, and provenance by name is the whole model
   * - Movement reads as *what this phone last heard*, never as tracking. The board is built
   *   from received signals and elapsed time — the only two things this device knows — and it
   *   carries a line saying so
   *
   * Ordering is not decided here. It comes from the board the core already derives, so there is
   * one implementation of what "overdue" means rather than a second one drifting in a component.
   */
  import { flip } from 'svelte/animate';

  interface Row {
    operator: string;
    callsign: string;
    area: string;
    status: string;
    /**
     * What the right-hand column says, when the status word alone is not the sentence a
     * person needs. "is past the time they gave" is a nudge; "overdue" is a verdict.
     */
    note?: string | null;
    /** Seconds since this device last heard from them. */
    since?: number | null;
  }

  let {
    entries,
    empty = 'No contact'
  }: { entries: Row[]; empty?: string } = $props();
</script>

{#if entries.length === 0}
  <!-- Rule 6. Silence is a positive readout: nothing has been heard, which differs from
       nothing being wrong and differs again from the app being broken. -->
  <p class="nc-readout" data-tone="cold" data-readout data-empty-board>{empty}</p>
{:else}
  <div class="nc-floor" data-floor>
    {#each entries as e (e.operator)}
      <div class="nc-floor-row" data-status={e.status} animate:flip={{ duration: 320 }}>
        <span class="nc-floor-mark"></span>
        <span>
          <span class="nc-floor-name">{e.callsign}</span>
          <span class="nc-floor-where">{e.area}</span>
        </span>
        <span class="nc-floor-when">{e.note ?? e.status}</span>
      </div>
    {/each}
  </div>
{/if}
