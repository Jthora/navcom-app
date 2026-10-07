<script lang="ts">
  /**
   * One mission, as an operator reads it before deciding to go [docs/spec/mission-interchange.spec.md §4.3].
   *
   * The publisher's words are shown as they wrote them: the ask verbatim, and **the limits
   * verbatim, above the ask, every time** — even when every objective carries the same ones. They
   * are the safety writing, and an operator who reads one objective must not miss them.
   *
   * Opens with the sheet at half, never full: a mission is about a place, and the map behind it is
   * what makes the place mean anything [com.md §7]. Nothing here can be claimed yet; that is 11.4.
   */
  import type { Mission } from '@navcom/core';
  import { Panel, Readout, Slot, Why } from '$lib/components/panel';
  import { effort, endsIn, endsSoon, placeName, stampUtc } from './format';
  import TakePart from './TakePart.svelte';

  let {
    mission: m,
    now,
    asOf = null,
    open,
    onreports
  }: {
    mission: Mission;
    now: number;
    /** The missions still open, so a claim on one closed early does not hold a place in the cap. */
    open?: ReadonlySet<string>;
    /** When the picture is this device's copy rather than live: its age, beside the ask to take part [invariants 7, 9]. */
    asOf?: Date | null;
    onreports?: () => void;
  } = $props();

  const state = $derived(m.state === 'closed' ? 'Closed' : m.state === 'claimed' ? 'Taken' : 'Open');
  const paragraphs = $derived((m.summary ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean));
</script>

<div data-screen="mission" data-mission={m.d}>
  <Panel label="Mission" post={state}>
    {#snippet action()}<TakePart mission={m} {now} {open} />{/snippet}
    <h3 class="nc-mission-title">{m.title}</h3>
    {#if asOf}
      <Slot k="Seen">
        <Readout value="This device's copy" tone="warn" sub={`as of ${stampUtc(Math.floor(asOf.getTime() / 1000))}; it may have closed since`} />
      </Slot>
    {/if}

    <Slot k="Posted by">
      <!-- Invariant 4: an agent is always shown as one, whatever its packages say. -->
      <Readout value={m.publisher.name} verbatim sub={m.publisher.agent ? 'an agent, not a person' : null} />
    </Slot>
    <Slot k="Where">
      <Readout value={placeName(m.placement.jurisdiction)} />
    </Slot>
    <Slot k="Ends">
      <Readout
        value={endsIn(m.validUntil, now)}
        tone={endsSoon(m.validUntil, now) ? 'warn' : 'neutral'}
        sub={stampUtc(m.validUntil)}
      />
    </Slot>
    <Slot k="Open to">
      {#if m.state === 'claimed'}
        <Readout value="Taken" tone="cold" sub="somebody has claimed it" />
      {:else if m.claims === 'many'}
        <Readout value="All" sub="anyone may take part" />
      {:else}
        <Readout value="One person" sub="the first claim takes it" />
      {/if}
    </Slot>
    <Slot k="Taking part">
      <!--
        As the poster counts them: only the poster sees private claims, so a count made here would
        leave those people out. Unknown until the poster says [interchange spec §5.1].
      -->
      {#if m.takingPart}
        <Readout
          value={String(m.takingPart.operators + m.takingPart.agents)}
          sub="{m.takingPart.operators} operator{m.takingPart.operators === 1 ? '' : 's'} · {m.takingPart.agents} agent{m.takingPart.agents === 1 ? '' : 's'} · {m.publisher.name}'s count"
        />
      {:else}
        <Readout value="—" tone="cold" sub="the poster has not said" />
      {/if}
    </Slot>

    {#if paragraphs.length > 0}
      <Why summary="The mission" open>
        {#each paragraphs as p, i (i)}<p>{p}</p>{/each}
      </Why>
    {/if}

    {#if m.clock.length > 0}
      <ul class="nc-mission-clock" aria-label="Clock">
        {#each m.clock as line, i (i)}<li>{line}</li>{/each}
      </ul>
    {/if}

    {#if m.checks.length > 0}
      <div class="nc-mission-checks">
        <span class="nc-mission-k">Check before you go</span>
        <ul>
          {#each m.checks as topic, i (i)}<li>{topic}</li>{/each}
        </ul>
      </div>
    {/if}

    <ol class="nc-objectives" aria-label="What to do">
      {#each m.objectives as o (o.id)}
        <li data-objective={o.id}>
          {#if o.limits.length > 0}
            <div class="nc-limits" data-limits>
              <span class="nc-mission-k">Limits</span>
              {#each o.limits as l, i (i)}<span class="nc-limit">{l}</span>{/each}
            </div>
          {/if}
          <span class="nc-ask" data-ask>{o.ask}</span>
          <span class="nc-objective-meta">
            {o.presence === 'desk' ? 'From a desk' : o.presence === 'field' ? 'In the field' : 'Anywhere'}{#if effort(o.effortMinutes)} · {effort(o.effortMinutes)}{/if}{#if o.for} · for {o.for}{/if}
          </span>
        </li>
      {/each}
    </ol>

    {#if m.effect.length > 0 || m.omittedPeopleCounts > 0}
      <div class="nc-mission-effect">
        <span class="nc-mission-k">What it counts</span>
        {#if m.effect.length > 0}
          <ul>
            {#each m.effect as line, i (i)}<li>{line}</li>{/each}
          </ul>
        {/if}
        {#if m.omittedPeopleCounts > 0}
          <!-- Shown, never silent: NavCom counts things, not people [spec §7]. -->
          <span class="nc-omitted" data-omitted>
            {m.omittedPeopleCounts === 1 ? 'One line' : `${m.omittedPeopleCounts} lines`} that counted people
            {m.omittedPeopleCounts === 1 ? 'was' : 'were'} left out
          </span>
        {/if}
      </div>
    {/if}

    {#if onreports}
      <!-- A tap, not a read on open: asking relays for a mission's reports is a choice [ReportsScreen]. -->
      <button type="button" class="nc-mission-reports" data-reports onclick={onreports}>
        <span>Reports on this mission</span>
        <span class="nc-mission-reports-sub">read from the relays operators use</span>
      </button>
    {/if}
  </Panel>
</div>

<style>
  .nc-mission-reports {
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
  .nc-mission-reports-sub {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--t-faint);
  }
  .nc-mission-title {
    margin: 0;
    font-size: 1.05rem;
    line-height: 1.3;
    color: var(--t-ink);
  }
  .nc-mission-k {
    display: block;
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--t-faint);
  }
  .nc-mission-clock,
  .nc-mission-checks ul,
  .nc-mission-effect ul {
    margin: 0;
    padding-inline-start: 1.1rem;
    color: var(--t-muted);
    font-size: 0.9rem;
  }
  .nc-mission-checks,
  .nc-mission-effect {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .nc-objectives {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .nc-objectives li {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--t-line);
    background: var(--t-sunk);
  }
  /* The limits come first and look like what they are: the line the work must not cross. */
  .nc-limits {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding-inline-start: 0.6rem;
    border-inline-start: 2px solid var(--t-oncall);
    color: var(--t-muted);
    font-size: 0.88rem;
  }
  .nc-ask {
    color: var(--t-ink);
    font-weight: 600;
  }
  .nc-objective-meta {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--t-faint);
  }
  .nc-omitted {
    color: var(--t-muted);
    font-size: 0.85rem;
  }
</style>
