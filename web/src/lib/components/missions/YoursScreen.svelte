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
   *
   * **What no relay confirmed is said, and can be sent again as the same event** — a claim, a
   * report, or the release of a claim let go with no signal [audit 11.S, findings 61 and 66].
   */
  import { onMount } from 'svelte';
  import { Panel, Readout, Slot } from '$lib/components/panel';
  import { held, sendRelease, tookPart, unreleased, type Unreleased } from '$lib/missions/claims';
  import { reportAgain, sent, settlements, stillToReport, withdraw, type Sent, type Withdrawal } from '$lib/missions/reports';
  import { endsIn, placeName, releaseReadout, standingOf } from './format';

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

  /** Bumped after a withdrawal or a send, so the lists are read again. */
  let version = $state(0);
  /** A withdrawal that did not happen, and why: said where it was asked for. */
  let refused = $state<{ id: string; why: Withdrawal } | null>(null);
  /** A send from here that no relay took or confirmed, by what it was for: said where it was asked for. */
  let unsent = $state<{ key: string; why: 'refused' | 'unconfirmed' | 'card' } | null>(null);
  let sending = $state(false);
  const t = $derived(Math.floor(now / 1000));
  const holding = $derived.by(() => {
    void version;
    return held(t);
  });
  /** Claims let go whose release no relay confirmed: on relays until they end, so still here [finding 66]. */
  const loose = $derived.by(() => {
    void version;
    return unreleased(t);
  });
  const counted = $derived(holding.filter((h) => !open || open.has(h.address)).length);
  /** Every mission this device keeps a record of taking part in. */
  const went = $derived(tookPart(t));
  /** Only missions with a day a report could tell of and not yet reported, now or from tomorrow [11.X; finding 52]. */
  const history = $derived.by(() => {
    void version;
    return went.map((h) => ({ ...h, when: stillToReport(t, h) })).filter((h) => h.when !== null);
  });
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

  const readStanding = () =>
    settlements(Math.floor(Date.now() / 1000))
      .then((m) => (standing = m))
      .catch(() => (standing = { standing: new Map(), names: new Map(), answered: { poster: false, operators: false }, partial: new Set() }));
  onMount(() => void readStanding());

  function shown(r: Sent): { value: string; tone: 'neutral' | 'good' | 'cold' | 'warn'; sub: string } {
    if (r.withdrawn) {
      return {
        value: 'Withdrawn',
        tone: 'cold',
        sub: 'relays were asked to drop it; the request is public, and copies already taken stay, as does anything said about it'
      };
    }
    // Not read for where it stands: if it never arrived, silence would settle a report no relay holds [finding 61].
    if (r.unconfirmed) return { value: 'Unconfirmed', tone: 'warn', sub: 'no relay confirmed it; it may have arrived' };
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
    unconfirmed: 'no relay confirmed the request; it may have arrived — ask again with signal',
    card: 'it was signed by a card this device no longer holds, so only that card could ask',
    'not-open': 'only a report sent to everyone can be withdrawn'
  };

  async function takeBack(r: Sent) {
    const why = await withdraw(r.id, Math.floor(Date.now() / 1000));
    refused = why === 'asked' ? null : { id: r.id, why };
    version += 1;
  }

  /** The same report again, as it was signed: never a second report of the same work [finding 61]. */
  async function resend(r: Sent) {
    sending = true;
    try {
      const got = await reportAgain(r);
      unsent = got === 'refused' || got === 'unconfirmed' ? { key: r.id, why: got } : null;
      // There now, so where it stands can be read: until this it was not asked for.
      if (got === 'took') void readStanding();
    } finally {
      sending = false;
      version += 1;
    }
  }

  /** The release of a claim let go with no signal, as it was signed [finding 66]. */
  async function release(u: Unreleased) {
    sending = true;
    try {
      const got = await sendRelease(u.address, Math.floor(Date.now() / 1000));
      unsent = got.sent ? null : { key: u.address, why: 'card' in got ? 'card' : got.unconfirmed ? 'unconfirmed' : 'refused' };
    } finally {
      sending = false;
      version += 1;
    }
  }

  const UNSENT = {
    refused: 'no relay took it this time; try again with signal',
    unconfirmed: 'no relay confirmed it; it may have arrived',
    card: 'it was taken with a card this device no longer holds, so only that card could; it ends by itself'
  } as const;
</script>

<div class="nc-yours" data-screen="yours">
  <Panel label="Taking part" post={counted > 0 ? `${counted} of 3` : null}>
    {#if holding.length === 0 && loose.length === 0}
      <Slot k="Claims"><Readout value="Nothing claimed" tone="cold" /></Slot>
    {:else}
      <ul>
        {#each holding as h (h.address)}
          <li>
            <button type="button" data-held={h.address} onclick={() => onopen(h.address)}>
              <span class="nc-yours-title">{h.title}</span>
              <span class="nc-yours-meta">
                {#if open && !open.has(h.address)}{unread?.has(h.address) ? 'the mission could not be read' : 'the mission is over'} · this lapses by itself{:else}{h.unconfirmed ? 'unconfirmed · ' : ''}ends in {endsIn(h.ends, now)} · {h.visibility === 'open' ? 'everyone can see' : 'sealed to the poster'}{/if}
              </span>
            </button>
          </li>
        {/each}
        {#each loose as u (u.address)}
          <!-- Let go, and on relays until it ends: no place in the three, and the release still to send [finding 66]. -->
          {@const r = releaseReadout(u, now)}
          <li class="nc-yours-sent" data-unreleased={u.address}>
            <span class="nc-yours-title">{u.title}</span>
            <Readout value={r.value} tone="warn" sub={`let go · ${r.sub}`} />
            {#if unsent?.key === u.address}<Readout value={unsent.why === 'refused' ? 'Not sent' : 'Unconfirmed'} tone="warn" sub={UNSENT[unsent.why]} />{/if}
            <button type="button" class="nc-yours-withdraw" data-sendrelease={u.address} disabled={sending} onclick={() => release(u)}>Send the release</button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if unsent?.why === 'card'}<Readout value="Not sent" tone="warn" sub={UNSENT.card} />{/if}
  </Panel>

  <Panel label="To report">
    {#if history.length === 0 && went.length > 0}
      <!-- Taken part in, and nothing left to tell: said, not "none yet" [audit 11.S]. A day reported is not offered again [finding 52]. -->
      <Slot k="Missions"><Readout value="Nothing to report" tone="cold" sub="a report tells of the week before today, while the mission ran, and each day once" /></Slot>
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
              <Readout value={refused.why === 'unconfirmed' ? 'Unconfirmed' : 'Not withdrawn'} tone="warn" sub={WHY[refused.why]} />
            {/if}
            {#if unsent?.key === r.id}<Readout value={unsent.why === 'refused' ? 'Not sent' : 'Unconfirmed'} tone="warn" sub={UNSENT[unsent.why]} />{/if}
            {#if r.unconfirmed && !r.withdrawn}
              <!-- The same report, as it was signed: a second would count the same work twice [finding 61]. -->
              <button type="button" class="nc-yours-withdraw" data-sendagain={r.id} disabled={sending} onclick={() => resend(r)}>
                Send again · the same report
              </button>
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
