<script lang="ts">
  /**
   * The shell every terminal screen is built in.
   *
   * Rule 4 (fixed slots) and rule 5 (one lit action). The header names where you are and what
   * post you hold; the body is slots in a fixed order; the foot is the single lit control, or
   * nothing.
   *
   * Deliberately has no opinion about its contents. The discipline is in `Slot` and `Readout`,
   * which are the pieces a screen is not allowed to improvise around.
   */
  import type { Snippet } from 'svelte';

  let {
    label,
    post = null,
    children,
    action = null
  }: {
    /** Left of the header strip. Where you are. */
    label: string;
    /** Right of the header strip. The post you hold, if any. */
    post?: string | null;
    children: Snippet;
    /** The one lit action. Rule 5 — if a screen wants two, one of them belongs on the rail. */
    action?: Snippet | null;
  } = $props();
</script>

<section class="nc-panel" data-panel={label}>
  <header class="nc-panel-head">
    <span>{label}</span>
    {#if post}<span class="nc-panel-post" data-post>{post}</span>{/if}
  </header>
  <div class="nc-panel-slots">{@render children()}</div>
  {#if action}
    <div class="nc-panel-act">{@render action()}</div>
  {/if}
</section>
