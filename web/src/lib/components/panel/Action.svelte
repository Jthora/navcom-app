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
  import { onDestroy } from 'svelte';
  import { pulse } from '$lib/terminal/haptic';
  import type { Tone } from '$lib/terminal/panel';

  let {
    label,
    tone = 'neutral',
    hold = 0,
    holdingLabel = 'Keep holding…',
    disabled = false,
    href = null,
    onfire = null
  }: {
    label: string;
    tone?: Tone;
    /** Milliseconds. Zero means an ordinary tap. */
    hold?: number;
    holdingLabel?: string;
    disabled?: boolean;
    /**
     * Renders a link instead of a button.
     *
     * An action that goes somewhere should be a link: it opens in a new tab, it is announced
     * as a link, and it works before this screen's JavaScript has run — which matters here,
     * because every terminal screen is prerendered and tappable before it hydrates.
     */
    href?: string | null;
    onfire?: (() => void) | null;
  } = $props();

  let fill = $state(0);
  let holding = $state(false);
  let frame: number | null = null;
  let done: ReturnType<typeof setTimeout> | null = null;
  let started: number | null = null;

  /*
   * The fill is animation; the firing is a timer. They are separate on purpose.
   *
   * Driving completion from `requestAnimationFrame` means the act only happens if frames are
   * delivered — and rAF is throttled hard, or paused outright, in a backgrounded or
   * power-saving page. A threshold that needs animation frames to complete is one that can
   * fail on a phone in low power mode, which is the phone this is written for.
   *
   * So the deadline is a `setTimeout` that does not care whether anything was painted, and the
   * frame loop only moves the bar.
   */
  function tick() {
    if (started === null) return;
    fill = Math.min(1, (Date.now() - started) / hold);
    frame = requestAnimationFrame(tick);
  }

  function press() {
    if (disabled) return;
    if (!hold) {
      // Confirmation of the press, in the moment of the press.
      pulse('tap');
      onfire?.();
      return;
    }
    pulse('tap');
    holding = true;
    started = Date.now();
    frame = requestAnimationFrame(tick);
    done = setTimeout(() => release(true), hold);
  }

  function release(complete = false) {
    if (frame !== null) cancelAnimationFrame(frame);
    if (done !== null) clearTimeout(done);
    frame = null;
    done = null;
    started = null;
    holding = false;
    fill = 0;
    // The threshold fired. Told to the hand, so nobody has to look down to know the hold took.
    if (complete) pulse('committed');
    if (complete) onfire?.();
  }

  // Found in robustness audit: this component had no unmount cleanup at all. A hold armed
  // by press() is a real setTimeout in the global queue, not tied to this component's
  // lifetime -- navigating away mid-hold (interrupted before the threshold) left it armed,
  // and it fired seconds later regardless. Used with `hold` for panic wipe and taking over
  // a watch, where a fire nobody is looking at the screen for is not a small thing.
  onDestroy(() => {
    if (frame !== null) cancelAnimationFrame(frame);
    if (done !== null) clearTimeout(done);
  });
</script>

{#if href}
  <a class="nc-act" data-act data-tone={tone} {href}>
    <span class="nc-act-label">{label}</span>
  </a>
{:else}
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
{/if}
