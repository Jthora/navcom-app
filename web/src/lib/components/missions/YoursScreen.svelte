<script lang="ts">
  /**
   * Your own situation, as far as missions go [docs/design/com.md §2]: what you hold, what is
   * waiting to be reported, and what you sent and where it stands.
   *
   * Silence is a readout [panel.md rule 6]: an empty section says so, and never nags. What was
   * sent is a list, never a count of it [C20].
   */
  import { onMount } from 'svelte';
  import { Panel, Readout, Slot } from '$lib/components/panel';
  import { held, tookPart } from '$lib/missions/claims';
  import { sent, settlements, withdraw, type Sent } from '$lib/missions/reports';
  import { endsIn, placeName, standingOf } from './format';

  let {
    now,
    onopen,
    onreport
  }: { now: number; onopen: (address: string) => void; onreport: (address: string) => void } = $props();

  /** Bumped after a withdrawal, so the list is read again. */
  let version = $state(0);
  /** A withdrawal no relay took: said where it was asked for, so it can be tried again. */
  let unheard = $state<string | null>(null);
  const t = $derived(Math.floor(now / 1000));
  const holding = $derived(held(t));
  const history = $derived(tookPart(t));
  const reports = $derived.by(() => {
    void version;
    return sent().slice().reverse();
  });
  let standing = $state<Awaited<ReturnType<typeof settlements>> | null>(null);

  onMount(() => {
    void settlements(Math.floor(Date.now() / 1000))
      .then((m) => (standing = m))
      .catch(() => (standing = { standing: new Map(), names: new Map() }));
  });

  function shown(r: Sent): { value: string; tone: 'neutral' | 'good' | 'cold' | 'warn'; sub: string } {
    if (r.withdrawn) return { value: 'Withdrawn', tone: 'cold', sub: 'relays were asked to drop it; copies already taken stay' };
    const s = standing?.standing.get(r.id);
    if (!s) return { value: standing ? 'Unknown' : 'Checking', tone: 'cold', sub: 'where it stands could not be read' };
    return standingOf(s, standing!.names);
  }

  async function takeBack(r: Sent) {
    const ok = await withdraw(r.id, Math.floor(Date.now() / 1000));
    unheard = ok ? null : r.id;
    version += 1;
  }
</script>

<div class="nc-yours" data-screen="yours">
  <Panel label="Taking part" post={holding.length > 0 ? `${holding.length} of 3` : null}>
    {#if holding.length === 0}
      <Slot k="Claims"><Readout value="Nothing claimed" tone="cold" /></Slot>
    {:else}
      <ul>
        {#each holding as h (h.address)}
          <li>
            <button type="button" data-held={h.address} onclick={() => onopen(h.address)}>
              <span class="nc-yours-title">{h.title}</span>
              <span class="nc-yours-meta">ends in {endsIn(h.ends, now)} · {h.visibility === 'open' ? 'everyone can see' : 'sealed to the poster'}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </Panel>

  <Panel label="To report">
    {#if history.length === 0}
      <Slot k="Missions"><Readout value="None yet" tone="cold" sub="a mission you take part in waits here" /></Slot>
    {:else}
      <ul>
        {#each history as h (h.mission.address)}
          <li>
            <button type="button" data-report-mission={h.mission.d} onclick={() => onreport(h.mission.address)}>
              <span class="nc-yours-title">{h.mission.title}</span>
              <span class="nc-yours-meta">{placeName(h.mission.placement.jurisdiction)} · report the work</span>
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
            {#if unheard === r.id}
              <Readout value="Not withdrawn" tone="warn" sub="no relay took the request; try again with signal" />
            {/if}
            {#if r.visibility === 'open' && !r.withdrawn}
              <button type="button" class="nc-yours-withdraw" data-withdraw={r.id} onclick={() => takeBack(r)}>
                Withdraw · asks relays to drop it; copies already taken stay
              </button>
            {/if}
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
    min-height: 2.75rem;
    padding: 0 0.6rem;
    margin-block-start: 0.25rem;
    border: 1px solid var(--t-line);
    background: transparent;
    cursor: pointer;
  }
</style>
