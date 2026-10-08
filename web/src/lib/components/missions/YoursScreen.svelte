<script lang="ts">
  /**
   * Your own situation, as far as missions go [docs/design/com.md §2]: what you hold, what is
   * waiting to be reported, and what you sent and where it stands.
   *
   * Silence is a readout [panel.md rule 6]: an empty section says so, and never nags. What was
   * sent is a list, never a count of it [C20].
   *
   * **Every mission this device took part in stays reachable while the device keeps it**, so what
   * others reported on it can be witnessed or challenged after it leaves the map. Reports arrive
   * the day after the work, so every report on a mission's last day arrives after it ended — and
   * with no way back to them, each settled "unchallenged" though nobody here could have spoken
   * [audit 11.S].
   */
  import { onMount } from 'svelte';
  import { Panel, Readout, Slot } from '$lib/components/panel';
  import { held, tookPart } from '$lib/missions/claims';
  import { sent, settlements, stillToReport, withdraw, type Sent, type Withdrawal } from '$lib/missions/reports';
  import { endsIn, placeName, standingOf } from './format';

  let {
    now,
    open,
    unread,
    onopen,
    onreport,
    onreports
  }: {
    now: number;
    /**
     * The missions still open: a claim on one that closed early holds no place in the cap.
     * Absent while nobody knows which are open — reaching, no relay, no missions code — and then a
     * claim's mission is unknown, never "over" [invariant 7].
     */
    open?: ReadonlySet<string>;
    /** Packages NavCom could not read: a claim on one says so rather than that it is over [11.E]. */
    unread?: ReadonlySet<string>;
    onopen: (address: string) => void;
    onreport: (address: string) => void;
    /** Other operators' reports on a mission this device took part in. */
    onreports: (address: string) => void;
  } = $props();

  /** Bumped after a withdrawal, so the list is read again. */
  let version = $state(0);
  /** A withdrawal that did not happen, and why: said where it was asked for. */
  let refused = $state<{ id: string; why: Withdrawal } | null>(null);
  const t = $derived(Math.floor(now / 1000));
  const holding = $derived(held(t));
  const counted = $derived(holding.filter((h) => !open || open.has(h.address)).length);
  /** Every mission this device keeps a record of taking part in. */
  const went = $derived(tookPart(t));
  /** Only missions with a day a report could tell of, now or from tomorrow [11.X]. */
  const history = $derived(went.map((h) => ({ ...h, when: stillToReport(t, h) })).filter((h) => h.when !== null));
  /**
   * Posters this device knows to be agents, from the missions it took part in: a settlement or a
   * challenge by one says so wherever it is shown [invariant 4]. The registry is read in `nameOf`.
   */
  const agents = $derived(new Set(went.filter((h) => h.mission.publisher.agent).map((h) => h.mission.publisher.pubkey)));
  const reports = $derived.by(() => {
    void version;
    return sent().slice().reverse();
  });
  let standing = $state<Awaited<ReturnType<typeof settlements>> | null>(null);

  onMount(() => {
    void settlements(Math.floor(Date.now() / 1000))
      .then((m) => (standing = m))
      .catch(() => (standing = { standing: new Map(), names: new Map(), answered: { poster: false, operators: false }, partial: new Set() }));
  });

  function shown(r: Sent): { value: string; tone: 'neutral' | 'good' | 'cold' | 'warn'; sub: string } {
    if (r.withdrawn) {
      return {
        value: 'Withdrawn',
        tone: 'cold',
        sub: 'relays were asked to drop it; the request is public, and copies already taken stay, as does anything said about it'
      };
    }
    const s = standing?.standing.get(r.id);
    if (!s) {
      // More labels on its mission than this reads: every relay answered, and signal changes nothing [review].
      if (standing?.partial.has(r.id)) {
        return { value: 'Unknown', tone: 'cold', sub: 'its mission has more labels than this phone reads, and the one that decides it may be among those left out' };
      }
      // Nobody answered is not nothing there: no "waiting", no "settled", until somebody does [11.E].
      return standing
        ? { value: 'Unknown', tone: 'cold', sub: 'the relays that hold its labels did not answer; try again with signal' }
        : { value: 'Checking', tone: 'cold', sub: 'reading the relays that hold its labels' };
    }
    return standingOf(s, standing!.names, agents);
  }

  const WHY: Record<Withdrawal, string> = {
    asked: '',
    unheard: 'no relay took the request; try again with signal',
    card: 'it was signed by a card this device no longer holds, so only that card could ask',
    'not-open': 'only a report sent to everyone can be withdrawn'
  };

  async function takeBack(r: Sent) {
    const why = await withdraw(r.id, Math.floor(Date.now() / 1000));
    refused = why === 'asked' ? null : { id: r.id, why };
    version += 1;
  }
</script>

<div class="nc-yours" data-screen="yours">
  <Panel label="Taking part" post={counted > 0 ? `${counted} of 3` : null}>
    {#if holding.length === 0}
      <Slot k="Claims"><Readout value="Nothing claimed" tone="cold" /></Slot>
    {:else}
      <ul>
        {#each holding as h (h.address)}
          <li>
            <button type="button" data-held={h.address} onclick={() => onopen(h.address)}>
              <span class="nc-yours-title">{h.title}</span>
              <span class="nc-yours-meta">
                {#if open && !open.has(h.address)}{unread?.has(h.address) ? 'the mission could not be read' : 'the mission is over'} · this lapses by itself{:else}ends in {endsIn(h.ends, now)} · {h.visibility === 'open' ? 'everyone can see' : 'sealed to the poster'}{/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </Panel>

  <Panel label="To report">
    {#if history.length === 0 && went.length > 0}
      <!-- Taken part in, and nothing left to tell: said, not "none yet" [audit 11.S]. -->
      <Slot k="Missions"><Readout value="Nothing to report" tone="cold" sub="a report tells of the week before today, while the mission ran" /></Slot>
    {:else if history.length === 0}
      <Slot k="Missions"><Readout value="None yet" tone="cold" sub="a mission you take part in waits here, for a week after the work" /></Slot>
    {:else}
      <ul>
        {#each history as h (h.mission.address)}
          <li>
            <button type="button" data-report-mission={h.mission.d} onclick={() => onreport(h.mission.address)}>
              <span class="nc-yours-title">{h.mission.title}</span>
              <span class="nc-yours-meta">{placeName(h.mission.placement.jurisdiction)} · {h.when === 'now' ? 'report the work' : 'reports open tomorrow'}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </Panel>

  <Panel label="Reported">
    {#if reports.length === 0}
      <Slot k="Sent"><Readout value="Nothing yet" tone="cold" /></Slot>
    {:else}
      <ul>
        {#each reports as r (r.id)}
          {@const s = shown(r)}
          <li class="nc-yours-sent" data-sent={r.id}>
            <span class="nc-yours-title">{r.title}</span>
            <span class="nc-yours-meta">{r.date} · {r.visibility === 'open' ? 'everyone can see' : 'sealed to the poster'}</span>
            <Readout value={s.value} tone={s.tone} sub={s.sub} />
            {#if refused?.id === r.id}
              <Readout value="Not withdrawn" tone="warn" sub={WHY[refused.why]} />
            {/if}
            {#if r.visibility === 'open' && !r.withdrawn}
              <button type="button" class="nc-yours-withdraw" data-withdraw={r.id} onclick={() => takeBack(r)}>
                Withdraw · a request anyone can see; copies already taken stay
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </Panel>

  <Panel label="Others' reports">
    {#if went.length === 0}
      <Slot k="Missions"><Readout value="None yet" tone="cold" sub="a mission you take part in is listed here until 30 days after it ends" /></Slot>
    {:else}
      <ul>
        {#each went as h (h.mission.address)}
          <li>
            <!-- A tap, not a read on open: asking relays for a mission's reports is a choice [ReportsScreen]. -->
            <button type="button" data-their-reports={h.mission.d} onclick={() => onreports(h.mission.address)}>
              <span class="nc-yours-title">{h.mission.title}</span>
              <!-- What it holds, not what can be done: nothing NavCom files can be witnessed or challenged two weeks after the end [review]. -->
              <span class="nc-yours-meta">{placeName(h.mission.placement.jurisdiction)} · reports on it</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </Panel>
</div>

<style>
  .nc-yours {
    display: grid;
    gap: 1rem;
  }
  ul {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li > button,
  .nc-yours-sent {
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
    box-sizing: border-box;
  }
  li > button {
    cursor: pointer;
  }
  .nc-yours-title {
    font-weight: 600;
    color: var(--t-ink);
  }
  .nc-yours-meta,
  .nc-yours-withdraw {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--t-faint);
  }
  .nc-yours-withdraw {
    min-height: 3rem;
    padding: 0 0.6rem;
    margin-block-start: 0.25rem;
    border: 1px solid var(--t-line);
    background: transparent;
    cursor: pointer;
  }
</style>
