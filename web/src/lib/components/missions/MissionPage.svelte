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

  let { mission: m, now }: { mission: Mission; now: number } = $props();

  const state = $derived(m.state === 'closed' ? 'Closed' : m.state === 'claimed' ? 'Taken' : 'Open');
  const paragraphs = $derived((m.summary ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean));
</script>

<div data-screen="mission" data-mission={m.d}>
  <Panel label="Mission" post={state}>
    <h3 class="nc-mission-title">{m.title}</h3>

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
    <Slot k="Taking part">
      {#if m.state === 'claimed'}
        <Readout value="Taken" tone="cold" sub="somebody has claimed it" />
      {:else if m.claims === 'many'}
        <Readout value="Open to all" sub="anyone may take part" />
      {:else}
        <Readout value="One person" sub="the first claim takes it" />
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
  </Panel>
</div>

<style>
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
