<script lang="ts">
  /**
   * The one lit control.
   *
   * Rule 5. Fifteen controls of equal weight is a menu; a panel has one action lit and
   * everything else recessed to a rail.
   *
   * ## Hold
   *
   * `hold` makes it a threshold: the action fires only after the press has been held for its
   * full duration, and releasing early cancels with nothing done. That is for acts that are
   * deliberate and hard to undo — taking the watch, standing down, wiping.
   *
   * The hold logic exists **twice** in this application already, hand-rolled on the wipe screen
   * and again on distress. This is the one implementation, so those two can be converted onto
   * it rather than a third being written. A second implementation of a rule is how the two
   * drift apart.
   */
  import type { Tone } from '$lib/terminal/panel';

  let {
    label,
    tone = 'neutral',
    hold = 0,
    holdingLabel = 'Keep holding…',
    disabled = false,
    onfire
  }: {
    label: string;
    tone?: Tone;
    /** Milliseconds. Zero means an ordinary tap. */
    hold?: number;
    holdingLabel?: string;
    disabled?: boolean;
    onfire: () => void;
  } = $props();

  let fill = $state(0);
  let holding = $state(false);
  let frame: number | null = null;
  let started: number | null = null;

  function tick() {
    if (started === null) return;
    fill = Math.min(1, (Date.now() - started) / hold);
    if (fill >= 1) {
      release(true);
      return;
    }
    frame = requestAnimationFrame(tick);
  }

  function press() {
    if (disabled) return;
    if (!hold) {
      onfire();
      return;
    }
    holding = true;
    started = Date.now();
    frame = requestAnimationFrame(tick);
  }

  function release(complete = false) {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    started = null;
    holding = false;
    fill = 0;
    if (complete) onfire();
  }
</script>

<button
  class="nc-act"
  data-act
  data-tone={tone}
  data-holding={holding ? 'true' : undefined}
  {disabled}
  style="--fill: {fill}"
  onpointerdown={press}
  onpointerup={() => hold && release()}
  onpointerleave={() => hold && release()}
  onpointercancel={() => hold && release()}
>
  {#if hold}<span class="nc-act-fill"></span>{/if}
  <span class="nc-act-label">{holding ? holdingLabel : label}</span>
</button>
