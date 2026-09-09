/**
 * The observation object, checked against the spec rather than against my reading of it.
 *
 * Two of these assertions read `raw-intel.md` and derive the number they check. That is
 * deliberate: the one field whose entire job is preventing an operator from being located has
 * already been shipped with an eight-fold disagreement between its adjective and its example,
 * and a test that hardcodes the same number as the code proves only that I typed it twice.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import {
  ANONYMOUS,
  anchorFromRecord,
  AREA_GEOHASH_CHARS,
  buildObservation,
  buildRefinement,
  KIND_OBSERVATION,
  OBSERVATION_METHODS,
  OBSERVATION_FIELDS,
  OBSERVATION_TAGS,
  ObservationError,
  readObservation,
  readyToRefine,
  reapObservations,
  REFINE_AFTER_SECONDS,
  RETENTION_DAYS,
  TAGS_MAX,
  type Observation,
  type Where,
  OBSERVATION_LABELS,
  OBSERVATION_VOCABULARY,
  observationLabel,
  observationMethodLabel,
  OBSERVATION_METHOD_LABELS
} from '../src/index.js';

const SPEC = fileURLToPath(new URL('../../../docs/product/raw-intel.md', import.meta.url));
const spec = () => readFileSync(SPEC, 'utf8');

const contact = generateSecretKey();
const operational = generateSecretKey();
const T = 1_756_000_000;
const AREA: Where = { precision: 'area', geohash: 'dp3w' };

const seen = (over: Partial<Observation> = {}): Observation => ({
  anchor: 'st-louis/st-patrick-center',
  observed_at: T - 3600,
  tags: ['locked'],
  method: 'saw',
  callsign: 'Raven',
  precision: 'area',
  ...over
});

const overRelay = (e: Event): Event => JSON.parse(JSON.stringify(e)) as Event;
const build = (o: Partial<Observation> = {}, w: Where = AREA) =>
  buildObservation(contact, seen(o), w, T);

describe('the kind, and why it is that kind', () => {
  it('is 1911 and is regular, so a relay stores it and nobody can overwrite it', () => {
    expect(KIND_OBSERVATION).toBe(1911);
    // Regular is 1000-9999. Replaceable and addressable both let an author rewrite history.
    expect(KIND_OBSERVATION).toBeGreaterThanOrEqual(1000);
    expect(KIND_OBSERVATION).toBeLessThan(10000);
  });

  it('is signed by the contact key, never the operational one', () => {
    const event = build();
    expect(event.pubkey).toBe(getPublicKey(contact));
    expect(event.pubkey).not.toBe(getPublicKey(operational));
  });
});

describe('no free text leaves the device', () => {
  it('carries only the seven things an observation is allowed to say', () => {
    // The whole of §6's enforcement. There is no field for a physical descriptor because
    // there is no field for a sentence.
    expect([...OBSERVATION_FIELDS].sort()).toEqual(
      ['anchor', 'callsign', 'method', 'observed_at', 'precision', 'supersedes', 'tags'].sort()
    );
  });

  it('has nowhere to put a description of a person', () => {
    const content = JSON.parse(build().content) as Record<string, unknown>;
    const names = Object.keys(content).join(' ');
    expect(names).not.toMatch(/note|desc|comment|text|detail|appearance|clothing|vehicle|race/i);
  });

  it('refuses an observation carrying a field it does not know, rather than trimming it', () => {
    const event = build();
    const smuggled = overRelay({
      ...event,
      content: JSON.stringify({ ...JSON.parse(event.content), notes: 'red jacket' })
    });
    expect(readObservation(smuggled)).toBeNull();
  });

  it('refuses a term outside the vocabulary rather than passing it through', () => {
    expect(() => build({ tags: ['saw_a_guy'] })).toThrow(ObservationError);
  });
});

describe('coarse now, precise later', () => {
  it('pins the coarse area to the character count the spec pins', () => {
    // Derived, not retyped. The spec's own table is the authority for this number.
    const m = /geohash, exactly (\d+) characters/i.exec(spec());
    expect(m, 'the spec no longer pins a character count').not.toBeNull();
    expect(AREA_GEOHASH_CHARS).toBe(Number(m![1]));
  });

  it('refuses a geohash of any other length, including a finer one', () => {
    // A five-character geohash is +/-2.4km. Finer is the dangerous direction.
    expect(() => build({}, { precision: 'area', geohash: 'dp3wj' })).toThrow(ObservationError);
    expect(() => build({}, { precision: 'area', geohash: 'dp3' })).toThrow(ObservationError);
  });

  it('refuses a geohash containing a letter no geohash has', () => {
    expect(() => build({}, { precision: 'area', geohash: 'dpai' })).toThrow(ObservationError);
  });

  it('refuses a precision that disagrees with the position given', () => {
    expect(() => build({ precision: 'exact' }, AREA)).toThrow(ObservationError);
  });

  it('waits the number of hours the spec says before the exact half may publish', () => {
    const m = /Forty-eight hours|48 hours later|\*\*48 hours\*\*/i.exec(spec());
    expect(m, 'the spec no longer states the delay').not.toBeNull();
    expect(REFINE_AFTER_SECONDS).toBe(48 * 60 * 60);
    expect(readyToRefine(T, T + REFINE_AFTER_SECONDS - 1)).toBe(false);
    expect(readyToRefine(T, T + REFINE_AFTER_SECONDS)).toBe(true);
  });
});

describe('a refinement replaces a position and never adds an observation', () => {
  // Lazy on purpose. Built eagerly, a wrong AREA_GEOHASH_CHARS threw during collection and
  // took the whole file down, so the assertion written to name that exact drift never ran.
  const area = () => build();

  it('names the event it refines, in a tag', () => {
    const a = area();
    const exact = buildRefinement(contact, seen(), { lat: 38.63, lon: -90.2 }, a.id, T + REFINE_AFTER_SECONDS);
    expect(exact.tags).toContainEqual(['refines', a.id]);
    const read = readObservation(overRelay(exact));
    expect(read!.refines).toBe(a.id);
    expect(read!.where).toEqual({ precision: 'exact', lat: 38.63, lon: -90.2 });
  });

  it('is a distinct event, which is exactly why dedup on id does not catch it', () => {
    const a = area();
    const exact = buildRefinement(contact, seen(), { lat: 38.63, lon: -90.2 }, a.id, T + REFINE_AFTER_SECONDS);
    expect(exact.id).not.toBe(a.id);
    // One operator, one thing, once -- and two events ~20km apart. A consumer that treated
    // these as independent would have them corroborate each other.
    expect(readObservation(overRelay(exact))!.refines).toBe(a.id);
    expect(readObservation(overRelay(a))!.refines).toBeNull();
  });

  it('keeps refines and supersedes apart, because they mean different things', () => {
    const other = build({ tags: ['closed'] });
    const superseding = build({ supersedes: other.id });
    const read = readObservation(overRelay(superseding))!;
    // Supersession: the author changed their account. Refinement: same account, finer.
    expect(read.observation.supersedes).toBe(other.id);
    expect(read.refines).toBeNull();
  });

  it('refuses a refinement that does not name a real event id', () => {
    expect(() =>
      buildRefinement(contact, seen(), { lat: 1, lon: 1 }, 'not-an-id', T)
    ).toThrow(ObservationError);
  });
});

describe('anonymous means no name, not no history', () => {
  it('lets an observation carry no callsign', () => {
    const read = readObservation(overRelay(build({ callsign: ANONYMOUS })));
    expect(read!.observation.callsign).toBe(ANONYMOUS);
  });

  it('still signs it with the contact key, so two are detectably one source', () => {
    /*
     * Load-bearing for something it was not chosen for. Starcom's weight model floors an
     * anonymous observation rather than excluding it, and relies on it being unable to
     * corroborate itself. Key-level anonymity would let one actor present as N independent
     * sources and make Sybil corroboration free.
     */
    const a = readObservation(overRelay(build({ callsign: ANONYMOUS })))!;
    const b = readObservation(overRelay(build({ callsign: ANONYMOUS, tags: ['closed'] })))!;
    expect(a.author).toBe(b.author);
  });

  it('is what the spec says an operator must be shown', () => {
    expect(spec()).toMatch(/Anonymous means no name\. It does not mean no history\./);
  });
});

describe('method is a fact, and NavCom grades nothing', () => {
  it('offers only how somebody came to know', () => {
    expect([...OBSERVATION_METHODS]).toEqual(['saw', 'told', 'inferred']);
  });

  it('has no field anywhere for confidence, priority or a score', () => {
    const content = JSON.parse(build().content) as Record<string, unknown>;
    const names = Object.keys(content).join(' ');
    expect(names).not.toMatch(/confidence|score|grade|rating|priority|reliability|credibility/i);
  });

  it('accepts an inferred report from an unknown operator, because F6 is a grade', () => {
    // "There is therefore no quality bar on submission, ever."
    expect(() => build({ method: 'inferred', callsign: ANONYMOUS })).not.toThrow();
  });
});

describe('what it refuses outright', () => {
  it('needs something to be about', () => {
    expect(() => build({ anchor: '  ' })).toThrow(ObservationError);
  });

  it('needs to say when, distinctly from when it was published', () => {
    expect(() => build({ observed_at: 0 })).toThrow(ObservationError);
    const read = readObservation(overRelay(build({ observed_at: T - 7200 })))!;
    expect(read.observation.observed_at).toBe(T - 7200);
    expect(read.at).toBe(T);
  });

  it('needs to say what was seen, and nothing_observed counts', () => {
    expect(() => build({ tags: [] })).toThrow(ObservationError);
    expect(() => build({ tags: ['nothing_observed'] })).not.toThrow();
  });

  it('stops at the cap rather than carrying a survey', () => {
    expect(() => build({ tags: OBSERVATION_TAGS.slice(0, TAGS_MAX + 1) as unknown as string[] })).toThrow(
      ObservationError
    );
  });

  it('returns null rather than throwing on anything a relay served', () => {
    const event = build();
    for (const bad of [
      { ...event, content: 'not json' },
      { ...event, content: '[]' },
      { ...event, content: JSON.stringify({ ...JSON.parse(event.content), method: 'guessed' }) },
      { ...event, kind: 1910 }
    ]) {
      expect(readObservation(overRelay(bad as Event))).toBeNull();
    }
  });

  it('refuses one whose signature does not hold', () => {
    const event = build();
    const forged = overRelay({ ...event, content: JSON.stringify({ ...JSON.parse(event.content), callsign: 'Wren' }) });
    expect(readObservation(forged)).toBeNull();
  });
});

describe('being findable at all', () => {
  /** The filter a client actually sends, applied by hand -- a relay matches tags, not types. */
  const served = (event: Event, key: string, value: string) =>
    event.tags.some((t) => t[0] === key && t[1] === value);

  it('can be asked for by metro, the way a place already can', () => {
    const event = overRelay(buildObservation(contact, seen(), AREA, T, 'st-louis'));
    expect(served(event, 'g', 'st-louis')).toBe(true);
  });

  it('can be asked for by the place it is about, the way a correction already can', () => {
    const event = overRelay(buildObservation(contact, seen(), AREA, T, 'st-louis'));
    expect(served(event, 'd', 'st-louis/st-patrick-center')).toBe(true);
  });

  it('composes with the correction filter, so one round trip fetches both', () => {
    /*
     * `{ kinds: [30911, 1911], '#d': [...records] }` -- a client already sends the first
     * half of that. The shared meaning of `d` is what makes it work.
     */
    const event = overRelay(buildObservation(contact, seen(), AREA, T, 'st-louis'));
    const wanted = ['st-louis/st-patrick-center', 'st-louis/other'];
    const dTags = event.tags.filter((t) => t[0] === 'd').map((t) => t[1]);
    expect(wanted.some((w) => dTags.includes(w))).toBe(true);
  });

  it('reads its region back, or null when the publisher gave none', () => {
    expect(readObservation(overRelay(buildObservation(contact, seen(), AREA, T, 'st-louis')))!.region)
      .toBe('st-louis');
    expect(readObservation(overRelay(buildObservation(contact, seen(), AREA, T)))!.region).toBeNull();
  });

  it('says nothing in a tag that the content does not already say', () => {
    // The test any future tag on this object has to pass: a filter, not a disclosure.
    const event = buildObservation(contact, seen(), AREA, T, 'st-louis');
    const content = JSON.parse(event.content) as Record<string, unknown>;
    for (const [key, value] of event.tags) {
      if (key === 'd') expect(value).toBe(content['anchor']);
      // The region is a coarsening of a position the directory already publishes.
      if (key === 'g') expect(typeof value).toBe('string');
    }
  });
});

describe('what an observation may be filed against', () => {
  const place = (over: Record<string, unknown> = {}) =>
    ({ id: 'st-louis/st-patrick-center', name: "St Patrick's", type: 'shelter',
       lat: 38.627, lon: -90.1994, region: 'st-louis', ...over }) as never;

  it('coarsens the anchor’s own position, never the operator’s', () => {
    const a = anchorFromRecord(place());
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.anchor).toBe('st-louis/st-patrick-center');
    expect(a.region).toBe('st-louis');
    // Cross-checked against an independent implementation rather than taken from this one --
    // the first version of this line was a guess and disagreed with both.
    expect(a.where).toEqual({ precision: 'area', geohash: '9yzg' });
    expect(a.where.precision === 'area' && a.where.geohash).toHaveLength(AREA_GEOHASH_CHARS);
  });

  it('refuses a refuge, because a refuge has no coordinates to coarsen', () => {
    /*
     * Not a rule of its own. `confidential.ts` strips lat/lon from a `dv` record at parse and
     * again at read, so it arrives here without a position and is refused for that -- one
     * protection already in force, doing a second job.
     */
    const refuge = place({ type: 'dv', lat: undefined, lon: undefined });
    const a = anchorFromRecord(refuge);
    expect(a.ok).toBe(false);
    if (a.ok) return;
    expect(a.because).toMatch(/no position on record/i);
  });

  it('refuses a record nobody has placed yet, rather than inventing a cell', () => {
    expect(anchorFromRecord(place({ lat: undefined })).ok).toBe(false);
    expect(anchorFromRecord(place({ lon: undefined })).ok).toBe(false);
  });

  it('refuses a record with no region, because nobody could ask for it by metro', () => {
    expect(anchorFromRecord(place({ region: undefined })).ok).toBe(false);
  });

  it('refuses a position that is not a position', () => {
    expect(anchorFromRecord(place({ lat: 91 })).ok).toBe(false);
    expect(anchorFromRecord(place({ lon: 200 })).ok).toBe(false);
  });

  it('builds an observation that reads back, end to end', () => {
    const a = anchorFromRecord(place());
    if (!a.ok) throw new Error(a.because);
    const event = overRelay(
      buildObservation(contact, seen({ anchor: a.anchor }), a.where, T, a.region)
    );
    const read = readObservation(event)!;
    expect(read.observation.anchor).toBe('st-louis/st-patrick-center');
    expect(read.where).toEqual(a.where);
  });
});

describe('retention drops what we hold, and cannot delete what is published', () => {
  const old = { at: T - RETENTION_DAYS * 24 * 3600 - 1 };
  const recent = { at: T - 3600 };

  it('drops an uncorroborated, uncited observation after the window', () => {
    expect(reapObservations([old, recent], T)).toEqual([recent]);
  });

  it('keeps one that was corroborated, and one that was cited', () => {
    const kept = [
      { ...old, corroborated: true },
      { ...old, cited: true }
    ];
    expect(reapObservations(kept, T)).toHaveLength(2);
  });

  it('reuses the window the accountability tier already has', () => {
    expect(RETENTION_DAYS).toBe(90);
    expect(spec()).toMatch(/dropped from local stores after\s*\n?\s*90 days/i);
  });

  it('is described as dropping rather than expiring, which no relay would honour', () => {
    expect(spec()).toMatch(/dropped, not deleted/i);
  });
});

describe('the vocabulary is a placeholder and says so', () => {
  it('is marked as needing human authorship in the spec', () => {
    expect(spec()).toMatch(/STUB, needs human authorship/i);
  });

  it('has no term that could describe a person', () => {
    const words = OBSERVATION_TAGS.join(' ');
    expect(words).not.toMatch(/male|female|man|woman|person|people|age|race|jacket|hair|build/i);
  });

  it('can express nothing_observed, so an empty patrol is reportable', () => {
    expect(OBSERVATION_TAGS).toContain('nothing_observed');
  });
});

describe('the vocabulary in code is the vocabulary in the spec', () => {
  /*
   * Two copies existed and nothing compared them.
   *
   * `/.well-known/navcom-intel.json` parses its vocabulary out of §7's fenced block -- a test
   * over there asserts it is "read out of the spec, not retyped" -- while this module retypes
   * the same twenty terms by hand. So the list an operator's app validates against and the
   * list NavCom publishes to every consumer could disagree, and the first symptom would be an
   * observation that refuses to publish for a term the spec says is valid.
   *
   * Parsed here exactly as the publisher parses it, including the anchor to `## 7.` that the
   * publisher learned to use after a fence added elsewhere in the spec silently emptied the
   * whole vocabulary.
   */
  const fromSpec = (): Record<string, string[]> => {
    const section = spec().split(/^## 7\./m)[1] ?? '';
    const block = /```\n([\s\S]*?)```/.exec(section)?.[1] ?? '';
    const out: Record<string, string[]> = {};
    for (const line of block.split('\n')) {
      const m = /^(\w+)\s+(.+)$/.exec(line);
      if (m) out[m[1]] = m[2].split('\u00b7').map((t) => t.trim()).filter(Boolean);
    }
    return out;
  };

  it('parses something at all, so an empty read cannot pass as agreement', () => {
    // The failure this is shaped around emptied the vocabulary rather than changing it, and an
    // empty list equals an empty list.
    const parsed = fromSpec();
    expect(Object.keys(parsed).length).toBeGreaterThan(3);
    expect(Object.values(parsed).flat().length).toBeGreaterThan(15);
  });

  it('agrees with the spec, group for group and term for term', () => {
    const parsed = fromSpec();
    const mine = Object.fromEntries(
      Object.entries(OBSERVATION_VOCABULARY).map(([g, t]) => [g, [...t]])
    );
    expect(mine).toEqual(parsed);
  });

  it('has a name for every term, and names nothing that is not a term', () => {
    const unnamed = OBSERVATION_TAGS.filter((t) => observationLabel(t) === null);
    expect(unnamed, `these terms would render with no label: ${unnamed.join(', ')}`).toEqual([]);

    const orphan = Object.keys(OBSERVATION_LABELS).filter((t) => !OBSERVATION_TAGS.includes(t));
    expect(orphan, `labels for terms no longer in the vocabulary: ${orphan.join(', ')}`).toEqual([]);
  });

  it('refuses to name a term it does not know, rather than echoing it back', () => {
    // Refuse, do not trim. A relay serves whatever anybody published, so an id arriving here
    // can be a newer vocabulary, a typo, or somebody testing what the screen will repeat.
    expect(observationLabel('definitely_not_a_term')).toBeNull();
    expect(observationLabel('<script>')).toBeNull();
    expect(observationMethodLabel('guessed')).toBeNull();
  });

  it('names every method, and grades none of them', () => {
    for (const m of OBSERVATION_METHODS) expect(observationMethodLabel(m)).toBeTruthy();
    const words = Object.values(OBSERVATION_METHOD_LABELS).join(' ');
    expect(words).not.toMatch(/confirmed|verified|reliable|unreliable|weak|strong|likely/i);
  });
});
