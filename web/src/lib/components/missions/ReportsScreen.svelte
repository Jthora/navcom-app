<script lang="ts">
  /**
   * Other operators' reports on a mission, and the two things anybody may say about one
   * [docs/spec/mission-interchange.spec.md §5.3; economy.md §7–§8].
   *
   * Opened on purpose from a mission's page rather than read when the page opens: asking public
   * relays for a mission's reports tells them which mission this device is looking at, and that is
   * a choice to make, not a side effect of looking at a map.
   *
   * **Each is shown in the poster's words.** The objectives are the poster's; a count answers the
   * poster's own line; anything else was dropped on the way in [core: againstMission].
   *
   * **Both statements are signed, open and textless.** A witness settles the report now; a
   * challenge reverses nothing and stands beside it by name. Nothing here adjudicates, so there is
   * nothing to write — and a box is where a description of a person gets in.
   */
  import { onMount } from 'svelte';
  import { CHALLENGE_WINDOW_SECONDS, settlementOf, type Mission } from '@navcom/core';
  import { Panel, Readout, Slot } from '$lib/components/panel';
  import { cardSent, contactPubkey, myCard } from '$lib/terminal/card';
  import { get } from '$lib/terminal/storage';
  import { MAY_HAVE_ARRIVED, signedOn, tookPart } from '$lib/missions/claims';
  import { isMine, labelReport, reportsOn, type MissionReports, type OnMission } from '$lib/missions/reports';
  import { placeName, standingOf } from './format';

  let { address, missions, now }: { address: string; missions: Mission[]; now: number } = $props();

  const t = $derived(Math.floor(now / 1000));
  /** Open on the map, or remembered because this device took part after it left the map. */
  const m = $derived(
    missions.find((x) => x.address === address) ?? tookPart(t).find((x) => x.mission.address === address)?.mission ?? null
  );
  const there = $derived(tookPart(t).some((x) => x.mission.address === address));
  /** Null until this device first signs something with its card's key; the first label makes one. */
  let me = $state(contactPubkey());
  const operator = signedOn();

  /** Raw, not proxied: signed events are read, never changed, and a deep proxy only costs time [11.R]. */
  let read = $state.raw<MissionReports | null>(null);
  let confirming = $state<{ id: string; kind: 'witnessed' | 'challenged' } | null>(null);

  /**
   * The name others read this device's labels under — and only that, said as it is on every
   * screen. A reader names a labeller from a published card, everywhere; from a report the same key
   * filed on this mission, on this mission's reports and nowhere else — Your missions, where a
   * reporter sees who settled or challenged her, reads cards alone; and from nothing else. A card
   * with no record of reaching a relay may name it or not, and that is said, not guessed
   * [invariant 7; audit 11.S, and its review].
   */
  type Naming = { name: string; from: 'card' | 'report' | 'unsure' } | null;
  const naming = (r: MissionReports | null): Naming => {
    const callsign = get<string>('accruing', 'callsign') ?? null;
    const sent = cardSent();
    if (myCard() && callsign && (sent === 'all' || sent === 'some')) return { name: callsign, from: 'card' };
    const filed = r?.reports.find((x) => x.author === me)?.report.callsign;
    if (filed) return { name: filed, from: 'report' };
    if (myCard() && callsign && sent === null) return { name: callsign, from: 'unsure' };
    return null;
  };
  const names = $derived.by(() => {
    const all = new Map(read?.names ?? []);
    if (me) {
      // On this screen a reader names the key from a card or a report here; an unsure card reads as its key.
      const n = naming(read);
      if (n && n.from !== 'unsure') all.set(me, n.name);
      else all.delete(me);
    }
    return all;
  });
  /** A poster whose package says it is an agent is marked as one beside every settlement [invariant 4]. */
  const agents = $derived(m?.publisher.agent ? new Set([m.publisher.pubkey]) : undefined);
  /** What a statement is signed as, said before it is sent: a name only where readers will see one. */
  const signedAs = $derived.by(() => {
    const n = naming(read);
    const key = me ? `the key ${me.slice(0, 8)}` : 'a new key';
    if (n?.from === 'card') return `Signed for anyone to see, as ${n.name}.`;
    if (n?.from === 'report') return `Signed for anyone to see: as ${n.name} on this mission's reports, from your report here, and elsewhere under ${key}, since no card of yours is known to be published.`;
    if (n?.from === 'unsure') return `Signed for anyone to see, under ${key} — and as ${n.name} if your card reached a relay, which this phone has no record of.`;
    return `Signed for anyone to see, under ${key} with no name: no card of yours is published.`;
  });
  let sending = $state(false);
  let error = $state<{ id: string; text: string; unconfirmed?: boolean } | null>(null);

  onMount(() => {
    if (!m) return;
    void reportsOn(m, Math.floor(Date.now() / 1000)).then((r) => (read = r));
  });

  const said = (r: OnMission, kind: string) =>
    !!read?.labels.some(
      (l) => l.pubkey === me && l.tags.some((x) => x[0] === 'e' && x[1] === r.id) && l.tags.some((x) => x[0] === 'l' && x[1] === kind)
    );
  const askText = (id: string) => m?.objectives.find((o) => o.id === id)?.ask ?? id;
  /** Why a statement was not sent, in words [11.E]. */
  const WHY = {
    'signed-out': 'sign on first',
    own: 'not about your own report',
    'not-there': 'only somebody who took part can say they were there',
    late: 'its seven days are over, and a late challenge counts for nothing',
    // A second statement from one card counts once, so sending it again is safe [core: settlementOf].
    unconfirmed: `${MAY_HAVE_ARRIVED} Sent again, it still counts once.`
  } as const;

  async function say(r: OnMission, kind: 'witnessed' | 'challenged') {
    if (!m || !read) return;
    sending = true;
    error = null;
    const done = await labelReport(kind, r, m, Math.floor(Date.now() / 1000));
    sending = false;
    confirming = null;
    if (done.ok) {
      // The first thing this device signed may have made its key, so who "me" is is read again.
      me = done.label.pubkey;
      read = { ...read, labels: [...read.labels, done.label] };
    }
    else error = { id: r.id, text: done.because === 'not-sent' ? done.detail : WHY[done.because], unconfirmed: done.because === 'unconfirmed' };
  }
</script>

{#if !m}
  <Panel label="Reports" post="Gone">
    <Slot k="Mission"><Readout value="Not on this device" tone="cold" sub="it ended, and this device did not take part" /></Slot>
  </Panel>
{:else}
<div data-screen="reports" data-mission={m.d}>
  <Panel label="Reports" post={placeName(m.placement.jurisdiction)}>
    <h3 class="nc-reports-title">{m.title}</h3>
    {#if !read}
      <Slot k="Reports"><Readout value="Reading" tone="cold" /></Slot>
    {:else if read.reports.length === 0 && !read.answered.operators}
      <!-- Nobody answering is not nothing there [11.E]. Reports go only to operators' relays, so The Record answering alone is nobody [audit 11, second grid]. -->
      <Slot k="Reports"><Readout value="Unknown" tone="cold" sub="the relays reports go to did not answer; try again with signal" /></Slot>
    {:else if read.reports.length === 0}
      <Slot k="Reports"><Readout value="None found" tone="cold" sub="on the relays that answered; reports open the day after the work" /></Slot>
    {:else}
      {#if read.partial}
        <Slot k="Shown"><Readout value="Not all" tone="warn" sub="a relay sent as many as it was asked for; some may not be shown" /></Slot>
      {/if}
      <ul class="nc-reports">
        {#each read.reports as r (r.id)}
          {@const known = read.answered.poster && read.answered.operators}
          {@const s = settlementOf(r, m.publisher.pubkey, read.labels, t)}
          {@const shown = known ? standingOf(s, names, agents) : { value: 'Unknown', tone: 'cold' as const, sub: 'the relays that hold its labels did not answer' }}
          <!-- Filed from here under a card withdrawn since is still hers: never a witness of her own work [audit 11, second grid]. -->
          {@const mine = isMine(r)}
          <li data-report={r.id}>
            <span class="nc-reports-who">{r.report.callsign}</span>
            <span class="nc-reports-meta">{r.report.date}{mine ? ' · yours' : ''}</span>
            <ul class="nc-reports-did">
              <!-- By position, not by content: anything a stranger signed must not be able to break the list [11.X]. -->
              {#each r.report.mission?.asks ?? [] as a, i (i)}<li>{askText(a)}</li>{/each}
              {#each r.report.mission?.counts ?? [] as c, i (i)}<li>{c.line}: {c.n}</li>{/each}
            </ul>
            <Readout value={shown.value} tone={shown.tone} sub={shown.sub} />
            {#if operator && !mine}
              {#if confirming?.id === r.id}
                <div class="nc-reports-confirm" role="group" aria-label={confirming.kind === 'witnessed' ? 'Witness this report' : 'Challenge this report'}>
                  <span class="nc-reports-line" data-signed-as>
                    {signedAs}
                    {confirming.kind === 'witnessed' ? 'It settles this report now.' : 'It reverses nothing; it stands beside the report.'}
                  </span>
                  <div class="nc-reports-row">
                    <button type="button" data-confirm={confirming.kind} disabled={sending} onclick={() => say(r, confirming!.kind)}>
                      {confirming.kind === 'witnessed' ? 'Witness, under my card' : 'Challenge, under my card'}
                    </button>
                    <button type="button" disabled={sending} onclick={() => (confirming = null)}>Not now</button>
                  </div>
                </div>
              {:else}
                <div class="nc-reports-row">
                  {#if known && there && s.state === 'pending' && !said(r, 'witnessed')}
                    <button type="button" data-witness={r.id} onclick={() => (confirming = { id: r.id, kind: 'witnessed' })}>I was there</button>
                  {/if}
                  {#if t < r.at + CHALLENGE_WINDOW_SECONDS && !said(r, 'challenged')}
                    <button type="button" data-challenge={r.id} onclick={() => (confirming = { id: r.id, kind: 'challenged' })}>Challenge</button>
                  {/if}
                </div>
              {/if}
              {#if error?.id === r.id}<Readout value={error.unconfirmed ? 'Unconfirmed' : 'Not sent'} tone="warn" sub={error.text} />{/if}
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </Panel>
</div>
{/if}

<style>
  .nc-reports-title {
    margin: 0;
    font-size: 1.05rem;
    color: var(--t-ink);
  }
  .nc-reports {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .nc-reports > li {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--t-line);
    background: var(--t-sunk);
  }
  .nc-reports-who {
    font-weight: 600;
    color: var(--t-ink);
  }
  .nc-reports-meta,
  .nc-reports-line {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--t-faint);
  }
  .nc-reports-did {
    margin: 0;
    padding-inline-start: 1.1rem;
    color: var(--t-ink);
  }
  .nc-reports-confirm {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .nc-reports-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .nc-reports-row button {
    min-height: 3rem;
    padding: 0 0.8rem;
    border: 1px solid var(--t-line-strong);
    background: transparent;
    color: var(--t-ink);
    font: inherit;
    cursor: pointer;
  }
</style>
