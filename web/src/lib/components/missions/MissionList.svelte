<script lang="ts">
  /**
   * The missions on the map, as a list Com can open [docs/design/com.md §1].
   *
   * The way in that does not need the map: from the missions line in the map's key, by keyboard or
   * screen reader alike. A tap on the map opens a place [PlaceScreen], which draws this list
   * narrowed to what is filed under the shape tapped.
   *
   * Every row says an agent posted it when one did [invariant 4], and when it ends, because a
   * mission is volatile and shows its age [invariant 7].
   */
  import type { Mission } from '@navcom/core';
  import type { Refusal } from '$lib/missions/collect';
  import { Panel, Readout, Slot } from '$lib/components/panel';
  import { endsIn, endsSoon, filedUnder, placeName } from './format';

  /** Where a row says it is: the city its package names, in its state, or the state alone. */
  const whereOf = (m: Mission) => {
    const city = m.placement.city;
    return city ? `${city.name}, ${placeName(city.in ?? m.placement.jurisdiction)}` : placeName(m.placement.jurisdiction);
  };

  let {
    missions,
    province,
    place = null,
    status,
    now,
    refused = [],
    onopen
  }: {
    /** Active missions, newest version of each, already in order. */
    missions: readonly Mission[];
    /** Narrowed to one province, or `null` for every mission. */
    province: string | null;
    /**
     * Or narrowed to a place tapped on the map, by the jurisdictions filed under its code [filedUnder]
     * and headed with its own name. Drawn inside the place screen, which carries the marker.
     */
    place?: { code: string; name: string } | null;
    /** Where the missions are coming from, so an empty list says why it is empty. */
    status: 'live' | 'cached' | 'connecting' | 'unavailable' | 'unloaded';
    now: number;
    /** Packages NavCom would not show, and why: said here so a quiet map is never a mystery [11.E]. */
    refused?: readonly Refusal[];
    onopen: (address: string) => void;
  } = $props();

  const shown = $derived(
    place
      ? missions.filter((m) => filedUnder(m.placement.jurisdiction, place.code))
      : province
        ? missions.filter((m) => m.placement.jurisdiction === province)
        : missions
  );
  const named = $derived(place ? place.name : province ? placeName(province) : null);
</script>

<div data-screen={place ? null : 'missions'} data-province={place ? null : (province ?? '')}>
  <Panel label="Missions" post={named ?? 'Everywhere'}>
    {#if shown.length > 0}
      <ul class="nc-missions">
        {#each shown as m (m.address)}
          <li>
            <button type="button" data-mission={m.d} onclick={() => onopen(m.address)}>
              <span class="nc-missions-title">{m.title}</span>
              <span class="nc-missions-meta">
                {whereOf(m)} ·
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
          <Readout value="None" tone="cold" sub={named ? `nothing open in ${named}` : 'nothing open anywhere'} />
        {/if}
      </Slot>
    {/if}
    {#if refused.length > 0 && !named}
      <Slot k="Not read">
        <Readout value={`${refused.length} not shown`} tone="warn" sub="a package NavCom could not read; its poster can be told why" />
      </Slot>
      <ul class="nc-refused" data-refused>
        {#each refused as r, i (i)}<li><span class="nc-missions-meta">{r.d || 'no name'}</span> {r.because}</li>{/each}
      </ul>
    {/if}
  </Panel>
</div>

<style>
  .nc-refused {
    margin: 0;
    padding-inline-start: 1.1rem;
    color: var(--t-ink);
    overflow-wrap: anywhere;
  }
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
