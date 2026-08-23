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
    action = null,
    ...rest
  }: {
    /** Left of the header strip, and the section's heading. */
    label: string;
    /** Right of the header strip. The state or post this panel is reporting. */
    post?: string | null;
    children: Snippet;
    /** The one lit action. Rule 5 — if a screen wants two, one of them belongs on the rail. */
    action?: Snippet | null;
    [key: string]: unknown;
  } = $props();
</script>

<!--
  `...rest` is here because the component was written without it and then went unused: every
  screen needs its own `data-*` markers, so the first conversion hand-rolled the markup instead
  and the component sat in the tree being imported by nothing. A component nobody uses is not
  built [verification.md].
-->
<section class="nc-panel" {...rest}>
  <header class="nc-panel-head">
    <!--
      A heading, not a span. A screen made entirely of panels with no headings is one a screen
      reader cannot navigate, and the terse label is exactly what a heading should say.
    -->
    <h2 class="nc-panel-label">{label}</h2>
    {#if post}<span class="nc-panel-post" data-post>{post}</span>{/if}
  </header>
  <div class="nc-panel-slots">{@render children()}</div>
  {#if action}
    <div class="nc-panel-act">{@render action()}</div>
  {/if}
</section>
