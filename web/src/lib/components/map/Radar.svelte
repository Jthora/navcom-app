<script lang="ts">
  /**
   * The radar: where everybody is from the middle, by bearing and distance, drawn by this app with no
   * tiles and no network (2026-11-03). The map's fallback when there are no streets to draw, and on
   * its own the view that answers *which way, how far* in a crowd where the streets are shut.
   *
   * North up, or heading up where the phone has a compass. Every blip says how old it is: fading, then
   * hollow once nothing has been heard for three minutes [invariant 7].
   */
  import { freshness, type Blip } from '$lib/map/blips';
  import { metresApart, offset, ringsFor, type LatLon } from '$lib/map/geometry';
  import { distance } from '$lib/terminal/lookup';

  let {
    blips,
    centre,
    selected = null,
    heading = null,
    now,
    onselect
  }: {
    blips: Blip[];
    centre: LatLon;
    selected?: string | null;
    heading?: number | null;
    now: number;
    onselect: (id: string) => void;
  } = $props();

  const R = 92;
  const rings = $derived(ringsFor(Math.max(0, ...blips.map((b) => metresApart(centre, b)))));
  const outer = $derived(rings[rings.length - 1]!);
  const k = $derived(R / outer);
  const turn = $derived(heading ?? 0);

  function place(b: Blip): { x: number; y: number } {
    const { east, north } = offset(centre, b);
    const a = (-turn * Math.PI) / 180;
    const x = east * Math.cos(a) - north * Math.sin(a);
    const y = east * Math.sin(a) + north * Math.cos(a);
    const r = Math.hypot(x, y) * k;
    // Past the last ring, held at its edge, still saying which way.
    const s = r > R ? R / r : 1;
    return { x: x * k * s, y: -y * k * s };
  }
  const initials = (team: string | null) => (team ? team.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase() : '');
  const mid = $derived(blips.find((b) => b.kind === 'self'));
</script>

<svg class="radar" viewBox="-100 -100 200 200" role="group" aria-label="Radar" data-radar data-heading-up={heading !== null}>
  {#each rings as ring, i (ring)}
    <circle class="ring" r={(R * ring) / outer} />
    <text class="ring-label" x="2" y={-(R * ring) / outer + 5}>{distance(ring)}</text>
    {#if i === 0}<circle class="hub" r="1.2" />{/if}
  {/each}
  <g transform="rotate({-turn})"><text class="north" x="0" y={-R - 2} text-anchor="middle">N</text></g>
  {#if selected && mid}
    {@const s = blips.find((b) => b.id === selected)}
    {#if s && s.id !== mid.id}
      {@const p = place(s)}
      <line class="go" x1="0" y1="0" x2={p.x} y2={p.y} />
    {/if}
  {/if}
  {#each blips as b (b.id)}
    {@const p = place(b)}
    {@const f = freshness(b, now)}
    <g
      class="blip"
      transform="translate({p.x} {p.y})"
      data-blip={b.id}
      data-kind={b.kind}
      data-state={b.state ?? b.kind}
      data-fresh={f}
      data-selected={b.id === selected}
      role="button"
      tabindex="0"
      aria-label={`${b.label}${b.team ? `, ${b.team}` : ''}`}
      onclick={() => onselect(b.id)}
      onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && onselect(b.id)}
    >
      {#if b.precision_m > 0}<circle class="spread" r={Math.min(R, b.precision_m * k)} />{/if}
      {#if b.kind === 'place'}
        <rect class="mark" x="-3" y="-3" width="6" height="6" />
      {:else}
        <circle class="mark" r={b.kind === 'self' ? 2.6 : 3.4} />
      {/if}
      {#if b.asking === 'distress'}<circle class="alarm" r="6" />{/if}
      <text class="label" x="5.5" y="1.8">{b.label}{#if b.team}<tspan class="team" dx="1.6">{initials(b.team)}</tspan>{/if}</text>
    </g>
  {/each}
</svg>

<style>
  .radar { width: 100%; max-width: 32rem; aspect-ratio: 1; display: block; margin-inline: auto; background: var(--t-sunk); border: 1px solid var(--t-line); }
  .ring { fill: none; stroke: var(--t-line-strong); stroke-width: 0.4; }
  .hub { fill: var(--t-faint); }
  .ring-label, .north { fill: var(--t-faint); font: 4px var(--font-mono); }
  .north { fill: var(--t-muted); font-size: 5px; }
  .go { stroke: var(--t-ink); stroke-width: 0.6; stroke-dasharray: 2 1.5; }
  .blip { cursor: pointer; outline: none; }
  .blip .mark { fill: var(--t-station); stroke: var(--t-ground); stroke-width: 0.8; }
  .blip[data-kind='self'] .mark { fill: var(--t-ink); }
  .blip[data-kind='place'] .mark { fill: none; stroke: var(--t-ink); stroke-width: 1; }
  .blip[data-state='overdue'] .mark { fill: var(--t-oncall); }
  .blip[data-state='distress'] .mark { fill: var(--t-alarm); }
  .blip .alarm { fill: none; stroke: var(--t-alarm); stroke-width: 0.8; }
  .blip .spread { fill: var(--t-station); fill-opacity: 0.08; stroke: var(--t-station); stroke-opacity: 0.3; stroke-width: 0.3; }
  .blip[data-fresh='aging'] { opacity: 0.7; }
  .blip[data-fresh='stale'] .mark { fill: var(--t-ground); stroke: var(--t-muted); stroke-width: 1; }
  .blip[data-fresh='stale'] { opacity: 0.6; }
  .blip[data-selected='true'] .mark, .blip:focus-visible .mark { stroke: var(--t-ink); stroke-width: 1.4; }
  .label { fill: var(--t-ink); font: 4.4px var(--font-mono); }
  .label .team { fill: var(--t-muted); }
</style>
