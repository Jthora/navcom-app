<script lang="ts">
  /**
   * One `KEY / VALUE` pair, in the same place every time.
   *
   * Rule 4. Spatial memory is the whole performance gain: after a week an operator reads the
   * panel without reading it, which is what somebody on a street at 2am actually needs.
   *
   * **An empty slot still renders.** A fact that is absent shows its key and a dash, because a
   * slot that disappears when it has nothing to say is a slot you cannot learn the position
   * of — and it makes "nothing to report" indistinguishable from "not asked".
   */
  import type { Snippet } from 'svelte';
  import Readout from './Readout.svelte';

  let { k, children = null }: { k: string; children?: Snippet | null } = $props();
</script>

<div class="nc-slot" data-slot={k.toLowerCase().replace(/\s+/g, '-')}>
  <span class="nc-slot-k">{k}</span>
  <span class="nc-slot-v">
    {#if children}{@render children()}{:else}<Readout value="—" tone="cold" />{/if}
  </span>
</div>
