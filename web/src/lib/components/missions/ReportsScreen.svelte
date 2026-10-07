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
  import { contactPubkey } from '$lib/terminal/card';
  import { get } from '$lib/terminal/storage';
  import { signedOn, tookPart } from '$lib/missions/claims';
  import { labelReport, reportsOn, type MissionReports, type OnMission } from '$lib/missions/reports';
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

  let read = $state<MissionReports | null>(null);
  let confirming = $state<{ id: string; kind: 'witnessed' | 'challenged' } | null>(null);
  let sending = $state(false);
  let error = $state<{ id: string; text: string } | null>(null);

  onMount(() => {
    if (!m) return;
    void reportsOn(m).then((r) => (read = r));
  });

  const said = (r: OnMission, kind: string) =>
    !!read?.labels.some(
      (l) => l.pubkey === me && l.tags.some((x) => x[0] === 'e' && x[1] === r.id) && l.tags.some((x) => x[0] === 'l' && x[1] === kind)
    );
  const askText = (id: string) => m?.objectives.find((o) => o.id === id)?.ask ?? id;

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
      const names = new Map(read.names);
      const callsign = get<string>('accruing', 'callsign');
      if (callsign) names.set(me, callsign);
      read = { ...read, labels: [...read.labels, done.label], names };
    }
    else error = { id: r.id, text: done.because === 'not-sent' ? done.detail : 'Not sent.' };
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
    {:else if read.reports.length === 0}
      <Slot k="Reports"><Readout value="None found" tone="cold" sub="on the relays that answered; reports open the day after the work" /></Slot>
    {:else}
      <ul class="nc-reports">
        {#each read.reports as r (r.id)}
          {@const s = settlementOf(r, m.publisher.pubkey, read.labels, t)}
          {@const shown = standingOf(s, read.names)}
          {@const mine = r.author === me}
          <li data-report={r.id}>
            <span class="nc-reports-who">{r.report.callsign}</span>
            <span class="nc-reports-meta">{r.report.date}{mine ? ' · yours' : ''}</span>
            <ul class="nc-reports-did">
              {#each r.report.mission?.asks ?? [] as a (a)}<li>{askText(a)}</li>{/each}
              {#each r.report.mission?.counts ?? [] as c (c.line)}<li>{c.line}: {c.n}</li>{/each}
            </ul>
            <Readout value={shown.value} tone={shown.tone} sub={shown.sub} />
            {#if operator && !mine}
              {#if confirming?.id === r.id}
                <div class="nc-reports-confirm" role="group" aria-label={confirming.kind === 'witnessed' ? 'Witness this report' : 'Challenge this report'}>
                  <span class="nc-reports-line">
                    {confirming.kind === 'witnessed'
                      ? 'Signed with your card, for anyone to see. It settles this report now.'
                      : 'Signed with your card, for anyone to see. It reverses nothing; it stands beside the report, by name.'}
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
                  {#if there && s.state === 'pending' && !said(r, 'witnessed')}
                    <button type="button" data-witness={r.id} onclick={() => (confirming = { id: r.id, kind: 'witnessed' })}>I was there</button>
                  {/if}
                  {#if t <= r.at + CHALLENGE_WINDOW_SECONDS && !said(r, 'challenged')}
                    <button type="button" data-challenge={r.id} onclick={() => (confirming = { id: r.id, kind: 'challenged' })}>Challenge</button>
                  {/if}
                </div>
              {/if}
              {#if error?.id === r.id}<Readout value="Not sent" tone="warn" sub={error.text} />{/if}
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
    min-height: 2.75rem;
    padding: 0 0.8rem;
    border: 1px solid var(--t-line-strong);
    background: transparent;
    color: var(--t-ink);
    font: inherit;
    cursor: pointer;
  }
</style>
