<script lang="ts">
  /**
   * A state, named rather than described.
   *
   * Rules 1, 2 and 8. `DARK`, not "no watch is on station right now, and Distress will page
   * nobody" — the second one is true, and it is an explanation, and explanations live behind
   * `Why`.
   *
   * The word limit is checked here rather than trusted, and marked rather than thrown: a copy
   * edit must never take a screen down at 2am. A browser test asserts that no screen anywhere
   * renders a marked one, which is the same discipline as everything else in this project —
   * checked against the built artifact.
   */
  import { isOverlong, type Tone } from '$lib/terminal/panel';

  let {
    value,
    tone = 'neutral',
    sub = null
  }: {
    value: string;
    tone?: Tone;
    /** The qualifier that will not fit in five words. Still terse — not a sentence. */
    sub?: string | null;
  } = $props();

  const overlong = $derived(isOverlong(value));
</script>

<span
  class="nc-readout"
  data-readout
  data-tone={tone}
  data-overlong={overlong ? 'true' : undefined}
  title={overlong ? 'This readout is longer than five words — it belongs in Why.' : undefined}
>
  <span data-readout-value>{value}</span>{#if sub}<small class="nc-readout-sub">{sub}</small>{/if}
</span>
