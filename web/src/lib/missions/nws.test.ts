/**
 * Weather warnings on a mission's screen [docs/design/map.md, Weather warnings on a mission]: the US
 * National Weather Service, asked for one state's issued warnings when a person taps, and never
 * otherwise. It informs and never gates: whether somebody takes the mission stays theirs
 * [invariants 8 and 9].
 *
 * Held here against the recorded fixture in the shape measured on 2026-10-19: which state a mission's
 * jurisdiction names, which alerts are warnings the NWS issued, their words as issued, and what a
 * failure says.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { areaOf, readWarnings, warningsOf } from './nws';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../e2e/fixtures/hazards/${name}.json`, import.meta.url), 'utf8'));

describe('which state a mission names', () => {
  it('names a US state or territory by its NWS area, and nothing else', () => {
    expect(areaOf('us-ca')).toEqual({ kind: 'state', area: 'CA', name: 'California' });
    expect(areaOf('us-pr')).toEqual({ kind: 'state', area: 'PR', name: 'Puerto Rico' });
    expect(areaOf('us-dc')).toEqual({ kind: 'state', area: 'DC', name: 'Washington, DC' });
    // Filed for the whole country: the NWS is asked by state, and this names none.
    expect(areaOf('us')).toEqual({ kind: 'national' });
    // Outside the US no warning service is read, and the place is named as the mission files it.
    expect(areaOf('ke')).toEqual({ kind: 'elsewhere', name: 'Kenya' });
    expect(areaOf('ke-30')).toEqual({ kind: 'elsewhere', name: 'Kenya' });
    // A code NavCom does not know is asked for nothing, rather than sent as it came.
    expect(areaOf('us-xx')).toEqual({ kind: 'unknown' });
    expect(areaOf('us-ca&x=1')).toEqual({ kind: 'unknown' });
    expect(areaOf(null)).toEqual({ kind: 'unknown' });
  });
});

describe('which alerts are warnings it issued', () => {
  it('keeps actual warnings, not watches, advisories, cancellations or tests, each as issued', () => {
    const issued = warningsOf(fixture('nws-ca'));
    const warnings = issued!.warnings;
    expect(warnings.map((w) => w.event)).toEqual(['Tornado Warning', 'Red Flag Warning', 'Evacuation Immediate']);
    expect(warnings[0]).toEqual({
      id: 'urn:oid:2.49.0.1.840.0.fixture1',
      event: 'Tornado Warning',
      headline: 'Tornado Warning issued October 6 at 12:55PM PDT until October 6 at 1:30PM PDT by NWS Sacramento CA',
      area: 'Sacramento; Yolo',
      sender: 'NWS Sacramento CA',
      sent: '2026-10-06T12:55:00-07:00',
      ends: '2026-10-06T13:30:00-07:00',
      expires: '2026-10-06T13:30:00-07:00',
      at: Date.parse('2026-10-06T19:55:00Z')
    });
    // No end issued is said as that, beside when the message itself expires.
    expect(warnings[1]!.ends).toBeNull();
    expect(warnings[1]!.expires).toBe('2026-10-07T18:00:00-07:00');
    // The watch and the advisory are not shown, and are counted; the cancellation and the test are neither.
    expect(issued!.others).toBe(2);
    expect(warningsOf(fixture('nws-empty'))).toEqual({ warnings: [], others: 0 });
  });

  it('keeps the emergencies the NWS relays that ask people to act now, though their names do not end in Warning', () => {
    const alert = (event: string, areaDesc: unknown = 'Butte') => ({
      properties: { id: `urn:${event}`, event, status: 'Actual', messageType: 'Alert', areaDesc, headline: `${event} issued by NWS Sacramento CA` }
    });
    const only = (event: string) => warningsOf({ type: 'FeatureCollection', features: [alert(event)] })!;
    // With only one of these out, the screen must never read "No warnings issued".
    for (const event of ['Evacuation Immediate', 'Civil Emergency Message', 'Local Area Emergency', '911 Telephone Outage Emergency']) {
      expect(only(event).warnings.map((w) => w.event), event).toEqual([event]);
    }
    // Not a hazard to a place: counted with the rest, never dropped silently.
    expect(only('Child Abduction Emergency')).toEqual({ warnings: [], others: 1 });
    expect(only('Special Weather Statement')).toEqual({ warnings: [], others: 1 });
    // The area as issued, cut with a visible … where it would not fit a screen, and never made up.
    const long = warningsOf({ features: [alert('Evacuation Immediate', 'County; '.repeat(80))] })!.warnings[0]!;
    expect(long.area!.length).toBe(300);
    expect(long.area!.endsWith('…')).toBe(true);
    expect(warningsOf({ features: [alert('Evacuation Immediate', null)] })!.warnings[0]!.area).toBeNull();
  });

  it('takes nothing from an answer that is not the shape the NWS sends', () => {
    expect(warningsOf({ features: 'no' })).toBeNull();
    expect(warningsOf(null)).toBeNull();
    expect(warningsOf({ type: 'FeatureCollection', features: [{ properties: { event: 'Tornado Warning' } }] })).toEqual({ warnings: [], others: 0 });
  });
});

describe('asking', () => {
  it('asks one URL for one state, with no cookie and no referrer, and reads the answer', async () => {
    const asked: [string, RequestInit][] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      asked.push([url, init]);
      return new Response(JSON.stringify(fixture('nws-ca')), { status: 200 });
    }) as unknown as typeof fetch;
    const read = await readWarnings('CA', fetcher);
    expect(asked).toHaveLength(1);
    expect(asked[0]![0]).toBe('https://api.weather.gov/alerts/active?area=CA');
    expect(asked[0]![1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Accept: 'application/geo+json' } });
    expect(read.ok && read.warnings.map((w) => w.event)).toEqual(['Tornado Warning', 'Red Flag Warning', 'Evacuation Immediate']);
    expect(read.ok && read.others).toBe(2);
  });

  it('says it could not read, rather than that nothing was issued', async () => {
    const down = (async () => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
    expect(await readWarnings('CA', down)).toEqual({ ok: false, why: 'failed' });
    const wrong = (async () => new Response('{"features":"no"}', { status: 200 })) as unknown as typeof fetch;
    expect(await readWarnings('CA', wrong)).toEqual({ ok: false, why: 'failed' });
    const refused = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    expect(await readWarnings('CA', refused)).toEqual({ ok: false, why: 'failed' });
    await expect(readWarnings('ca', down)).rejects.toThrow(/not an NWS area/);
  });
});
