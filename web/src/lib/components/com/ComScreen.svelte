<script lang="ts">
  /**
   * The screen on top of Com's stack, drawn by the host of the entry it belongs to
   * [docs/design/com.md §6; groups.md §13].
   *
   * One branch for every screen there is or will be. The landing page renders this and nothing
   * else for a screen, so a new entry's screens reach a person without the page changing, and its
   * first paint with it.
   *
   * Each state says what it is [panel.md rule 6]: a screen another version left in history, an
   * entry still arriving, one that did not arrive, and one that arrived and then threw.
   *
   * An entry that did not arrive offers a reload, because nothing in the page fetches it again: the
   * browser keeps a module's failure [$lib/com/entries]. An installed app has no browser reload to
   * reach for, so without this it said "Not loaded" until it was closed. On Chromium the reload
   * brings it; on WebKit it does not yet [com.md §6].
   */
  import { Readout } from '$lib/components/panel';
  import { SCREENS, entries, readScreen, type HostProps } from '$lib/com/screens';

  /*
   * Named one by one, never spread. A spread needs a runtime helper, and the helper lands in the
   * chunk every hydrating page shares: 266 B gzipped on each, terminal and roster included,
   * measured 2026-10-17 when this first spread them.
   */
  let { screen: raw, nav, now, feed, active, feedUnloaded }: Omit<HostProps, 'screen'> & { screen: unknown } = $props();

  const screen = $derived(readScreen(raw));
  const entry = $derived(screen ? SCREENS[screen.kind].entry : null);
  // Asked for whenever the entry changes, as when Back lands on one: after the first time, nothing.
  $effect(() => {
    if (entry) void entries.load(entry);
  });
  const held = $derived(entry ? entries.held(entry) : undefined);
</script>

{#if !screen}
  <!-- Back still leaves it: what history holds is the browser's, not this version's to rewrite. -->
  <div data-screen-unknown><Readout value="Not in this version" tone="cold" sub="another version of NavCom opened this screen" /></div>
{:else if held?.status === 'ready'}
  <!--
    A screen that throws is said to have failed, here, and nothing else stops: without a boundary
    one bad render reset the whole page's updates [audit 11.X].
  -->
  <svelte:boundary>
    {#snippet failed(_error, reset)}
      <strong class="unloaded" data-screen-failed>This screen could not be shown</strong>
      <button type="button" onclick={reset}>Try again</button>
    {/snippet}
    <held.Host {screen} {nav} {now} {feed} {active} {feedUnloaded} />
  </svelte:boundary>
{:else if held?.status === 'failed'}
  <!-- The same words the map uses for the same failure [com.md §6]; a reload is that visit. -->
  <strong class="unloaded" data-screen-failed>Not loaded — it needs one visit with a connection</strong>
  <div class="nc-rail"><button type="button" data-reload onclick={() => location.reload()}>Reload</button></div>
{:else}
  <Readout value="Loading" tone="cold" />
{/if}

<style>
  .unloaded {
    color: var(--t-ink);
    font-size: 0.9rem;
  }
</style>
