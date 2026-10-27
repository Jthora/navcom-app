<script lang="ts">
  /**
   * The map's whole key, on the layers screen [docs/design/map.md §6, §8]: every line the map's key
   * says, with the rest of its words, and every kind of mark the map draws, drawn as the canvas draws
   * it. The map itself keeps one short line for each thing drawn and a row of the overlays' marks, so
   * the key there stays short enough to leave the Earth in view above the sheet; this is where the rest
   * is, one tap away, by the *Map layers* control.
   *
   * Only what the map says it draws now is listed among its lines [mapKey]; the marks are all of them,
   * since a person meets them in any order. Every hue on these screens is a watch state, so the marks
   * are drawn in the neutrals, by shape. **The lines and the row are on the screen; the rest of each
   * line's words and what every mark means are one layer down**, in a `Why` [panel.md, rule 3]: open, they
   * were about 170 words the prose ratchet could not see, being strings (audit, 2026-10-24).
   */
  import { Panel, Why } from '$lib/components/panel';
  import { daylightDrawn, mapKey, mapLayers } from '$lib/grid/layer.svelte';
  import { FILLED, SWATCH_PATHS } from '$lib/grid/swatches';

  /** One kind of mark: its outline and its fill as SVG paths in a 16 px box, and what it means. */
  type Mark = { id: string; line?: string; fill?: string; dash?: boolean; text: string };
  const RING = 'M8 2.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 1 1 0-11z';
  const DOT = 'M8 6.6a1.4 1.4 0 1 1 0 2.8a1.4 1.4 0 1 1 0-2.8z';
  const marks = $derived.by((): Mark[] => {
    const chosen = mapLayers.chosen;
    const out: Mark[] = [
      { id: 'mission', line: RING, fill: DOT, text: 'A mission at a place on record: a ring, never smaller than its point’s precision, about a kilometre at the finest; with a centre only at its smallest, where it is a symbol, not a spot' },
      { id: 'filed', line: 'M1 4h14v8H1z', fill: 'M1 4h14v8H1z', text: 'A mission filed under a province or a country: somewhere in it, not all of it' },
      { id: 'national', line: 'M2 3h12v10H2z', text: 'A mission filed for a whole country: its outline' },
      { id: 'region', line: 'M4.5 4.5h7v7h-7z', text: 'With Places on: a directory region, which stands for the regions under it where they crowd' },
      { id: 'record', fill: 'M6 6h4v4H6z', text: 'Closer in: a place on record' },
      { id: 'held', line: 'M2 2h12v12H2z', dash: true, text: 'Closer in: a region with places held back from the map' }
    ];
    if (chosen === 'zones') {
      out.push(
        { id: 'count', line: 'M1 4.5h14v7H1z', text: 'Open missions counted in a Zone or Sector, where each package puts its subject' },
        { id: 'count-near', line: 'M1 4.5h14v7H1z', dash: true, text: 'The same, with one near an edge the drawn lines cannot settle' }
      );
    }
    if (chosen === 'spheres') {
      out.push(
        { id: 'hatch', line: 'M2 3h12v10H2z', fill: 'M2 9l6-6M2 13l10-10M6 13l8-8M10 13l4-4', text: 'The Sphere or organisation opened, hatched' },
        { id: 'small', fill: 'M8 4l4 4l-4 4l-4-4z', text: 'A small state, too small for the world’s outlines, at Natural Earth’s label point' }
      );
    }
    if (mapLayers.hazards) out.push({ id: 'area', line: 'M8 1.5L14.5 8L8 14.5L1.5 8Z', dash: true, text: 'Hazards: dashed, an event over an area, drawn at the one point its source gives' });
    if (daylightDrawn()) out.push({ id: 'sun', line: 'M8 5a3 3 0 1 1 0 6a3 3 0 1 1 0-6zM8 1v2M8 13v2M1 8h2M13 8h2', text: 'Where the sun is overhead: a mark, not a place' });
    return out;
  });
</script>

<Panel label="Key" post={mapKey.lines.length > 0 ? `${mapKey.lines.length} on the map` : 'the map'}>
  <!-- The map's own lines, then its row of marks, whole here: a small phone's key is cut short before either. -->
  <div data-key-full>
    {#if mapKey.lines.length > 0}
      <ul class="nc-key-lines">
        {#each mapKey.lines as k, i (i)}
          <li><b>{k.line}</b></li>
        {/each}
      </ul>
    {/if}
    {#if mapKey.swatches.length > 0}
      <ul class="nc-marks" data-key-swatches>
        {#each mapKey.swatches as s (s.text)}
          <li data-key-swatch={s.mark} class={s.tone}>
            <svg viewBox="0 0 12 12" width="16" height="16" aria-hidden="true">
              <path class:sf={FILLED.has(s.mark)} class="sl" d={SWATCH_PATHS[s.mark][0]} /><path class="sl" d={SWATCH_PATHS[s.mark][1]} />
            </svg>
            <span>{s.text}</span>
          </li>
        {/each}
      </ul>
    {/if}
    <!-- The rest of each line's words, and what every kind of mark means: one layer down [panel.md, rule 3]. -->
    <Why summary="What each line and mark means">
      {#if mapKey.lines.some((k) => k.credit)}
        <ul class="nc-key-lines">
          {#each mapKey.lines as k, i (i)}
            {#if k.credit}<li><b>{k.line}</b><span>{k.credit}</span></li>{/if}
          {/each}
        </ul>
      {/if}
      <ul class="nc-marks" data-key-marks>
        {#each marks as m (m.id)}
          <li data-key-mark={m.id}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              {#if m.fill}<path class="f" class:lit={m.id === 'filed'} d={m.fill} />{/if}
              {#if m.line}<path class="l" stroke-dasharray={m.dash ? '2.5 2' : null} d={m.line} />{/if}
            </svg>
            <span>{m.text}</span>
          </li>
        {/each}
      </ul>
    </Why>
  </div>
</Panel>

<style>
  .nc-key-lines,
  .nc-marks {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 0.85rem;
  }
  .nc-key-lines li {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .nc-key-lines b {
    font-family: var(--font-mono);
    font-weight: 500;
    color: var(--t-ink);
  }
  .nc-key-lines span {
    color: var(--t-muted);
  }
  .nc-marks {
    margin-block-start: 0.8rem;
  }
  .nc-marks li {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    color: var(--t-muted);
  }
  .nc-marks svg {
    flex: none;
    margin-block-start: 0.1rem;
  }
  .nc-marks .l {
    fill: none;
    stroke: var(--t-ink);
    stroke-width: 1.6;
    stroke-linejoin: round;
  }
  .nc-marks .f {
    fill: var(--t-ink);
    stroke: none;
  }
  /* A province or country a mission is filed under: a lift of the land, as the map lights it. */
  .nc-marks .f.lit {
    fill: var(--t-line-strong);
    fill: color-mix(in srgb, var(--t-ink) 20%, var(--map-land, #272f3b));
  }
  [data-key-mark='region'] .l,
  [data-key-mark='held'] .l,
  [data-key-mark='national'] .l,
  [data-key-mark='filed'] .l {
    stroke: var(--t-muted);
  }
  [data-key-mark='hatch'] .f {
    fill: none;
    stroke: var(--t-ink);
    stroke-width: 1;
  }
  .nc-marks .sl {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linejoin: round;
  }
  .nc-marks .sf {
    fill: currentColor;
    stroke: none;
  }
  [data-key-swatch].ink svg { color: var(--t-ink); }
  [data-key-swatch].muted svg { color: var(--t-muted); }
  [data-key-swatch].faint svg { color: var(--t-faint); }
  [data-key-swatch='dots'] svg { color: var(--map-strong, #5b6673); }
  [data-key-swatch='lit'] .sf {
    fill: var(--t-line-strong);
    fill: color-mix(in srgb, var(--t-ink) 16%, var(--map-land, #272f3b));
    stroke: var(--t-muted);
    stroke-width: 1;
  }
  [data-key-mark='record'] .f,
  [data-key-mark='small'] .f {
    fill: var(--t-muted);
  }
</style>
