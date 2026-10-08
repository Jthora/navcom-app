<script lang="ts">
  /**
   * Telling the poster what was done [docs/spec/mission-interchange.spec.md §5.2].
   *
   * Everything here is the poster's words except the numbers: the objectives are theirs to tick,
   * the counted lines are theirs to answer. There is no box to type into, because a box is where a
   * description of a person gets in [no-free-text.test.ts].
   *
   * Nothing is ticked for you: what you did is yours to say, and a form that started with every
   * objective done would invite saying more than happened. Today is not offered as a day — reports
   * open the day after the work. Who sees it is asked, as for a claim, with nothing preselected.
   */
  import { COUNT_MAX } from '@navcom/core';
  import { Action, Panel, Readout, Slot } from '$lib/components/panel';
  import { fileReport, localDay, reportableDays, type Filed } from '$lib/missions/reports';
  import { tookPart, type Visibility } from '$lib/missions/claims';
  import { placeName } from './format';

  let { address, now, ondone }: { address: string; now: number; ondone: () => void } = $props();

  /** The mission as it was when this device took part — it may have left the map since. */
  const entry = $derived(tookPart(Math.floor(now / 1000)).find((t) => t.mission.address === address) ?? null);
  const m = $derived(entry?.mission ?? null);
  /** Only days the work could have been: from taking part to the mission's end, inside the last week [11.X]. */
  const days = $derived(entry ? reportableDays(Math.floor(now / 1000), entry) : []);
  /** Named as yesterday only when it truly is: the first day offered may be earlier. */
  const yesterday = $derived(reportableDays(Math.floor(now / 1000))[0]);
  let date = $state('');
  let asks = $state<string[]>([]);
  let counts = $state<Record<string, number | null | undefined>>({});
  let phase = $state<'editing' | 'choosing' | 'sending'>('editing');
  let warned = $state<Filed | null>(null);
  let error = $state<string | null>(null);
  let chosen = $state<Visibility | null>(null);
  /** Sent, but this device could not record it: said before leaving, since it cannot be withdrawn from here [11.E]. */
  let unrecorded = $state(false);

  /** A count typed that a report cannot carry: said where it was typed, never dropped on the way out [11.X]. */
  const badCount = $derived(
    Object.values(counts).some((n) => n !== null && n !== undefined && !(Number.isInteger(n) && n >= 0 && n <= COUNT_MAX))
  );
  const ready = $derived(date !== '' && asks.length > 0 && !badCount);

  function draft() {
    const out: { line: string; n: number }[] = [];
    for (const line of m!.effect) {
      const n = counts[line];
      if (typeof n === 'number' && Number.isInteger(n) && n >= 0) out.push({ line, n });
    }
    return { date, asks, counts: out };
  }

  /** When the choices appeared: a tap this soon after belongs to the gesture that opened them [audit 11.S]. */
  let shownAt = 0;
  const SETTLE_MS = 400;

  async function send(visibility: Visibility, anyway = false) {
    // One report per tap: a second tap while the first is on its way sent the work twice [11.X].
    if (!m || phase === 'sending') return;
    if (!anyway && performance.now() - shownAt < SETTLE_MS) return;
    chosen = visibility;
    phase = 'sending';
    error = null;
    const r = await fileReport(m, draft(), visibility, Math.floor(Date.now() / 1000), { series: anyway });
    if (r.ok) {
      if (r.kept) return ondone();
      unrecorded = true;
      return;
    }
    phase = 'choosing';
    if (r.because === 'series') warned = r;
    else if (r.because === 'today') error = 'Reports open the day after the work. Pick a day that has ended.';
    else if (r.because === 'signed-out') error = 'Sign on to report.';
    else error = r.detail;
  }
</script>

{#if !m}
  <Panel label="Report" post="Gone">
    <Slot k="Mission"><Readout value="Not on this device" tone="cold" sub="missions are kept 30 days after they end" /></Slot>
  </Panel>
{:else}
<div data-screen="report" data-mission={m.d}>
  <Panel label="Report" post={placeName(m.placement.jurisdiction)}>
    <h3 class="nc-report-title">{m.title}</h3>

    <label class="nc-report-field">
      <span class="nc-report-k">The day of the work</span>
      <select bind:value={date} data-day>
        <option value="" disabled>Pick a day</option>
        {#each days as d (d)}<option value={d}>{d === yesterday ? `Yesterday, ${d}` : d}</option>{/each}
      </select>
    </label>

    <fieldset class="nc-report-field">
      <legend class="nc-report-k">What you did</legend>
      {#each m.objectives as o, i (i)}
        <label class="nc-report-check">
          <input type="checkbox" value={o.id} bind:group={asks} data-ask={o.id} />
          <span>{o.ask}</span>
        </label>
      {/each}
    </fieldset>

    {#if m.effect.length > 0}
      <fieldset class="nc-report-field">
        <legend class="nc-report-k">What it counts — numbers only, of things, never people</legend>
        {#each m.effect as line, i (i)}
          <label class="nc-report-count">
            <span>{line}</span>
            <input type="number" inputmode="numeric" min="0" step="1" bind:value={counts[line]} data-count={line} />
          </label>
        {/each}
      </fieldset>
    {/if}

    {#snippet action()}
      <div class="nc-report-act">
        {#if unrecorded}
          <Readout value="Sent" tone="warn" sub="but this device could not record it: its storage is full, so it cannot be withdrawn from here" />
          <button type="button" data-done onclick={ondone}>Done</button>
        {:else if warned && warned.ok === false && warned.because === 'series'}
          <Readout value="Another report here" tone="warn" sub="two reports close together in one place make a pattern somebody can read" />
          <div class="nc-report-row">
            <button type="button" data-anyway disabled={phase === 'sending'} onclick={() => send(chosen ?? 'open', true)}>Send anyway</button>
            <button type="button" data-notnow disabled={phase === 'sending'} onclick={ondone}>Not now</button>
          </div>
        {:else if days.length === 0 && entry && localDay(entry.since) >= localDay(Math.floor(now / 1000))}
          <!-- Taken part in today: a report tells of a day that has ended [reports.ts]. -->
          <Readout value="Opens tomorrow" tone="cold" sub="a report tells of a day that has ended" />
        {:else if days.length === 0}
          <Readout value="No day left to report" tone="cold" sub="a report tells of the week before today, while the mission ran" />
        {:else if phase === 'editing'}
          <Action label="Send report" disabled={!ready} onfire={() => ((phase = 'choosing'), (shownAt = performance.now()))} />
        {:else}
          <div class="nc-report-choices" role="group" aria-label="Who sees this report">
            <button type="button" data-visibility="open" disabled={phase === 'sending'} onclick={() => send('open')}>
              <span class="nc-report-who">Everyone</span>
              <span class="nc-report-line">a public record that this card did this work</span>
            </button>
            <button type="button" data-visibility="sealed" disabled={phase === 'sending'} onclick={() => send('sealed')}>
              <span class="nc-report-who">Only {m.publisher.name}</span>
              <span class="nc-report-line">sealed to the poster, who can still settle it</span>
            </button>
          </div>
        {/if}
        {#if badCount}<Readout value="Not a count" tone="warn" sub={`a count is a whole number from 0 to ${COUNT_MAX.toLocaleString('en-US')}`} />{/if}
        {#if error}<Readout value="Not sent" tone="warn" sub={error} />{/if}
      </div>
    {/snippet}
  </Panel>
</div>
{/if}

<style>
  .nc-report-title {
    margin: 0;
    font-size: 1.05rem;
    color: var(--t-ink);
  }
  .nc-report-field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .nc-report-k {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--t-faint);
    padding: 0;
  }
  .nc-report-field select,
  .nc-report-count input {
    min-height: 2.75rem;
    padding: 0 0.6rem;
    border: 1px solid var(--t-line-strong);
    background: var(--t-sunk);
    color: var(--t-ink);
    font: inherit;
  }
  .nc-report-check,
  .nc-report-count {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 2.75rem;
    color: var(--t-ink);
  }
  .nc-report-check input {
    width: 1.25rem;
    height: 1.25rem;
    flex: none;
  }
  .nc-report-count input {
    width: 6rem;
    flex: none;
  }
  .nc-report-act {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .nc-report-row,
  .nc-report-choices {
    display: grid;
    gap: 0.5rem;
  }
  .nc-report-row {
    grid-template-columns: 1fr 1fr;
  }
  .nc-report-act button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.2rem;
    min-height: 3rem;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--t-line-strong);
    background: var(--t-sunk);
    color: var(--t-ink);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .nc-report-who {
    font-weight: 600;
  }
  .nc-report-line {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--t-faint);
  }
</style>
