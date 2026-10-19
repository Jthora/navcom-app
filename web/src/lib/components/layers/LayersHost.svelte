<script lang="ts">
  /**
   * The layers entry's screens, drawn for Com [docs/design/map.md, Layers; com.md §6].
   *
   * In Com rather than over the map, so none of them can ever cover Distress, which is in a layer
   * of its own that nothing covers [com.md §4]; `e2e/com-distress.spec.ts` taps for it over each.
   */
  import type { HostProps } from '$lib/com/screens';
  import LayersScreen from './LayersScreen.svelte';
  import LookupScreen from './LookupScreen.svelte';
  import SphereScreen from './SphereScreen.svelte';
  import TimeScreen from './TimeScreen.svelte';
  import ZoneScreen from './ZoneScreen.svelte';

  let { screen, nav, now, active, feed }: HostProps = $props();
</script>

{#if screen.kind === 'layers'}
  <LayersScreen {nav} />
{:else if screen.kind === 'zone'}
  <ZoneScreen id={screen.id} {nav} {active} {feed} />
{:else if screen.kind === 'lookup'}
  <LookupScreen {nav} />
{:else if screen.kind === 'time'}
  <TimeScreen offset={Number(screen.offset)} {now} />
{:else if screen.kind === 'sphere'}
  <SphereScreen id={screen.id} code={screen.code} {nav} />
{/if}
