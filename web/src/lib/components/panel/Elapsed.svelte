<script lang="ts">
  /**
   * A Distress, climbing.
   *
   * `RESPONSE_WINDOW` has exactly one null in it and it is `distress`. A Distress has no
   * window: it does not expire, and *"it stays on this board until a human has actually ended
   * it."*
   *
   * So this must never be a depleting bar. **A bar that empties says the signal resolves
   * itself**, and a Distress that appears to resolve itself is the silent failure invariant 2
   * exists to forbid. It climbs instead, against an asymptote it cannot reach — there is no
   * finish line, because there is no window.
   *
   * Everything else on the interface drains left to right and ends. This one fills and keeps
   * filling, and an operator learns the difference once.
   */
  import { elapsedLabel, elapsedState } from '$lib/terminal/panel';

  let {
    since,
    now = Math.floor(Date.now() / 1000),
    label = 'Raised'
  }: { since: number; now?: number; label?: string } = $props();

  const e = $derived(elapsedState(since, now));
</script>

<div class="nc-bar" data-kind="elapsed" data-climbing="true">
  <i style="--f: {e.fraction}"></i>
</div>
<div class="nc-bar-scale">
  <span>{label} · {elapsedLabel(e.seconds)}</span>
  <!-- Stated, because it is the whole point: nothing closes this except a person. -->
  <span>no expiry</span>
</div>
