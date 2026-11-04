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
  import { onMount, untrack } from 'svelte';
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
  import { areaAt, saveArea, savedAreas, STREET_AREAS, STREETS_COVER, type StreetArea } from '$lib/map/tiles';
  import { OPENFREEMAP } from '$lib/outside';
  import type { Streets } from '$lib/grid/layers/streets';

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

  /*
   * Two views of the same blips: streets, drawn by MapLibre from our own extracts, where this phone can
   * draw them and an extract covers where everybody is; the radar everywhere else, and whenever asked.
   */
  let view = $state<'streets' | 'radar'>('streets');
  let streetsEl = $state<HTMLDivElement | null>(null);
  let streets = $state<Streets | null>(null);
  /** No WebGL: this phone cannot draw streets at all. */
  let streetsFailed = $state(false);
  /**
   * The engine or the streets could not be reached, which with no signal is what happens, whatever the
   * browser says: `navigator.onLine` reads true on a jammed cell, and under the suite's own offline. The
   * radar until they can be, asked again in the background so the view does not flicker.
   */
  let unreachable = $state(false);
  /** The areas saved on this phone, by id; null until the cache has been read. */
  let saved = $state<string[] | null>(null);
  let saving = $state<string | null>(null);
  let saveFailed = $state<string | null>(null);
  /*
   * With no signal, an area not saved has no streets to draw, so the radar shows the same blips rather
   * than a blank map that looks like a broken one (the stint's UX fallbacks, 2026-11-03).
   */
  // Read as the screen starts, not once it has mounted: opened with no signal, the streets began
  // loading before the screen knew, failed, and said they could not be drawn here at all [scenarios.spec.ts].
  let online = $state(typeof navigator === 'undefined' || navigator.onLine);
  const mb = (a: StreetArea) => Math.round(a.bytes / 1_000_000);
  const webgl = () => {
    try {
      return !!document.createElement('canvas').getContext('webgl');
    } catch {
      return false;
    }
  };
  /** The area the map opens on: where everybody is, or wherever this phone is. */
  const here = $derived(centre ? areaAt(centre) : null);
  const inStreets = $derived(here !== null);
  const hereSaved = $derived(here !== null && saved !== null && saved.includes(here.id));
  /**
   * OpenFreeMap's streets, where ours stop, chosen for this visit to the map and never stored, so a
   * reload asks nobody. Its requests say where you are looking, and the screen says so first
   * [what-leaves.md; outside.ts OPENFREEMAP].
   */
  let elsewhere = $state(false);
  const drawStreets = $derived(view === 'streets' && ((inStreets && (hereSaved || online)) || elsewhere) && !streetsFailed && !unreachable);

  const hasCentre = $derived(centre !== null);
  $effect(() => {
    if (!drawStreets || !streetsEl || streets || !hasCentre) return;
    /*
     * Where to open, read once and not followed: this read the centre itself, so every position heard
     * while the engine was still loading started another map and threw the last away — nine engines
     * built on a phone for one screen as a busy board's positions came in [watch-map.spec.ts]. Where
     * the blips go after is the draw's and the follow's.
     */
    const at = untrack(() => centre)!;
    const el = streetsEl;
    let gone = false;
    void (async () => {
      if (!webgl()) {
        streetsFailed = true;
        return;
      }
      try {
        const [{ mountStreets }, blobs] = await Promise.all([import('$lib/grid/layers/streets'), savedAreas()]);
        saved = [...blobs.keys()];
        const source = areaAt(at)
          ? ({ kind: 'ours', areas: STREET_AREAS, saved: blobs } as const)
          : ({ kind: 'openfreemap', style: OPENFREEMAP.style } as const);
        const made = await mountStreets(el, { source, centre: at, onselect: (id) => (selected = id) });
        if (gone) made.destroy();
        else {
          streets = made;
          // Where the middle of everybody is now, if it moved while the engine loaded.
          const now = untrack(() => centre);
          if (now && (now.lat !== at.lat || now.lon !== at.lon)) made.centre(now);
        }
      } catch {
        unreachable = true;
      }
    })();
    return () => {
      gone = true;
    };
  });
  $effect(() => {
    if (!drawStreets && streets) {
      streets.destroy();
      streets = null;
    }
  });
  $effect(() => {
    streets?.draw(blips, (b) => freshness(b, nowS), selected, me);
  });
  $effect(() => {
    if (streets && followed) streets.centre(followed);
  });
  onMount(() => {
    void savedAreas().then((m) => (saved = [...m.keys()]));
    online = navigator.onLine;
    const on = () => {
      online = true;
      unreachable = false;
    };
    const off = () => (online = false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    // Whether the streets can be reached again, asked quietly: the view changes only once they can.
    const retry = setInterval(() => {
      if (unreachable) void import('$lib/grid/layers/streets').then((m) => m.preload()).then((ok) => ok && (unreachable = false)).catch(() => {});
    }, 30_000);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      clearInterval(retry);
      streets?.destroy();
    };
  });

  async function save(a: StreetArea) {
    saving = a.id;
    saveFailed = null;
    try {
      if (await saveArea(a)) {
        saved = [...(saved ?? []), a.id];
        // And the engine that draws them, for a night the map is first opened with no signal.
        void import('$lib/grid/layers/streets').then((m) => m.preload()).catch(() => {});
        const blob = (await savedAreas()).get(a.id);
        if (blob) streets?.saved(a, blob);
      } else saveFailed = a.id;
    } finally {
      saving = null;
    }
  }
</script>

<svelte:head>
  <title>Map · Field Terminal</title>
  <meta name="description" content="Where the people out are, and the way to them." />
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
    <div class="views" role="group" aria-label="View">
      <button aria-pressed={view === 'streets'} onclick={() => (view = 'streets')} data-view="streets">Streets</button>
      <button aria-pressed={view === 'radar'} onclick={() => (view = 'radar')} data-view="radar">Radar</button>
    </div>
    {#if drawStreets}
      <!-- MapLibre draws into the inner box, whose classes are its own: Svelte set the outer one's, and took MapLibre's away. -->
      <div class="streets" data-streets data-drawn={streets !== null}><div bind:this={streetsEl} style="position: absolute; inset: 0;"></div></div>
    {:else}
      <Radar {blips} {centre} {selected} heading={compassOn ? compass.heading : null} now={nowS} onselect={(id) => (selected = id)} />
    {/if}
    <Slot k="Streets">
      <span data-streets-state>
        {#if view === 'streets' && !inStreets && elsewhere}
          <Readout value="From OpenFreeMap" tone="warn" sub="it sees the streets you look at" />
        {:else if view === 'streets' && !inStreets}
          <Readout value="Not here" tone="cold" sub={`${STREETS_COVER} only; the radar shows the rest`} />
        {:else if view === 'streets' && streetsFailed}
          <Readout value="Cannot draw them here" tone="warn" sub="the radar shows the same" />
        {:else if here && hereSaved}
          <Readout value="Saved on this phone" tone="good" sub={`${here.name}, ${here.built}`} />
        {:else if here && (!online || unreachable)}
          <Readout value="Not saved" tone="warn" sub={`${here.name}: no signal, so the radar`} />
        {:else if here}
          <Readout value="Not saved" tone="neutral" sub={`${here.name}, read from navcom.app while there is signal`} />
        {/if}
      </span>
      {#if view === 'streets' && !inStreets && !elsewhere}
        <!-- Said before the press, as every outside ask here is: who learns what. -->
        <button onclick={() => (elsewhere = true)} data-openfreemap>Streets from OpenFreeMap</button>
        <span data-openfreemap-cost><Readout value="OpenFreeMap" tone="neutral" sub="learns this phone’s address and which streets you look at" /></span>
      {/if}
      {#if here && saved !== null && !hereSaved}
        <button onclick={() => save(here!)} disabled={saving !== null} data-save-streets>{saving === here.id ? 'Saving…' : `Save ${here.name} for tonight · ${mb(here)} MB`}</button>
      {/if}
      {#if saveFailed}<span data-save-failed><Readout value="Not saved" tone="warn" sub="try again with signal" /></span>{/if}
      {#if here && saved !== null}
        <!-- The rest of the city, for a phone that patrols two boroughs or a laptop holding the watch for all of them. -->
        <details class="areas" data-street-areas>
          <summary>Other areas</summary>
          {#each STREET_AREAS.filter((a) => a.id !== here!.id) as a (a.id)}
            <div class="area" data-area={a.id}>
              <span>{a.name} · {mb(a)} MB</span>
              {#if saved.includes(a.id)}
                <span data-area-saved>Saved</span>
              {:else}
                <button onclick={() => save(a)} disabled={saving !== null}>{saving === a.id ? 'Saving…' : 'Save'}</button>
              {/if}
            </div>
          {/each}
        </details>
      {/if}
    </Slot>

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
  /* A column that can shrink: an unbroken callsign in the list below widened the map past the screen. */
  section { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.9rem; }
  .views { display: flex; gap: 0.4rem; }
  .views button { min-height: 2.4rem; font-size: 0.85rem; padding: 0 0.8rem; border-color: var(--t-line); color: var(--t-faint); }
  .views button[aria-pressed='true'] { border-color: var(--t-ink); color: var(--t-ink); }
  .streets { position: relative; overflow: hidden; width: 100%; height: min(70vh, 36rem); min-height: 20rem; border: 1px solid var(--t-line); }
  /* MapLibre's own controls, in the terminal's colours: white boxes are the brightest thing on a dark street. */
  .streets :global(.maplibregl-ctrl-group) { background: var(--t-raised); border: 1px solid var(--t-line); box-shadow: none; }
  .streets :global(.maplibregl-ctrl-group button + button) { border-top-color: var(--t-line); }
  .streets :global(.maplibregl-ctrl-icon) { filter: invert(0.85); }
  .streets :global(.maplibregl-ctrl-attrib) { background: var(--t-ground); color: var(--t-muted); font: 0.62rem var(--font-mono); }
  .streets :global(.maplibregl-ctrl-attrib a) { color: var(--t-muted); }
  .streets :global(.maplibregl-ctrl-attrib-button) { filter: invert(0.85); background-color: transparent; }
  .acts { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .acts a { font-size: 0.85rem; }
  .arrow { display: inline-block; font-size: 1.6rem; line-height: 1; transition: transform 0.25s; }
  .blips { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.3rem; }
  .blips li > * { min-width: 0; overflow-wrap: anywhere; }
  .blips li { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; font-family: var(--font-mono); font-size: 0.72rem; color: var(--t-muted); }
  .blips li button { min-height: 2.4rem; max-width: 100%; overflow-wrap: anywhere; font-size: 0.85rem; padding: 0 0.8rem; }
  .blips li[data-state='distress'] button { border-color: var(--t-alarm); color: var(--t-alarm); }
  .blips li[data-state='overdue'] button { border-color: var(--t-oncall); }
  .areas summary { cursor: pointer; font-size: 0.85rem; color: var(--t-muted); min-height: 2.4rem; display: flex; align-items: center; }
  .area { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; font-family: var(--font-mono); font-size: 0.72rem; color: var(--t-muted); padding: 0.2rem 0; }
  .area button { min-height: 2.4rem; font-size: 0.8rem; padding: 0 0.8rem; }
</style>
