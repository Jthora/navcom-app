<script lang="ts">
  /**
   * The missions on the map, as a list Com can open [docs/design/com.md §1].
   *
   * The way in that does not need the map: from the missions line in the map's key, by keyboard or
   * screen reader alike. A tap on a lit province opens the same list, narrowed to that province.
   *
   * Every row says an agent posted it when one did [invariant 4], and when it ends, because a
   * mission is volatile and shows its age [invariant 7].
   */
  import type { Mission } from '@navcom/core';
  import { Panel, Readout, Slot } from '$lib/components/panel';
  import { endsIn, endsSoon, placeName } from './format';

  let {
    missions,
    province,
    status,
    now,
    onopen
  }: {
    /** Active missions, newest version of each, already in order. */
    missions: readonly Mission[];
    /** Narrowed to one province, or `null` for every mission. */
    province: string | null;
    /** Where the missions are coming from, so an empty list says why it is empty. */
    status: 'live' | 'cached' | 'connecting' | 'unavailable' | 'unloaded';
    now: number;
    onopen: (address: string) => void;
  } = $props();

  const shown = $derived(province ? missions.filter((m) => m.placement.jurisdiction === province) : missions);
</script>

<div data-screen="missions" data-province={province ?? ''}>
  <Panel label="Missions" post={province ? placeName(province) : 'Everywhere'}>
    {#if shown.length > 0}
      <ul class="nc-missions">
        {#each shown as m (m.address)}
          <li>
            <button type="button" data-mission={m.d} onclick={() => onopen(m.address)}>
              <span class="nc-missions-title">{m.title}</span>
              <span class="nc-missions-meta">
                {placeName(m.placement.jurisdiction)} ·
                <span class:nc-soon={endsSoon(m.validUntil, now)}>ends in {endsIn(m.validUntil, now)}</span>
                {#if m.publisher.agent} · <span data-agent>posted by an agent</span>{/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <!-- Silence is a readout [panel.md rule 6]: why it is empty, never a blank. -->
      <Slot k="Open">
        {#if status === 'connecting'}
          <Readout value="Reaching The Record" tone="cold" />
        {:else if status === 'unavailable' || status === 'unloaded'}
          <Readout value="Unavailable" tone="warn" sub="no relay answered" />
        {:else}
          <Readout value="None" tone="cold" sub={province ? `nothing open in ${placeName(province)}` : 'nothing open anywhere'} />
        {/if}
      </Slot>
    {/if}
  </Panel>
</div>

<style>
  .nc-missions {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .nc-missions button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.2rem;
    width: 100%;
    min-height: 3rem;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--t-line);
    background: var(--t-sunk);
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .nc-missions button:hover {
    border-color: var(--t-line-strong);
  }
  .nc-missions-title {
    font-weight: 600;
    color: var(--t-ink);
  }
  .nc-missions-meta {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--t-faint);
  }
  /* Under a day left: amber, never the alarm colour [panel.md rule 7]. */
  .nc-soon {
    color: var(--t-oncall);
  }
</style>
