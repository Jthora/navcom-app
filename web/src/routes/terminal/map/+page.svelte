<script lang="ts">
  /**
   * The live map: blips for the people out, and where somebody is going (the owner's map decisions,
   * 2026-11-03).
   *
   * On the phone or laptop holding the watch, everybody on its board who shares where they are; on an
   * operator's phone, themselves, the peers they paired with who share, and their destination. Nobody
   * else, ever, and never anybody being served [invariant 1]. Drawn by this app as a radar, which needs
   * no tiles and no network; turn-by-turn is the phone's own map app, handed a pin [map.md §2].
   */
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { Panel, Slot, Readout } from '$lib/components/panel';
  import Radar from '$lib/components/map/Radar.svelte';
  import { freshness, operatorBlips, watchBlips, type Blip, type Destination } from '$lib/map/blips';
  import { bearing, compassPoint, metresApart, middle, type LatLon } from '$lib/map/geometry';
  import { directionsTo } from '$lib/map/directions';
  import { compass } from '$lib/map/compass.svelte';
  import { placeById } from '$lib/map/places';
  import { board } from '$lib/terminal/board.svelte';
  import { watchKey } from '$lib/terminal/watch-key';
  import { presence, type PeerPresence } from '$lib/terminal/presence.svelte';
  import { position } from '$lib/terminal/position.svelte';
  import { operator } from '$lib/terminal/session.svelte';
  import { distance } from '$lib/terminal/lookup';
  import { ago } from '$lib/terminal/heard-copy';

  let watching = $state(false);
  let ready = $state(false);
  let nowS = $state(Math.floor(Date.now() / 1000));
  let destination = $state<Destination | null>(null);
  let selected = $state<string | null>(null);
  let following = $state<string | null>(null);
  let compassOn = $state(false);

  onMount(() => {
    // Reloaded on this screen mid-patrol, the phone follows where it is again [session `resume`].
    operator.resume();
    watching = watchKey() !== null;
    if (watching) board.start();
    else presence.start();
    const id = page.url.searchParams.get('place');
    if (id) {
      void placeById(id).then((d) => {
        destination = d;
        if (d) selected = d.id;
      });
    }
    ready = true;
    const ticking = setInterval(() => (nowS = Math.floor(Date.now() / 1000)), 5_000);
    return () => {
      clearInterval(ticking);
      if (!watching) presence.stop();
      compass.stop();
    };
  });

  const blips = $derived<Blip[]>(
    !ready
      ? []
      : watching
        ? watchBlips(board.entriesAt(nowS), [...board.distress, ...board.waiting])
        : operatorBlips(position.current, nowS, presence.out, (p) => presence.stateOf(p as PeerPresence, nowS), destination)
  );
  const me = $derived(blips.find((b) => b.kind === 'self') ?? null);
  const followed = $derived(following ? (blips.find((b) => b.id === following) ?? null) : null);
  const centre = $derived<LatLon | null>(followed ?? me ?? middle(blips));
  const chosen = $derived(selected ? (blips.find((b) => b.id === selected) ?? null) : null);
  /** Nearest the middle first: on a phone, whoever is closest to you. */
  const listed = $derived(centre ? [...blips].sort((a, b) => metresApart(centre!, a) - metresApart(centre!, b)) : blips);
  const way = $derived(me && chosen && chosen.id !== me.id ? bearing(me, chosen) : null);

  async function useCompass() {
    compassOn = await compass.start();
  }
  const ageOf = (b: Blip) => (b.at === null ? null : `${ago(Math.max(0, nowS - b.at))} ago`);
  const stateWord = (b: Blip) => (b.asking === 'distress' ? 'Distress' : b.state === 'overdue' ? 'past their time' : b.asking === 'assist' ? 'Assist' : null);
</script>

<svelte:head>
  <title>Map · Field Terminal</title>
</svelte:head>

<header>
  <p class="eyebrow"><a href={watching ? '/terminal/watch/' : '/terminal/'}>← {watching ? 'Watch' : 'Status'}</a></p>
  <h1>Map</h1>
</header>

<section data-live-map data-mode={watching ? 'watch' : 'operator'}>
  {#if !ready}
    <Slot k="Map"><Readout value="Loading" tone="cold" /></Slot>
  {:else if blips.length === 0 || !centre}
    <Slot k="Map">
      <span data-map-empty>
        <Readout value="Nobody to show" tone="cold" sub={watching ? 'nobody on the board shares where they are' : 'nobody you paired with shares where they are'} />
      </span>
    </Slot>
  {:else}
    <Radar {blips} {centre} {selected} heading={compassOn ? compass.heading : null} now={nowS} onselect={(id) => (selected = id)} />

    {#if chosen}
      <Panel label={chosen.label}>
        {#if chosen.team}<Slot k="Team"><Readout value={chosen.team} verbatim tone="neutral" /></Slot>{/if}
        {#if stateWord(chosen)}<Slot k="Now"><Readout value={stateWord(chosen)!} tone={chosen.asking === 'distress' ? 'alarm' : 'warn'} /></Slot>{/if}
        {#if me && way !== null}
          <Slot k="Distance"><span data-go-distance><Readout value={distance(metresApart(me, chosen))} tone="neutral" sub={compassPoint(way)} /></span></Slot>
          <Slot k="Way">
            <span class="arrow" data-go-arrow style="transform: rotate({way - (compassOn && compass.heading !== null ? compass.heading : 0)}deg)">↑</span>
            {#if compass.supported && !compassOn}<button onclick={useCompass} data-use-compass>Use compass</button>{/if}
          </Slot>
        {/if}
        <Slot k="Heard">
          <Readout
            value={ageOf(chosen) ?? 'a place on record'}
            tone={freshness(chosen, nowS) === 'stale' ? 'warn' : 'neutral'}
            sub={chosen.precision_m > 0 ? `within ${distance(chosen.precision_m)}` : null}
          />
        </Slot>
      </Panel>
      <div class="acts">
        <button data-follow onclick={() => (following = following === chosen.id ? null : chosen.id)} aria-pressed={following === chosen.id}>
          {following === chosen.id ? 'Stop following' : 'Follow'}
        </button>
        {#if chosen.kind !== 'self'}
          <!-- Turn-by-turn is the phone's own map app: tapped, never automatic, and never with a referrer. -->
          {#each directionsTo(chosen, chosen.kind === 'place' ? chosen.label : null) as h (h.label)}
            <a href={h.href} target="_blank" rel="noreferrer" data-directions={h.label}>{h.label}</a>
          {/each}
        {/if}
      </div>
    {/if}

    <ul class="blips" data-blip-list>
      {#each listed as b (b.id)}
        <li data-listed={b.id} data-state={b.asking ?? b.state ?? b.kind}>
          <button onclick={() => (selected = b.id)} aria-pressed={selected === b.id}>{b.label}</button>
          {#if b.team}<span class="team">{b.team}</span>{/if}
          {#if me && b.id !== me.id}<span class="far">{distance(metresApart(me, b))}</span>{/if}
          {#if ageOf(b)}<span class="age">{ageOf(b)}</span>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  section { display: grid; gap: 0.9rem; }
  .acts { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .acts a { font-size: 0.85rem; }
  .arrow { display: inline-block; font-size: 1.6rem; line-height: 1; transition: transform 0.25s; }
  .blips { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.3rem; }
  .blips li { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; font-family: var(--font-mono); font-size: 0.72rem; color: var(--t-muted); }
  .blips li button { min-height: 2.4rem; font-size: 0.85rem; padding: 0 0.8rem; }
  .blips li[data-state='distress'] button { border-color: var(--t-alarm); color: var(--t-alarm); }
  .blips li[data-state='overdue'] button { border-color: var(--t-oncall); }
</style>
