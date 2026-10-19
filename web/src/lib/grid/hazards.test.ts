/**
 * Hazards over the map [docs/design/map.md §8, Hazards]: three public feeds' whole-world lists, read on
 * the phone, drawn as neutral shapes, each feed's age said, and nothing listed never read as safe.
 *
 * What is held here, against the recorded fixtures in the shapes measured on 2026-10-19
 * (`e2e/fixtures/hazards/`), never the live services:
 *
 * - **What is asked**: the exact URLs, whole-world, with nothing chosen by a view, a box or a point
 * - **How each answer is read**: the source's own words kept as they were given, only an https link
 *   made a link, and what cannot be drawn counted rather than dropped silently
 * - **When it asks**: once when turned on, then at most every 10 minutes, never while the page is
 *   hidden, never again for a toggle off and on, and nothing left running when it stops
 * - **What the key says**: each feed's age, *not read: unknown* for a feed with no answer, and an empty
 *   map that reads *not the same as safe*
 */

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPS, HAZARD_FEEDS, HAZARDS_EVERY } from '$lib/outside';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../e2e/fixtures/hazards/${name}.json`, import.meta.url), 'utf8'));

/** A fresh copy of the overlay's module, and the map's shared state with it: its schedule is module state. */
async function fresh() {
  vi.resetModules();
  const hazards = await import('./layers/hazards');
  const layer = await import('./layer.svelte');
  return { ...hazards, ...layer };
}

describe('what it asks', () => {
  it('asks five URLs, whole-world, and nothing built from where anybody looks', () => {
    expect(HAZARD_FEEDS.flatMap((f) => f.urls)).toEqual([
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson',
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_day.geojson',
      'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=volcanoes,severeStorms',
      'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=wildfires&days=30',
      'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH'
    ]);
    for (const url of HAZARD_FEEDS.flatMap((f) => f.urls)) {
      const params = [...new URL(url).searchParams.keys()];
      expect(params.filter((p) => /bbox|lat|lon|lng|lim|limit|point|near|area|minlat|maxlat|minlon|maxlon/i.test(p)), url).toEqual([]);
    }
    // all_day is every small quake on Earth, and EONET's whole open list was 4.88 MB: neither is asked.
    expect(HAZARD_FEEDS.flatMap((f) => f.urls).some((u) => u.includes('all_day'))).toBe(false);
    expect(HAZARD_FEEDS.find((f) => f.id === 'eonet')!.urls.every((u) => u.includes('category='))).toBe(true);
  });
});

describe('how each answer is read', () => {
  it('reads USGS as it gave it, merging its two lists by id, and counts a feature it cannot place', async () => {
    const { usgsOf } = await fresh();
    const read = usgsOf([fixture('usgs-45'), fixture('usgs-sig')]);
    expect(read.marks.map((m) => m.id)).toEqual(['usgs:us6000u3ch', 'usgs:us6000u3c1', 'usgs:us6000u3bc']);
    expect(read.dropped).toBe(1);
    // Two lists, two times: the older, so the list is said to be at least that old.
    expect(read.generated).toBe(1792415936000);
    const ruteng = read.marks[0]!;
    expect(ruteng).toMatchObject({
      feed: 'usgs',
      kind: 'earthquake',
      title: 'M 4.8 - 56 km N of Ruteng, Indonesia',
      measure: '4.8 mb',
      alert: null,
      lon: 120.378,
      lat: -8.1042
    });
    expect(ruteng.time).toBe('2026-10-19T12:06:01.884Z');
    expect(ruteng.links).toEqual([{ label: 'USGS event page', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us6000u3ch' }]);
    // The PAGER level is quoted as the source's word, never drawn as its colour.
    expect(read.marks[2]!.alert).toBe('PAGER alert: green');
  });

  it('reads EONET’s latest point, its units as given, links only where they are https, and counts an area it cannot draw', async () => {
    const { eonetOf } = await fresh();
    const read = eonetOf([fixture('eonet-open'), fixture('eonet-fires')]);
    expect(read.marks.map((m) => [m.id, m.kind])).toEqual([
      ['eonet:EONET_25340', 'storm'],
      ['eonet:EONET_20710', 'volcano'],
      ['eonet:EONET_25310', 'wildfire']
    ]);
    expect(read.notDrawn).toBe(1);
    const wati = read.marks[0]!;
    expect(wati).toMatchObject({ title: 'Tropical Cyclone Wati', measure: '45 kts', time: '2026-10-19T06:00:00Z', lon: -156.8, lat: -20.7 });
    expect(read.marks[2]!.measure).toBe('751 acres');
    // A javascript: link is the source's name as text, and never a link.
    expect(read.marks[1]!.links).toEqual([
      { label: 'SIVolcano', url: 'https://volcano.si.edu/volcano.cfm?vn=357070' },
      { label: 'Fixture', url: null }
    ]);
  });

  it('reads GDACS’s floods, droughts and cyclones that are current, and nothing else', async () => {
    const { gdacsOf } = await fresh();
    const read = gdacsOf([fixture('gdacs-search')]);
    expect(read.marks.map((m) => [m.id, m.kind])).toEqual([
      ['gdacs:TC-1001338', 'storm'],
      ['gdacs:DR-1018332', 'drought']
    ]);
    const champi = read.marks[0]!;
    expect(champi).toMatchObject({
      title: 'Tropical Cyclone CHAMPI-26',
      alert: 'GDACS alert: Red',
      measure: 'Hurricane/Typhoon > 74 mph (maximum wind speed of 278 km/h)',
      time: '2026-10-19T08:01:01'
    });
    expect(champi.more).toEqual([
      { k: 'Where', v: 'Guam, Northern Mariana Islands, Japan' },
      { k: 'From', v: '2026-10-14T12:00:00' },
      { k: 'To', v: '2026-10-19T06:00:00' }
    ]);
    expect(champi.links).toEqual([{ label: 'GDACS report', url: 'https://www.gdacs.org/report.aspx?eventid=1001338&episodeid=20&eventtype=TC' }]);
    // GDACS gives its times with no zone; they are read as UTC for an age, and shown as given.
    expect(champi.at).toBe(Date.parse('2026-10-19T08:01:01Z'));
  });

  it('reads a feed that listed entries and could read none of them as not read, never as nothing listed', async () => {
    const { usgsOf, gdacsOf, eonetOf } = await fresh();
    // Every USGS quake given another way than a point: listed, and none of them placeable.
    const moved = fixture('usgs-45') as { features: { geometry: { type: string; coordinates: unknown } | null }[] };
    for (const f of moved.features) f.geometry = { type: 'MultiPoint', coordinates: [[0, 0]] };
    const usgs = usgsOf([moved, { type: 'FeatureCollection', metadata: {}, features: [] }]);
    expect(usgs.marks).toEqual([]);
    expect(usgs.malformed, 'every quake unplaceable read as nothing listed').toBe(true);
    // EONET's every event in a category nobody here knows, `constructor` among them.
    const strange = fixture('eonet-open') as { events: { categories: { id: string }[] }[] };
    strange.events.forEach((e, i) => (e.categories[0]!.id = i % 2 ? 'constructor' : '__proto__'));
    expect(eonetOf([strange]).malformed).toBe(true);
    // GDACS's current flag as a boolean, which it may send one day: read as the string is.
    const gdacs = fixture('gdacs-search') as { features: { properties: { iscurrent: unknown } }[] };
    const booleans = structuredClone(gdacs);
    for (const f of booleans.features) f.properties.iscurrent = f.properties.iscurrent === 'true';
    expect(gdacsOf([booleans]).marks.map((m) => m.id)).toEqual(gdacsOf([gdacs]).marks.map((m) => m.id));
    expect(gdacsOf([booleans]).marks).toHaveLength(2);
    // And as anything else: unreadable, every one, which is not read, never none.
    const other = structuredClone(gdacs);
    for (const f of other.features) f.properties.iscurrent = f.properties.iscurrent === 'true' ? 1 : 0;
    const read = gdacsOf([other]);
    expect(read.marks).toEqual([]);
    expect(read.malformed, 'every current flag unreadable read as nothing listed').toBe(true);
  });

  it('counts a kind it does not know as left out, and never takes a feed’s word for a key', async () => {
    const { eonetOf, gdacsOf } = await fresh();
    const eonet = fixture('eonet-open') as { events: { categories: { id: string }[] }[] };
    eonet.events[0]!.categories[0]!.id = 'constructor';
    const e = eonetOf([eonet, fixture('eonet-fires')]);
    expect(e.marks.map((m) => m.id)).not.toContain('eonet:EONET_25340');
    expect(e.marks.every((m) => typeof m.word === 'string' && m.word.length > 0)).toBe(true);
    expect(e.dropped).toBe(1);
    const gdacs = fixture('gdacs-search') as { features: { properties: { eventtype: string; iscurrent: string } }[] };
    const champi = gdacs.features.find((f) => f.properties.eventtype === 'TC' && f.properties.iscurrent === 'true')!;
    champi.properties.eventtype = 'toString';
    const g = gdacsOf([gdacs]);
    expect(g.marks.map((m) => m.kind)).toEqual(['drought']);
    expect(g.dropped).toBe(1);
  });

  it('takes no answer that is not the shape it was measured in, rather than drawing part of one', async () => {
    const { usgsOf, eonetOf, gdacsOf } = await fresh();
    for (const read of [usgsOf([{ nope: 1 }, fixture('usgs-sig')]), eonetOf(['x', fixture('eonet-fires')]), gdacsOf([null])]) {
      expect(read.marks).toEqual([]);
      expect(read.malformed).toBe(true);
    }
  });

  it('cuts a source’s words that would not fit a screen, with a visible …, and keeps a feed’s marks to a cap', async () => {
    const { usgsOf, MARK_CAP } = await fresh();
    const big = fixture('usgs-45') as { features: { id: string; properties: { title: string } }[] };
    big.features[0]!.properties.title = 'M 4.8 - ' + 'x'.repeat(900);
    const one = usgsOf([big, { type: 'FeatureCollection', metadata: {}, features: [] }]);
    expect(one.marks[0]!.title.length).toBe(500);
    expect(one.marks[0]!.title.endsWith('…')).toBe(true);
    const many = {
      type: 'FeatureCollection',
      metadata: { generated: 1 },
      features: Array.from({ length: MARK_CAP + 7 }, (_, i) => ({
        type: 'Feature',
        id: `q${i}`,
        properties: { title: `M 4.5 - ${i}`, mag: 4.5, magType: 'mb', time: 1, url: null },
        geometry: { type: 'Point', coordinates: [i % 180, 0] }
      }))
    };
    const capped = usgsOf([many, { type: 'FeatureCollection', metadata: {}, features: [] }]);
    expect(capped.marks).toHaveLength(MARK_CAP);
    expect(capped.capped).toBe(7);
  });
});

describe('when it asks', () => {
  let calls: string[];
  let hidden: boolean;
  let listeners: Map<string, () => void>;
  let held: ((r: Response) => void)[];
  let hold: boolean;
  let signals: AbortSignal[];

  const answer = (url: string) => {
    const name = {
      [HAZARD_FEEDS[0]!.urls[0]!]: 'usgs-45',
      [HAZARD_FEEDS[0]!.urls[1]!]: 'usgs-sig',
      [HAZARD_FEEDS[1]!.urls[0]!]: 'eonet-open',
      [HAZARD_FEEDS[1]!.urls[1]!]: 'eonet-fires',
      [HAZARD_FEEDS[2]!.urls[0]!]: 'gdacs-search'
    }[url];
    return new Response(JSON.stringify(fixture(name!)), { status: 200 });
  };

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-10-19T13:20:00Z') });
    calls = [];
    hidden = false;
    hold = false;
    held = [];
    signals = [];
    listeners = new Map();
    vi.stubGlobal('document', {
      get hidden() {
        return hidden;
      },
      addEventListener: (type: string, f: () => void) => listeners.set(type, f),
      removeEventListener: (type: string) => listeners.delete(type)
    });
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      calls.push(url);
      signals.push(init.signal!);
      expect(init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', mode: 'cors' });
      if (hold) return new Promise<Response>((resolve) => held.push(resolve));
      return Promise.resolve(answer(url));
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const settle = () => vi.advanceTimersByTimeAsync(0);

  it('asks every feed once when turned on, again at 10 minutes and not before, and never while the page is hidden', async () => {
    const { overlay, layerData } = await fresh();
    overlay.load();
    await settle();
    expect(calls).toHaveLength(5);
    expect(layerData.hazards!.marks).toHaveLength(8);

    await vi.advanceTimersByTimeAsync(HAZARDS_EVERY - 1_000);
    expect(calls, 'asked again inside 10 minutes').toHaveLength(5);
    await vi.advanceTimersByTimeAsync(1_000 + 100);
    expect(calls).toHaveLength(10);

    hidden = true;
    await vi.advanceTimersByTimeAsync(3 * HAZARDS_EVERY);
    expect(calls, 'asked while nobody could see the page').toHaveLength(10);

    // Back in view, the feeds that are due are asked, once.
    hidden = false;
    listeners.get('visibilitychange')!();
    await settle();
    expect(calls).toHaveLength(15);
    listeners.get('visibilitychange')!();
    await settle();
    expect(calls, 'asked twice for one return to view').toHaveLength(15);
    overlay.stop!();
  });

  it('asks nothing again for a toggle off and on inside 10 minutes, and keeps what it read, with its age', async () => {
    const { overlay, layerData, legendOf } = await fresh();
    overlay.load();
    await settle();
    overlay.stop!();
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    overlay.load();
    await settle();
    expect(calls).toHaveLength(5);
    expect(layerData.hazards!.marks).toHaveLength(8);
    expect(legendOf(layerData.hazards!.feeds, Date.now())).toContain('USGS, EONET and GDACS 4 min ago');
    await vi.advanceTimersByTimeAsync(6 * 60_000 + 100);
    expect(calls).toHaveLength(10);
    overlay.stop!();
  });

  it('leaves nothing running when it stops: no timer, no listener, and what was on its way given up', async () => {
    const { overlay, layerData } = await fresh();
    hold = true;
    overlay.load();
    await settle();
    expect(calls).toHaveLength(5);
    overlay.stop!();
    expect(signals.every((s) => s.aborted), 'a request was left on its way').toBe(true);
    expect(listeners.has('visibilitychange')).toBe(false);
    await settle();
    expect(vi.getTimerCount(), 'a timer outlived the overlay').toBe(0);
    // Nothing that arrives after it stopped is drawn, and a feed that never answered is not none.
    for (const resolve of held) resolve(answer(HAZARD_FEEDS[0]!.urls[0]!));
    await settle();
    expect(layerData.hazards!.marks).toEqual([]);
    expect(layerData.hazards!.feeds.usgs.state).toBe('unread');
  });

  it('keeps a feed’s other asks when one passes its cap, says which did not answer, and never asks it again on the page', async () => {
    const { overlay, layerData, legendOf } = await fresh();
    const fires = HAZARD_FEEDS[1]!.urls[1]!;
    vi.stubGlobal('fetch', (url: string) => {
      calls.push(url);
      if (url === fires) return Promise.resolve(new Response('x'.repeat(CAPS.eonet + 1), { status: 200 }));
      return Promise.resolve(answer(url));
    });
    overlay.load();
    await settle();
    const { feeds, marks } = layerData.hazards!;
    // The volcano and the storm still drawn; the wildfires unknown, and said to be, by what they list.
    expect(feeds.eonet.state).toBe('ready');
    expect(feeds.eonet.missing).toEqual([{ part: 'wildfires', why: 'too-large' }]);
    expect(marks.filter((m) => m.feed === 'eonet').map((m) => m.kind).sort()).toEqual(['storm', 'volcano']);
    expect(legendOf(feeds, Date.now())).toBe('Hazards · USGS just now · EONET just now, wildfires not read: unknown · GDACS just now · some events, never all');
    // A phone does not pay every 10 minutes for an answer it drops: the rest are asked again, that one not.
    await vi.advanceTimersByTimeAsync(HAZARDS_EVERY + 100);
    expect(calls.filter((u) => u === fires)).toHaveLength(1);
    expect(calls.filter((u) => u === HAZARD_FEEDS[1]!.urls[0])).toHaveLength(2);
    expect(layerData.hazards!.feeds.eonet.missing).toEqual([{ part: 'wildfires', why: 'too-large' }]);
    overlay.stop!();
  });

  it('reads every feed as not read when each listed entries and could read none, never as nothing listed', async () => {
    const { overlay, layerData, legendOf } = await fresh();
    // Each answer the shape it was measured in, and nothing in it readable: a point given another way,
    // a current flag of another type, an event with no title.
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      const body = (await answer(url).json()) as { features?: Record<string, Record<string, unknown>>[]; events?: Record<string, unknown>[] };
      for (const f of body.features ?? []) {
        if (f['geometry']) f['geometry']['type'] = 'MultiPoint';
        if (f['properties'] && 'iscurrent' in f['properties']) f['properties']['iscurrent'] = 1;
      }
      for (const e of body.events ?? []) e['title'] = '';
      return new Response(JSON.stringify(body), { status: 200 });
    });
    overlay.load();
    await settle();
    const { feeds } = layerData.hazards!;
    expect([feeds.usgs.state, feeds.eonet.state, feeds.gdacs.state]).toEqual(['failed', 'failed', 'failed']);
    const said = legendOf(feeds, Date.now());
    expect(said).toBe('Hazards · USGS, EONET and GDACS not read: unknown · some events, never all');
    expect(said).not.toContain('nothing listed');
    overlay.stop!();
  });

  it('reads a feed that fails as not read, and one past its cap as not read, never as nothing there', async () => {
    const { overlay, layerData, legendOf } = await fresh();
    vi.stubGlobal('fetch', (url: string) => {
      calls.push(url);
      if (url.includes('gdacs')) return Promise.reject(new TypeError('Failed to fetch'));
      if (url.includes('eonet')) return Promise.resolve(new Response('x'.repeat(CAPS.eonet + 1), { status: 200 }));
      return Promise.resolve(answer(url));
    });
    overlay.load();
    await settle();
    const { feeds, marks } = layerData.hazards!;
    expect(feeds.gdacs.state).toBe('failed');
    expect(feeds.eonet.state).toBe('too-large');
    expect(marks.every((m) => m.feed === 'usgs')).toBe(true);
    const said = legendOf(feeds, Date.now());
    expect(said).toBe('Hazards · USGS just now · EONET and GDACS not read: unknown · some events, never all');
    overlay.stop!();
  });
});

describe('what the key says', () => {
  const ready = (readAt: number, count: number) => ({
    state: 'ready' as const,
    readAt,
    generated: null,
    count,
    dropped: 0,
    notDrawn: 0,
    capped: 0,
    malformed: false,
    missing: [] as { part: string; why: 'failed' | 'too-large' }[]
  });
  const unread = { state: 'unread' as const, readAt: null, generated: null, count: 0, dropped: 0, notDrawn: 0, capped: 0, malformed: false, missing: [] };
  const NOW = Date.parse('2026-10-19T13:20:00Z');

  it('gives each feed its own age, and an unread one as not read, never as none or 0', async () => {
    const { legendOf } = await fresh();
    const said = legendOf({ usgs: ready(NOW - 3 * 60_000, 3), eonet: ready(NOW - 3 * 60_000, 0), gdacs: unread }, NOW);
    expect(said).toBe('Hazards · USGS and EONET 3 min ago · GDACS not read: unknown · some events, never all');
    // Each feed its own age: the same words are said once, never one age for feeds read apart.
    expect(legendOf({ usgs: ready(NOW - 3 * 60_000, 1), eonet: ready(NOW - 12 * 60_000, 1), gdacs: ready(NOW - 3 * 60_000, 1) }, NOW)).toBe(
      'Hazards · USGS 3 min ago · EONET 12 min ago · GDACS 3 min ago · some events, never all'
    );
    expect(said).not.toMatch(/\bnone\b|\b0\b/);
  });

  it('says an empty map is not the same as safe', async () => {
    const { legendOf } = await fresh();
    const said = legendOf({ usgs: ready(NOW - 2 * 60_000, 0), eonet: ready(NOW - 3 * 60_000, 0), gdacs: ready(NOW - 60_000, 0) }, NOW);
    expect(said).toBe('Hazards · nothing listed by USGS, EONET or GDACS, read 3 min ago · not the same as safe');
  });

  it('says nothing listed only when nothing was left out: an event it could not draw, or an ask that did not answer, is not nothing', async () => {
    const { legendOf } = await fresh();
    const empty = { usgs: ready(NOW, 0), eonet: ready(NOW, 0), gdacs: ready(NOW, 0) };
    const cases: [string, ReturnType<typeof ready>][] = [
      ['an area it could not draw', { ...ready(NOW, 0), notDrawn: 1 }],
      ['an entry it could not read', { ...ready(NOW, 0), dropped: 1 }],
      ['an ask that did not answer', { ...ready(NOW, 0), missing: [{ part: 'wildfires', why: 'failed' }] }]
    ];
    for (const [why, eonet] of cases) {
      const said = legendOf({ ...empty, eonet }, NOW);
      expect(said, why).not.toContain('nothing listed');
      expect(said, why).toContain('some events, never all');
    }
  });

  it('says it is asking while the first answers are on their way', async () => {
    const { legendOf } = await fresh();
    const asking = { ...unread, state: 'loading' as const };
    expect(legendOf({ usgs: asking, eonet: asking, gdacs: asking }, NOW)).toBe('Hazards · asking USGS, EONET and GDACS · some events, never all');
  });
});

describe('what a hover or a tap lands on', () => {
  it('finds every mark within a thumb of the tap, nearest first, and says the source’s own words', async () => {
    const { usgsOf, hitOf } = await fresh();
    const { project } = await import('./topology');
    const marks = usgsOf([fixture('usgs-45'), fixture('usgs-sig')]).marks;
    const [ux, uy] = project(120.378, -8.1042);
    const v = { cx: ux, cy: uy, scale: 317, width: 393, height: 600 };
    const hit = hitOf(marks, v, [393 / 2 + 1, 300], Date.parse('2026-10-19T13:20:00Z'));
    // The two Indonesian quakes share a cell at the whole-Earth view: both answer, the nearer first.
    expect(hit!.ids).toBe('usgs:us6000u3ch,usgs:us6000u3c1');
    expect(hit!.of).toBe(2);
    // Its time is named, since each source's is something else: a quake's is when it occurred.
    expect(hit!.say).toBe('M 4.8 - 56 km N of Ruteng, Indonesia · 4.8 mb · origin 1 h ago · USGS · and 1 more');
    expect(hitOf(marks, v, [20, 20], Date.now())).toBeNull();
  });

  it('names what each source’s time is, never a bare age: an update is not the event’s age, nor is a latest point', async () => {
    const { gdacsOf, eonetOf, chipOf } = await fresh();
    const now = Date.parse('2026-10-19T13:20:00Z');
    const champi = gdacsOf([fixture('gdacs-search')]).marks[0]!;
    expect(chipOf(champi, now)).toBe('Tropical Cyclone CHAMPI-26 · GDACS alert: Red · updated 5 h ago · GDACS');
    const chillan = eonetOf([fixture('eonet-open'), fixture('eonet-fires')]).marks.find((m) => m.kind === 'volcano')!;
    expect(chipOf(chillan, now)).toBe('Nevados del Chillan Volcano, Chile · latest point 126 days ago · EONET');
  });

  it('says how many were in reach when a crowded spot holds more than one screen names', async () => {
    const { usgsOf, hitOf } = await fresh();
    const { project } = await import('./topology');
    const many = {
      type: 'FeatureCollection',
      metadata: { generated: 1 },
      features: Array.from({ length: 40 }, (_, i) => ({
        type: 'Feature',
        id: `q${i}`,
        properties: { title: `M 4.5 - swarm ${i}`, mag: 4.5, magType: 'mb', time: 1, url: null },
        geometry: { type: 'Point', coordinates: [120 + i / 1000, -8] }
      }))
    };
    const marks = usgsOf([many]).marks;
    const [x, y] = project(120, -8);
    const hit = hitOf(marks, { cx: x, cy: y, scale: 317, width: 393, height: 600 }, [393 / 2, 300], Date.now())!;
    expect(hit.ids.split(',')).toHaveLength(12);
    expect(hit.of).toBe(40);
    expect(hit.say).toContain('and 39 more');
  });
});
