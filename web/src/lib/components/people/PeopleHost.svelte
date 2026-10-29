<script lang="ts">
  /**
   * The people entry's screens, drawn for Com [docs/design/groups.md §3, §4; com.md §6].
   *
   * In Com rather than over the map, so none of them can cover `Distress`, which is in a layer of its
   * own that nothing covers [com.md §4]; `e2e/com-distress.spec.ts` taps for it over each.
   */
  import type { HostProps } from '$lib/com/screens';
  import FindScreen from './FindScreen.svelte';
  import ProfileScreen from './ProfileScreen.svelte';
  import YouScreen from './YouScreen.svelte';

  let { screen, nav, now }: HostProps = $props();
</script>

{#if screen.kind === 'profile'}
  <ProfileScreen h={screen.h} {nav} {now} />
{:else if screen.kind === 'you'}
  <YouScreen {nav} />
{:else if screen.kind === 'find'}
  <FindScreen {nav} />
{/if}
