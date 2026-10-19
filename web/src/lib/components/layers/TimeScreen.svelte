<script lang="ts">
  /**
   * One standard-time band, tapped on the map with Time zones chosen [D8; docs/design/map.md, Layers].
   *
   * It says what the band knows and no more: an offset from UTC, as Natural Earth drew it in 2012,
   * and the time at that offset by this phone's clock. Not what clocks there show, which daylight
   * saving changes and the band does not know [invariant 7]. A directory region knows its own zone,
   * and its place gives its clocks' time.
   *
   * Its words come from the time zones' own code. A screen Back or a reload lands on can open without
   * it ever having loaded, so when it does not arrive the screen says so, as the other layers' screens
   * do, and the offset it was opened with still shows [com-distress, timezones specs].
   */
  import { Panel, Readout, Slot } from '$lib/components/panel';

  let { offset, now }: { offset: number; now: number } = $props();
  /** Ticks each minute with the page; read when it opens, so the first minute is right too. */
  const at = $derived(Math.max(now, Date.now()));
  /** The time zones' own code, which names and tells the time at an offset: by `import()`, as the map loads it. */
  let tz = $state.raw<typeof import('$lib/grid/layers/timezones') | null>(null);
  let failed = $state(false);
  $effect(() =>
    void import('$lib/grid/layers/timezones').then(
      (m) => (tz = m),
      () => (failed = true)
    )
  );
  /** The offset as it came, `UTC+5.75`, until the code that writes `UTC+5:45` is here: true, if plainer. */
  const plain = $derived(`UTC${offset < 0 ? '−' : '+'}${Math.abs(offset)}`);
  const label = $derived(tz ? tz.labelOf(offset) : plain);
</script>

<div data-screen="time" data-offset={offset}>
  <Panel label="Time zone" post={label}>
    {#if failed && !tz}
      <strong class="unloaded" data-time-failed>Not loaded — it needs one visit with a connection</strong>
    {:else}
      <Slot k="Now"><Readout value={tz ? tz.clockAt(offset, at) : 'Loading'} tone={tz ? 'neutral' : 'cold'} sub="standard time at {label}" /></Slot>
    {/if}
    <Slot k="Drawn"><Readout value="2012" tone="cold" sub="no daylight saving; some lines have moved since" /></Slot>
    <Slot k="Source"><Readout value="Natural Earth" tone="neutral" verbatim sub="public domain" /></Slot>
  </Panel>
</div>

<style>
  .unloaded {
    color: var(--t-ink);
    font-size: 0.9rem;
  }
</style>
