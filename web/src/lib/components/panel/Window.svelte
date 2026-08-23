<script lang="ts">
  /**
   * A response window, running.
   *
   * Every signal carries a real window and they are normative — `RESPONSE_WINDOW` in the core,
   * *"surfaced to the operator rather than hidden"*. Nothing on any screen has ever shown one
   * moving.
   *
   * The bar is the readout, not an ornament under one. A static "74s left" is wrong within a
   * second of being drawn and makes the reader do arithmetic to know whether that is bad;
   * depletion is the quantity, read as position.
   *
   * **The fraction is painted before any animation runs.** This project disables every
   * animation under `prefers-reduced-motion`, so a bar that only became correct once its
   * keyframe started would show zero elapsed to exactly the people who turned motion off. The
   * keyframe is seeded with a negative delay and picks up from the painted position.
   */
  import { windowState } from '$lib/terminal/panel';

  let {
    sentAt,
    seconds,
    now = Math.floor(Date.now() / 1000),
    label = 'Sent'
  }: {
    /** Unix seconds. */
    sentAt: number;
    /** The window from `RESPONSE_WINDOW`. */
    seconds: number;
    now?: number;
    label?: string;
  } = $props();

  const w = $derived(windowState(sentAt, seconds, now));
</script>

<div
  class="nc-bar"
  data-kind="window"
  data-run={seconds > 0 ? '' : undefined}
  data-expired={w.expired ? 'true' : undefined}
>
  <i style="--f: {w.fraction}; animation-duration: {seconds}s; animation-delay: {w.delay}s"></i>
</div>
<div class="nc-bar-scale">
  <span>{label}</span>
  <!--
    Two renderings of the same quantity, and only one shows at a time.

    The bar is the honest render while it can move: a static number is stale the moment it is
    painted. With motion disabled it cannot move at all, so the number takes over — stale by a
    few seconds beats a bar that will never advance. CSS decides, so neither is ever both.
  -->
  <span class="nc-bar-window">{w.expired ? 'window passed' : `${seconds}s window`}</span>
  <span class="nc-bar-left" data-remaining>
    {w.expired ? 'window passed' : `${w.remaining}s left of ${seconds}s`}
  </span>
</div>
