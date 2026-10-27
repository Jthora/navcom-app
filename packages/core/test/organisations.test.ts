/**
 * The Organisations' membership lists, read by NavCom's own code [docs/design/map.md, Spheres].
 *
 * Cited lists of countries, each with its standing, and only a member drawn. This reads NavCom's own
 * fixture, in the shape Mecha Jono's Part 2 lists take, and the vendoring refuses to ship it.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DRAWN_STANDING, ORGANISATION_LISTS_EDITION, checkOrganisations } from '../src/organisations/index.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/organisations/manifest.json', import.meta.url));
const SOURCE = fileURLToPath(new URL('../src/organisations/', import.meta.url));
const fixture = () => JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, any>;

describe('reading the lists', () => {
  it('reads the fixture whole: each organisation cited, codes lower-cased, every standing kept', () => {
    const { lists, problems } = checkOrganisations(fixture());
    expect(problems).toEqual([]);
    expect(lists!.lists).toBe(ORGANISATION_LISTS_EDITION);
    expect(lists!.attribution).toBe('NavCom test fixture, never shipped');
    expect(lists!.organisations.map((o) => [o.id, o.kind, o.founded])).toEqual([
      ['union:test-alliance', 'alliance', '1949'],
      ['union:test-islands', 'forum', null]
    ]);
    const alliance = lists!.organisations[0]!;
    expect(alliance.members.map((m) => [m.code, m.status])).toEqual([
      ['gb', 'member'], ['us', 'member'], ['ca', 'member'], ['fr', 'member'], ['ua', 'candidate'], ['ie', 'partner']
    ]);
    expect(alliance.members[0]).toMatchObject({ since: '1949', source: "the fixture's own list" });
    expect(alliance.note).toMatch(/listed, not drawn/);
    expect(alliance.members.filter((m) => m.status === DRAWN_STANDING)).toHaveLength(4);
  });

  it('takes any one-word standing and lists it, and refuses one that is not a word', () => {
    const m = fixture();
    m.organisations[0].members[4].status = 'aspirant';
    expect(checkOrganisations(m).problems).toEqual([]);
    m.organisations[0].members[4].status = 'Aspiring Member';
    expect(checkOrganisations(m).problems.join()).toMatch(/ua: a standing is one lower-case word/);
  });

  it('refuses an organisation with no member to draw, one uncited, and a malformed id', () => {
    const m = fixture();
    for (const x of m.organisations[1].members) x.status = 'observer';
    m.organisations[0].sources = [];
    m.organisations.push({ id: 'nato', name: 'No prefix', kind: 'alliance', members: [{ code: 'gb', status: 'member' }], sources: [{ name: 'x' }] });
    const { lists, problems } = checkOrganisations(m);
    expect(problems.join('\n')).toMatch(/test-islands: has no member to draw/);
    expect(problems.join('\n')).toMatch(/test-alliance: cites no source/);
    expect(problems.join('\n')).toMatch(/nato: an id is union:<slug>/);
    expect(lists!.unread).toBe(3);
  });

  it('takes only a licence NavCom may vendor, and a source link only when it is https', () => {
    const m = fixture();
    m.licence = 'CC-BY-SA-4.0';
    m.organisations[0].sources.push({ name: 'A script', url: 'javascript:alert(1)' });
    const problems = checkOrganisations(m).problems.join('\n');
    expect(problems).toMatch(/licensed CC-BY-SA-4.0/);
    expect(problems).toMatch(/A script links to javascript/);
  });

  it('refuses another edition, and anything that is not a list of organisations', () => {
    expect(checkOrganisations({ ...fixture(), lists: '2.0' }).lists).toBeNull();
    expect(checkOrganisations({ lists: '1.0', organisations: [] }).problems).toEqual(['no organisations']);
  });
});

describe('NavCom’s reader is NavCom’s own', () => {
  it('carries no Starcom code: nothing under src/organisations names Starcom’s licence', () => {
    for (const f of readdirSync(SOURCE)) expect(readFileSync(join(SOURCE, f), 'utf8'), f).not.toMatch(/AGPL/);
  });
});
