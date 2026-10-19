/**
 * The Spheres' membership lists, read by NavCom's own code [docs/design/map.md, Spheres; D9].
 *
 * Cited lists of countries, by ISO code, with no geometry of their own: the map draws each member over
 * the world's own outlines. Mecha Jono's Part 2 lists land on 26 Oct; until then this reads NavCom's
 * own fixture, in the shape Starcom's Spheres mode expects, and the vendoring refuses to ship it.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SPHERE_LISTS_EDITION, checkSpheres, isHttps } from '../src/spheres/index.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/spheres/manifest.json', import.meta.url));
const SOURCE = fileURLToPath(new URL('../src/spheres/', import.meta.url));
const fixture = () => JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, any>;

describe('reading the lists', () => {
  it('reads the fixture whole: three overlapping Spheres, each cited, codes lower-cased', () => {
    const { lists, problems } = checkSpheres(fixture());
    expect(problems).toEqual([]);
    expect(lists!.lists).toBe(SPHERE_LISTS_EDITION);
    expect(lists!.licence).toBe('CC-BY-4.0');
    expect(lists!.attribution).toBe('NavCom test fixture, never shipped');
    expect(lists!.unread).toBe(0);
    expect(lists!.spheres.map((s) => s.id)).toEqual(['sphere:test-anglosphere', 'sphere:test-francophonie', 'sphere:test-atlantic']);
    const anglo = lists!.spheres[0]!;
    expect(anglo.family).toBe('language');
    expect(anglo.members.map((m) => m.code)).toEqual(['gb', 'us', 'ca', 'ie', 'mt', 'sg', 'bb', 'mu']);
    expect(anglo.members[0]!.source).toBe("the fixture's own list");
    expect(anglo.groups).toEqual([{ id: 'core', name: 'Core', members: ['gb', 'us', 'ca'] }]);
    expect(anglo.sources).toEqual([{ name: 'NavCom test fixture', url: 'https://navcom.app/docs/design/map/', licence: 'CC-BY-4.0' }]);
    expect(anglo.read).toBe('2026-10-19');
    // Overlapping, as Spheres do: Canada is in all three.
    expect(lists!.spheres.filter((s) => s.members.some((m) => m.code === 'ca'))).toHaveLength(3);
  });

  it('refuses another edition, and anything that is not a list of Spheres at all', () => {
    expect(checkSpheres({ ...fixture(), lists: '2.0' }).lists).toBeNull();
    expect(checkSpheres({ ...fixture(), lists: '2.0' }).problems.join()).toMatch(/edition/);
    expect(checkSpheres(null).lists).toBeNull();
    expect(checkSpheres({ lists: '1.0' }).problems.join()).toMatch(/no spheres/i);
  });

  it('names every Sphere it cannot read, and counts it, rather than dropping it unsaid', () => {
    const m = fixture();
    m.spheres.push(
      { id: 'anglosphere', name: 'No prefix', family: 'language', members: [{ code: 'gb' }], sources: [{ name: 'x' }] },
      { id: 'sphere:bad-family', name: 'Bad family', family: 'religion', members: [{ code: 'gb' }], sources: [{ name: 'x' }] },
      { id: 'sphere:uncited', name: 'Uncited', family: 'political', members: [{ code: 'gb' }], sources: [] },
      { id: 'sphere:bad-code', name: 'Bad code', family: 'political', members: [{ code: 'gbr' }, { code: 'u1' }], sources: [{ name: 'x' }] },
      { id: 'sphere:test-atlantic', name: 'Twice', family: 'political', members: [{ code: 'gb' }], sources: [{ name: 'x' }] },
      { id: 'sphere:bad-read', name: 'Bad read date', family: 'political', members: [{ code: 'gb' }], sources: [{ name: 'x' }], read: '26 Oct' }
    );
    const { lists, problems } = checkSpheres(m);
    expect(lists!.spheres).toHaveLength(3);
    expect(lists!.unread).toBe(6);
    const said = problems.join('\n');
    expect(said).toMatch(/anglosphere.*sphere:<slug>/);
    expect(said).toMatch(/bad-family.*family/);
    expect(said).toMatch(/uncited.*cites no source/);
    expect(said).toMatch(/bad-code.*gbr.*u1/);
    expect(said).toMatch(/test-atlantic.*twice/);
    expect(said).toMatch(/bad-read.*read date/);
  });

  it('takes only a licence NavCom may vendor, for the lists and for every source that names one', () => {
    expect(checkSpheres({ ...fixture(), licence: 'CC-BY-SA-4.0' }).problems.join()).toMatch(/licensed/);
    expect(checkSpheres({ ...fixture(), licence: undefined }).problems.join()).toMatch(/licensed/);
    const m = fixture();
    m.spheres[0].sources[0].licence = 'CC-BY-NC-4.0';
    expect(checkSpheres(m).problems.join()).toMatch(/test-anglosphere.*CC-BY-NC-4.0/);
  });

  it('refuses a source whose link is not https: a javascript: or data: link would run in navcom.app’s origin', () => {
    for (const url of ['javascript:alert(document.cookie)', ' JavaScript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://example.org/list', 'vbscript:x', '//example.org', 'not a url']) {
      const m = fixture();
      m.spheres[0].sources[0].url = url;
      const { problems } = checkSpheres(m);
      expect(problems.join('\n'), url).toMatch(/test-anglosphere: source NavCom test fixture links to .*https or none/);
    }
    // An https link, and no link at all, are both fine.
    const m = fixture();
    m.spheres[0].sources[0].url = 'https://example.org/list?a=1#b';
    expect(checkSpheres(m).problems).toEqual([]);
    delete m.spheres[0].sources[0].url;
    expect(checkSpheres(m).problems).toEqual([]);
    expect(isHttps('HTTPS://EXAMPLE.ORG/')).toBe(true);
  });

  it('keeps a group to the Sphere’s own members', () => {
    const m = fixture();
    m.spheres[0].groups[0].members.push('fr');
    expect(checkSpheres(m).problems.join()).toMatch(/group core.*fr/);
  });
});

describe('NavCom’s reader is NavCom’s own', () => {
  it('carries no Starcom code: nothing under src/spheres names Starcom’s licence', () => {
    // Starcom is AGPL-3.0-only and NavCom Apache-2.0: the reader is written against the format, not copied.
    for (const f of readdirSync(SOURCE)) {
      const text = readFileSync(join(SOURCE, f), 'utf8');
      expect(text, f).not.toMatch(/AGPL|Affero|GNU General Public/i);
      expect(text, f).not.toMatch(/Copyright.*Starcom/i);
    }
  });
});
