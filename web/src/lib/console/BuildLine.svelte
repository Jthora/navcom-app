<script lang="ts">
  /**
   * The landing page's Build line: what is deployed, and whether this page is it.
   *
   * The health file is fetched past the service worker, so it names what is deployed. A page the
   * worker served from an older build read that commit as its own, and the line said it was the commit
   * "behind what you are using right now" of code the page was not running: the owner's own browser
   * sat on a weeks-old build for days with the line naming the newest (2026-11-01). The page's own
   * commit is baked into its bundle [$lib/built], so where the two differ this says both, and offers
   * the way to the newest [$lib/terminal/take-over].
   *
   * Loaded as the page mounts, beside the map [budget.mjs ROOT_MOUNT]: the line read *Checking…* until
   * the health file arrived anyway, and first paint had no room left for it.
   */
  import { onMount } from 'svelte';
  import { Readout } from '$lib/components/panel';
  import { BUILT_COMMIT } from '$lib/built';
  import { loadNewest } from '$lib/terminal/take-over';

  interface Health {
    commit: string | null;
    clean: boolean | null;
    built_on: 'ci' | 'local';
    suites: { ran: string; counts: { passed: number; total: number } | null };
  }
  let health = $state<Health | null>(null);
  let tried = $state(false);
  let newest = $state<'idle' | 'fetching' | 'failed'>('idle');

  onMount(() => {
    /*
     * Bounded, because a fetch that *hangs* is the case this readout is worst at: on a captive portal
     * or a dead cell, the first-visit case, *Checking…* would read as a fact still arriving forever.
     */
    const timeout = new AbortController();
    const gaveUp = setTimeout(() => timeout.abort(), 8_000);
    void fetch('/.well-known/navcom-health.json', { signal: timeout.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (health = j))
      .catch(() => {})
      .finally(() => {
        tried = true;
        clearTimeout(gaveUp);
      });
    return () => clearTimeout(gaveUp);
  });

  /** The deployed commit, where this page is running another. */
  const deployed = $derived(health?.commit && BUILT_COMMIT && !health.commit.startsWith(BUILT_COMMIT) ? health.commit.slice(0, 7) : null);

  const sub = $derived.by(() => {
    if (!health) return null;
    const parts: string[] = [];
    if (health.clean === true) parts.push('clean tree');
    else if (health.clean === false) parts.push('uncommitted changes');
    if (health.suites?.counts) parts.push(`${health.suites.counts.passed}/${health.suites.counts.total} tests`);
    if (health.suites?.ran) parts.push(health.suites.ran);
    return parts.length ? parts.join(' · ') : null;
  });

  async function toNewest() {
    newest = 'fetching';
    newest = await loadNewest();
  }
</script>

{#if deployed}
  <span data-build-older>
    <Readout
      value={BUILT_COMMIT ?? 'unknown'}
      verbatim
      tone="warn"
      sub={newest === 'failed' ? 'kept by this browser: close every NavCom tab, then reopen' : `this page · ${deployed} is deployed`}
    />
  </span>
  <div class="nc-rail">
    <button type="button" data-load-newest disabled={newest === 'fetching'} onclick={toNewest}>
      {newest === 'fetching' ? 'Fetching the newest…' : 'Load the newest'}
    </button>
  </div>
{:else if health}
  <Readout value={health.commit ? health.commit.slice(0, 7) : 'unknown'} verbatim tone={health.clean === false ? 'warn' : 'neutral'} {sub} />
{:else if tried}
  <Readout value="Unreachable" tone="cold" sub="no build receipt found" />
{:else}
  <Readout value="Checking…" tone="cold" />
{/if}
