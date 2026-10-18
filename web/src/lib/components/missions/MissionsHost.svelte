<script lang="ts">
  /**
   * The missions entry's screens, drawn for Com [docs/design/com.md §6; groups.md §13].
   *
   * These branches were the landing page's own, one per screen, and so was what they read: which
   * missions are open, which could not be read, and whether either is known. Here they arrive with
   * the entry, already loaded when a screen opens, and the page's first paint carries none of it.
   */
  import { Panel, Readout, Slot } from '$lib/components/panel';
  import type { HostProps } from '$lib/com/screens';
  import MissionList from './MissionList.svelte';
  import MissionPage from './MissionPage.svelte';
  import PlaceScreen from './PlaceScreen.svelte';
  import ReportScreen from './ReportScreen.svelte';
  import ReportsScreen from './ReportsScreen.svelte';
  import YoursScreen from './YoursScreen.svelte';

  let { screen, nav, now, feed, active, feedUnloaded }: HostProps = $props();

  /** Packages NavCom would not show: their addresses read "could not be read", never "over" [11.E]. */
  const refused = $derived(feed.status === 'live' || feed.status === 'cached' ? feed.refused : []);
  /** What is still open, by address: a claim on a mission closed early holds no place in the cap. */
  const openSet = $derived(new Set(active.map((m) => m.address)));
  const unreadSet = $derived(new Set(refused.map((r) => r.address)));
  /**
   * Whether this device knows which missions are open at all. Until it does — reaching, no relay,
   * or no missions code — a claim's mission is unknown, not over [invariant 7; audit 11.I].
   */
  const missionsKnown = $derived(!feedUnloaded && (feed.status === 'live' || feed.status === 'cached'));
</script>

{#if screen.kind === 'missions'}
  <MissionList
    missions={active}
    province={screen.province}
    status={feedUnloaded ? 'unloaded' : feed.status}
    {refused}
    {now}
    onopen={(address) => nav.open({ kind: 'mission', address })}
  />
{:else if screen.kind === 'place'}
  <PlaceScreen
    place={screen}
    missions={active}
    status={feedUnloaded ? 'unloaded' : feed.status}
    {now}
    onopen={(address) => nav.open({ kind: 'mission', address })}
  />
{:else if screen.kind === 'yours'}
  <YoursScreen
    {now}
    open={missionsKnown ? openSet : undefined}
    unread={unreadSet}
    onopen={(address) => nav.open({ kind: 'mission', address })}
    onreport={(address) => nav.open({ kind: 'report', address })}
    onreports={(address) => nav.open({ kind: 'reports', address })}
  />
{:else if screen.kind === 'report'}
  <ReportScreen address={screen.address} {now} ondone={() => nav.back()} />
{:else if screen.kind === 'reports'}
  <ReportsScreen address={screen.address} missions={active} {now} />
{:else if screen.kind === 'mission'}
  {@const address = screen.address}
  {@const m = active.find((x) => x.address === address)}
  {#if m}
    <MissionPage mission={m} {now} open={openSet} asOf={feed.status === 'cached' ? feed.at : null} onreports={() => nav.open({ kind: 'reports', address })} />
  {:else if feedUnloaded}
    <!-- The key's own words for the same failure: "Loading" here never ended [audit 11.I]. -->
    <strong class="unloaded" data-mission-unloaded>Missions not loaded — they need one visit with a connection</strong>
  {:else if feed.status === 'connecting'}
    <Readout value="Loading" tone="cold" />
  {:else if feed.status === 'unavailable'}
    <!-- No relay answered and nothing is remembered: whether it is open is not known, and is not "gone". -->
    <Panel label="Mission" post="Unknown">
      <Slot k="Open"><Readout value="Unknown" tone="cold" sub="neither The Record nor its mirror can be reached" /></Slot>
    </Panel>
  {:else}
    <!-- It ended, or was closed, while open here: said, not left blank. -->
    {@const why = refused.find((r) => r.address === address)?.because}
    <Panel label="Mission" post="Gone">
      <!-- A package NavCom could not read is not one that ended: said as what it is [11.E]. -->
      <Slot k="Open"><Readout value={why ? 'Could not be read' : 'No longer open'} tone="cold" sub={why ?? 'it ended or was closed'} /></Slot>
    </Panel>
  {/if}
{/if}

<style>
  .unloaded {
    color: var(--t-ink);
    font-size: 0.9rem;
  }
</style>
