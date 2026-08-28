<script lang="ts">
  /**
   * The root console. Not a page about NavCom — Nav and Com, fused, working the instant you
   * land: a real search over the real directory (Nav) beside the real, derived state of the
   * network (Com) [docs/positioning.md: "NavCom fuses them into one post."].
   *
   * A search box here, where `/terminal/query/` and `/terminal/directory/` both refuse one on
   * purpose ("Query goes to the watch... someone with a console and both hands free does the
   * lookup, and that division of labour is the product"). Those screens are for an operator
   * mid-shift with both hands full; this is for someone deciding whether this is worth their
   * trust at all, with a keyboard in front of them. The two are allowed to differ on purpose.
   */
  import { onMount } from 'svelte';
  import '$lib/terminal/tokens.css';
  import '$lib/terminal/screen.css';
  import '$lib/terminal/panel.css';
  import { Panel, Slot, Readout, Why } from '$lib/components/panel';
  import { search } from '$lib/console/search';
  import { locateOnce, nearest } from '$lib/console/position-once';
  import type { ConsoleCentroid } from '$lib/console/types';

  let { data } = $props();

  let query = $state('');
  const typed = $derived(search(data.index, query));

  let nearRegion = $state<ConsoleCentroid | null>(null);
  const defaultResults = $derived(
    nearRegion ? data.index.filter((e) => e.region === nearRegion!.region).slice(0, 30) : []
  );
  const results = $derived(query.trim() ? typed : defaultResults);

  interface Health {
    commit: string | null;
    clean: boolean | null;
    built_on: 'ci' | 'local';
    suites: { ran: string; counts: { passed: number; total: number } | null };
  }
  let health = $state<Health | null>(null);
  let healthTried = $state(false);

  onMount(() => {
    void locateOnce().then((fix) => {
      if (fix) nearRegion = nearest(fix, data.centroids);
    });
    void fetch('/.well-known/navcom-health.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        health = j;
        healthTried = true;
      })
      .catch(() => {
        healthTried = true;
      });
  });

  /**
   * Computed from the visitor's own clock, not baked in at build time — this page hydrates,
   * so unlike the zero-JS site it can say "3 days ago" honestly instead of freezing a relative
   * age at whatever moment it was built [invariant 9].
   */
  function daysAgo(iso: string): string {
    const then = new Date(iso + 'T00:00:00Z').getTime();
    const days = Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
    if (days === 0) return 'today';
    if (days === 1) return '1 day ago';
    return `${days} days ago`;
  }
  const freshestLabel = $derived(data.coverage.freshest ? daysAgo(data.coverage.freshest) : null);

  const healthSub = $derived.by(() => {
    if (!health) return null;
    const parts: string[] = [];
    if (health.clean === true) parts.push('clean tree');
    else if (health.clean === false) parts.push('uncommitted changes');
    if (health.suites?.counts) {
      parts.push(`${health.suites.counts.passed}/${health.suites.counts.total} tests`);
    }
    if (health.suites?.ran) parts.push(health.suites.ran);
    return parts.length ? parts.join(' · ') : null;
  });
</script>

<svelte:head>
  <title>NavCom</title>
  <meta
    name="description"
    content="Look up who takes someone tonight, and see the real state of the network — no setup, no account."
  />
</svelte:head>

<div class="terminal">
  <!--
    Not "The Watchtower" — that term is precise elsewhere in this project (a specific node's
    keypair, docs/spec/bootstrap.spec.md) and reserving it there is the point: it names a
    daemon an operator can be pointed at, not a brand. This is the one screen every kind of
    visitor sees first, including the majority who will never touch a watch at all — the
    product's own name belongs here unqualified.
  -->
  <header>
    <h1>NavCom</h1>
  </header>

  <Panel label="Nav" post={nearRegion ? `Near ${nearRegion.name}` : null}>
    <label for="lookup" class="nc-lookup-label">Where are you, or what do you need</label>
    <input
      id="lookup"
      type="search"
      bind:value={query}
      placeholder="a shelter, a clinic, a city…"
      autocomplete="off"
    />
    {#if results.length > 0}
      <ul class="nc-results">
        {#each results as r (r.id)}
          <li>
            <a href="/terminal/directory/{r.region}/">
              <span class="nc-results-name">{r.name}</span>
              <span class="nc-results-meta">{r.type.replace(/_/g, ' ')} · {r.regionName}</span>
            </a>
          </li>
        {/each}
      </ul>
    {:else if query.trim()}
      <p class="nc-results-empty">Nothing matches yet — try a city or a type of place.</p>
    {/if}
    <Why summary="What this searches">
      <p>
        Every public record this directory holds, searched on this device with nothing sent
        anywhere. Results open onto the full record — hours, intake rules, and how recently
        anyone checked.
      </p>
    </Why>
  </Panel>

  <Panel label="Network" post={null}>
    <Slot k="Coverage">
      <Readout
        value="{data.coverage.regionsWithData} of {data.coverage.regionsTotal} areas"
        tone="neutral"
        sub="{data.coverage.records} records"
      />
    </Slot>
    <Slot k="Freshest">
      {#if freshestLabel}
        <Readout value={freshestLabel} tone="neutral" sub="most recent check, anywhere" />
      {:else}
        <Readout value="—" tone="cold" sub="nothing verified yet" />
      {/if}
    </Slot>
    <Slot k="Build">
      {#if health}
        <Readout
          value={health.commit ? health.commit.slice(0, 7) : 'unknown'}
          tone={health.clean === false ? 'warn' : 'neutral'}
          sub={healthSub}
        />
      {:else if healthTried}
        <Readout value="Unreachable" tone="cold" sub="no build receipt found" />
      {:else}
        <Readout value="Checking…" tone="cold" />
      {/if}
    </Slot>
    <Why summary="What this is">
      <p>
        Regions and records are counted from the same directory anyone can browse — nothing
        here is asserted twice. The build line is this deploy's own verify-then-ship receipt:
        the actual commit and test count behind what you are using right now, not a claim
        about it.
      </p>
    </Why>
  </Panel>

  <a class="nc-act" data-act data-tone="warn" href="/terminal/" data-sveltekit-reload>
    <span class="nc-act-label">Open the Field Terminal</span>
  </a>
</div>

<style>
  .nc-lookup-label {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--t-faint);
  }

  .nc-results {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .nc-results li a {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--t-line);
    background: var(--t-sunk);
    text-decoration: none;
  }
  .nc-results-name {
    font-weight: 600;
    color: var(--t-ink);
  }
  .nc-results-meta {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--t-faint);
  }
  .nc-results-empty {
    color: var(--t-faint);
    font-size: 0.9rem;
  }

  .nc-act {
    text-decoration: none;
  }
</style>
