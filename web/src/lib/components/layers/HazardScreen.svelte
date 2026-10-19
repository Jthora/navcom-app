<script lang="ts">
  /**
   * What a tap on Hazards' marks took [docs/design/map.md §8, Hazards]: every event in reach, nearest
   * first, up to twelve, and how many more there were; each in its source's own words, quoted and never
   * paraphrased: its title, its measure and its alert as the source wrote them, its time as given, under
   * what that source's time is (an origin, a latest point, an update) and how old that is, when this
   * phone read the list, whose list it is, and its links, only where they are https [the Spheres rule].
   *
   * **It asks nobody.** It reads what the overlay already holds [layer.svelte.ts layerData]. Opened
   * from history with Hazards off, it says so, and asks nothing until somebody turns them on again.
   *
   * A feed's alert level is its word, never a colour: every hue on these screens is a watch state.
   */
  import { Panel, Readout, Slot } from '$lib/components/panel';
  import type { Nav } from '$lib/com/screens';
  import { layerData, mapLayers } from '$lib/grid/layer.svelte';
  import { HAZARD_FEEDS, agoOf, utcOf, type HazardFeedId } from '$lib/outside';

  let { ids, of, now, nav }: { ids: string; of: number; now: number; nav: Nav } = $props();

  const held = $derived(mapLayers.loaded >= 0 ? layerData.hazards : null);
  /** Ticks with the page and with every answer, so the ages move. */
  const at = $derived(mapLayers.loaded >= 0 ? Math.max(now, Date.now()) : now);
  const wanted = $derived(ids.split(',').filter(Boolean));
  const FEED = Object.fromEntries(HAZARD_FEEDS.map((f) => [f.id, f])) as Record<HazardFeedId, (typeof HAZARD_FEEDS)[number]>;
  const feedOf = (id: string) => id.split(':')[0] as HazardFeedId;
</script>

<div data-screen="hazard" data-hazard={ids}>
  {#if !mapLayers.hazards}
    <Panel label="Hazards" post="Off">
      <Slot k="Hazards"><Readout value="Off on this page" tone="cold" sub="turn them on to read this again; nothing is asked until then" /></Slot>
      <div class="nc-rail"><button type="button" data-hazard-layers onclick={() => nav.open({ kind: 'layers' })}>Map layers</button></div>
    </Panel>
  {:else if mapLayers.hazardsCode === 'failed'}
    <strong class="unloaded" data-hazard-failed>Not loaded — it needs one visit with a connection</strong>
  {:else if !held}
    <Readout value="Asking" tone="cold" />
  {:else}
    {#if of > wanted.length}
      <!-- A crowded spot: the excess is counted, never silently dropped [MARK_CAP's rule]. -->
      <Slot k="Here"><span data-hazard-of><Readout value="{wanted.length} of {of} here" tone="cold" sub="zoom in for the rest" /></span></Slot>
    {/if}
    {#each wanted as id (id)}
      {@const m = held.marks.find((x) => x.id === id)}
      {@const feed = held.feeds[feedOf(id)]}
      {#if m}
        {@const read = held.feeds[m.feed]}
        <Panel label={m.word} post={FEED[m.feed].name} data-hazard-mark={m.id}>
          <strong class="nc-hz-title" data-hazard-title>{m.title}</strong>
          {#if m.measure && m.feed !== 'gdacs'}
            <Slot k="Magnitude"><Readout value={m.measure} verbatim tone="neutral" sub="as {FEED[m.feed].name} gives it" /></Slot>
          {/if}
          {#if m.alert}
            <Slot k="Alert"><Readout value={m.alert} verbatim tone="neutral" sub="the source’s own level, in its words" /></Slot>
          {/if}
          {#if m.measure && m.feed === 'gdacs'}
            <Slot k="Severity"><span class="nc-hz-quote" data-hazard-severity>{m.measure}</span></Slot>
          {/if}
          <Slot k={FEED[m.feed].time.slot}>
            {#if m.at !== null}
              <Readout value={agoOf(m.at, at)} tone="neutral" sub="as given: {m.time} · {FEED[m.feed].time.what}" />
            {:else}
              <Readout value="Not given" tone="cold" sub="the source gave no time that reads" />
            {/if}
          </Slot>
          {#each m.more as row (row.k)}
            <Slot k={row.k}><span class="nc-hz-quote">{row.v}</span></Slot>
          {/each}
          <Slot k="Read">
            {#if read.readAt !== null}
              <Readout
                value={agoOf(read.readAt, at)}
                tone="neutral"
                sub="by this phone at {utcOf(read.readAt)}{read.generated !== null ? `; the list says ${utcOf(read.generated)}` : ''}"
              />
            {:else}
              <Readout value="Not read" tone="cold" sub="unknown: its list did not answer" />
            {/if}
          </Slot>
          <Slot k="Source"><Readout value={FEED[m.feed].name} verbatim tone="neutral" sub={FEED[m.feed].credit} /></Slot>
          {#if m.links.length > 0}
            <ul class="nc-hz-links" data-hazard-links>
              {#each m.links as l, i (i)}
                <li>{#if l.url}<a href={l.url} rel="noreferrer noopener" target="_blank">{l.label}</a>{:else}<span data-hazard-unlinked>{l.label}</span>{/if}</li>
              {/each}
            </ul>
          {/if}
        </Panel>
      {:else}
        <Panel label="Hazard" post="Not listed now" data-hazard-gone={id}>
          {#if feed && feed.state === 'ready' && feed.missing.length === 0}
            <Slot k="Listed"><Readout value="Not in the latest list" tone="cold" sub="{FEED[feedOf(id)].name}, read {agoOf(feed.readAt ?? at, at)}" /></Slot>
          {:else if feed && feed.state === 'ready'}
            <!-- Part of its list did not answer: not in what was read is not gone from the list. -->
            <Slot k="Listed"><Readout value="Not in what was read" tone="warn" sub="{FEED[feedOf(id)].name}’s {feed.missing.map((x) => x.part).join(' and ')} not read: unknown" /></Slot>
          {:else}
            <Slot k="Listed"><Readout value="Not read" tone="warn" sub="unknown: its list did not answer" /></Slot>
          {/if}
        </Panel>
      {/if}
    {/each}
    <Slot k="Lists"><Readout value="Some events, never all" tone="cold" sub="nothing drawn is not nothing happening" /></Slot>
  {/if}
</div>

<style>
  .unloaded {
    color: var(--t-ink);
    font-size: 0.9rem;
  }
  .nc-hz-title {
    display: block;
    color: var(--t-ink);
    font-size: 1rem;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
  .nc-hz-quote {
    color: var(--t-ink);
    font-size: 0.9rem;
    overflow-wrap: anywhere;
  }
  .nc-hz-links {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .nc-hz-links a,
  .nc-hz-links span {
    display: inline-flex;
    align-items: center;
    min-height: 3rem;
    color: var(--t-ink);
    overflow-wrap: anywhere;
  }
  .nc-rail {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .nc-rail button {
    min-height: 3rem;
    padding: 0 0.8rem;
    border: 1px solid var(--t-line);
    background: var(--t-sunk);
    color: var(--t-ink);
    font: inherit;
    cursor: pointer;
  }
</style>
