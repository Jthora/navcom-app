<script lang="ts">
  /**
   * Weather warnings for the state a mission is filed under, from the US National Weather Service,
   * asked only when somebody taps [docs/design/map.md, Weather warnings on a mission; $lib/missions/nws].
   *
   * **Before the tap it says what the tap tells weather.gov**: this phone's address, which can place it
   * roughly, often to a city, its browser, the time, that it asked from navcom.app, and which state.
   * After it, each warning the NWS issued for that state, and each emergency it relays that asks people
   * to act now (an evacuation, a civil or local area emergency, a 911 outage), in its own words: the
   * event, the headline, the area it names, who sent it and when it ends, exactly as issued, and how
   * long ago. Watches, advisories and statements are not shown, the screen says so before the tap, and
   * after it says how many there were. A failure reads *NWS not read: unknown*; none issued reads as
   * that and never as safe.
   *
   * **It informs and never gates** [invariants 8 and 9]. It sits below the mission, apart from taking
   * part, which reads nothing from it: whether somebody takes the mission stays theirs. Nothing here
   * pages, notifies, interrupts or sits near Distress, and nothing is said assertively to a screen
   * reader; a warning is a fact on a page, not an alarm.
   *
   * Outside the US no warning service is read, and it says so rather than say nothing.
   */
  import { Panel, Readout, Slot } from '$lib/components/panel';
  import { NWS, agoOf, utcOf } from '$lib/outside';
  import { areaOf, readWarnings, type WarningsRead } from '$lib/missions/nws';

  let { jurisdiction, now }: { jurisdiction: string | null; now: number } = $props();

  const area = $derived(areaOf(jurisdiction));
  /** One answer per state, for a minute: a second tap inside it asks nothing new. */
  const REUSE_MS = 60_000;
  let asking = $state(false);
  let answer = $state.raw<(WarningsRead & { area: string }) | null>(null);
  const at = $derived(Math.max(now, answer?.ok ? answer.at : 0));

  async function check() {
    if (area.kind !== 'state' || asking) return;
    const kept = recent.get(area.area);
    if (kept && kept.ok && Date.now() - kept.at < REUSE_MS) {
      answer = kept;
      return;
    }
    asking = true;
    const read = { ...(await readWarnings(area.area)), area: area.area };
    if (read.ok) recent.set(area.area, read);
    answer = read;
    asking = false;
  }
</script>

<script lang="ts" module>
  /** The last answer per state, in memory only, for the minute a second tap reuses it. Never stored. */
  const recent = new Map<string, WarningsRead & { area: string }>();
</script>

<Panel label="Weather" post="NWS" data-nws={area.kind}>
  {#if area.kind === 'state'}
    {@const shown = answer && answer.area === area.area ? answer : null}
    <button type="button" class="nc-nws-check" data-nws-check disabled={asking} onclick={check}>
      <span>{shown ? 'Check again' : `Check NWS warnings for ${area.name}`}</span>
      <span class="nc-nws-sub">asks {NWS.host}, when you tap</span>
    </button>
    <span class="nc-nws-ask" data-nws-ask>
      Asks {NWS.host} for the warnings it has issued for {area.name}, and the emergencies it relays that
      ask people to act now, such as an evacuation: it learns this phone’s internet address, which can
      place it roughly, often to a city; its browser; the time; that it asked from navcom.app; and which
      state. Watches, advisories and statements are not shown. Whether you take this mission stays yours.
    </span>
    {#if asking}
      <Slot k="NWS"><Readout value="Asking" tone="cold" /></Slot>
    {:else if shown && !shown.ok}
      <Slot k="NWS"><span data-nws-failed><Readout value="NWS not read: unknown" tone="warn" sub="the ask failed; nothing is known of warnings" /></span></Slot>
    {:else if shown && shown.ok}
      {#if shown.warnings.length === 0}
        <span class="nc-nws-none" data-nws-none>
          No warnings or emergencies issued for {area.name} as of {utcOf(shown.at)}. The NWS lists what it has
          issued; it does not say a place is safe.
        </span>
      {:else}
        <ul class="nc-nws-list" data-nws-warnings>
          {#each shown.warnings as w (w.id)}
            <li data-nws-warning={w.event}>
              <b class="nc-nws-event">{w.event}</b>
              {#if w.headline}<span class="nc-nws-headline">{w.headline}</span>{/if}
              {#if w.area}<span class="nc-nws-area" data-nws-area>{w.area}</span>{/if}
              <span class="nc-nws-meta">
                {#if w.sender}<span>from {w.sender}</span>{/if}
                {#if w.ends}<span>ends {w.ends}</span>{:else if w.expires}<span>no end issued · expires {w.expires}</span>{/if}
                {#if w.at !== null}<span>issued {agoOf(w.at, at)}</span>{/if}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
      {#if shown.others > 0}
        <!-- What the filter left out is counted, so none shown never reads as nothing out. -->
        <span class="nc-nws-none" data-nws-others>
          {shown.others === 1 ? 'One other alert' : `${shown.others} other alerts`} out for {area.name}, such as watches,
          advisories and statements, {shown.others === 1 ? 'is' : 'are'} not shown here.
        </span>
      {/if}
      <Slot k="Read"><Readout value={agoOf(shown.at, at)} tone="neutral" sub="by this phone at {utcOf(shown.at)}, from {NWS.host}" /></Slot>
    {/if}
  {:else if area.kind === 'national'}
    <span class="nc-nws-ask" data-nws-national>
      Filed for the whole United States: the NWS is asked by state, and this mission names none, so nothing
      is asked.
    </span>
  {:else if area.kind === 'elsewhere'}
    <span class="nc-nws-ask" data-nws-elsewhere>
      No warning service is read for {area.name}. NavCom reads only the US National Weather Service.
    </span>
  {:else}
    <span class="nc-nws-ask" data-nws-unknown>This mission names no state NavCom knows, so no warning service is asked.</span>
  {/if}
</Panel>

<style>
  .nc-nws-check {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.2rem;
    min-height: 3rem;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--t-line);
    background: var(--t-sunk);
    color: var(--t-ink);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .nc-nws-check:disabled {
    cursor: progress;
  }
  .nc-nws-sub {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--t-faint);
  }
  .nc-nws-ask,
  .nc-nws-none {
    display: block;
    color: var(--t-muted);
    font-size: 0.85rem;
    line-height: 1.4;
  }
  .nc-nws-list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .nc-nws-list li {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--t-line);
    background: var(--t-sunk);
  }
  .nc-nws-event {
    color: var(--t-ink);
  }
  .nc-nws-headline {
    color: var(--t-ink);
    font-size: 0.9rem;
    overflow-wrap: anywhere;
  }
  .nc-nws-area {
    color: var(--t-muted);
    font-size: 0.85rem;
    overflow-wrap: anywhere;
  }
  .nc-nws-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem 0.8rem;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--t-muted);
    overflow-wrap: anywhere;
  }
</style>
