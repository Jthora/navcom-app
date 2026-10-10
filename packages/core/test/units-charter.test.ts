import { describe, expect, it } from 'vitest';
import {
  ARTICLES_HASH_PLACEHOLDER,
  CHARTER_FORMAT,
  CharterError,
  ROOMS,
  addMonthsUTC,
  articlesStatus,
  charterCode,
  charterId,
  leafEchelon,
  lineageOf,
  readCharter,
  sameCharter,
  thresholdOf,
  threeQuartersOf,
  type Charter,
  type Governance
} from '../src/units/charter.js';
import { CREW_ROOM_MAX } from '../src/limits.js';

/**
 * The charter code is the unit's identity: founders sign exactly it, and a phone reads it before
 * anybody shows anything back. So what matters most is what it refuses, and how it says so.
 */

const EA = `e${ARTICLES_HASH_PLACEHOLDER}`;
const OTHER_HASH = 'ab'.repeat(32);
const LINEAGE = '0123456789abcdef0123456789abcdef';

/** A valid Led code with one field replaced, by index (0-based, of the 12 fields). */
const base = ['nu1', 'g1', 'm', 'l', '12', 'm', '12', '2', 'w', 'y', EA, '-'];
const withField = (index: number, value: string): string => {
  const f = [...base];
  f[index] = value;
  return f.join('.');
};
const anyTwo = ['nu1', 'g1', 'p', 'a', '8', '-', '-', '-', 'w', 'n', 'i', '-'];
const anyTwoWith = (index: number, value: string): string => {
  const f = [...anyTwo];
  f[index] = value;
  return f.join('.');
};

const led = (over: Partial<Charter> = {}, gov: Partial<Extract<Governance, { shape: 'led' }>> = {}): Charter => ({
  rule: 'g1',
  template: 'military',
  room: 12,
  governance: { shape: 'led', threshold: 'majority', term: 12, coCap: 'twoThenOut', ...gov },
  authority: 'word',
  higher: { mayServe: true, under: [], top: { kind: 'alliance', articles: ARTICLES_HASH_PLACEHOLDER } },
  lineage: null,
  ...over
});

describe('F1: off the menu, named by field', () => {
  it.each(['0', '5', '16', '32'])('room %s', (room) => {
    expect(readCharter(withField(4, room))).toEqual({ ok: false, reason: 'off-menu', field: 'room' });
  });

  it.each(['0', '6', '18', '36'])('term %s months', (term) => {
    expect(readCharter(withField(6, term))).toEqual({ ok: false, reason: 'off-menu', field: 'term' });
  });

  // quorum, ballots cast, half, unanimous: none is a threshold a phone can enforce.
  it.each(['q', 'b', 'h', 'u'])('threshold letter %s', (letter) => {
    expect(readCharter(withField(5, letter))).toEqual({ ok: false, reason: 'off-menu', field: 'threshold' });
  });

  it('a CO cap of three', () => {
    expect(readCharter(withField(7, '3'))).toEqual({ ok: false, reason: 'off-menu', field: 'cap' });
  });

  it('rotation as a leaf shape', () => {
    expect(readCharter(withField(3, 'r'))).toEqual({ ok: false, reason: 'off-menu', field: 'shape' });
  });

  it('an authority letter that is not word, orders or orders naming a member', () => {
    expect(readCharter(withField(8, 'k'))).toEqual({ ok: false, reason: 'off-menu', field: 'authority' });
  });
});

describe('F2: what a phone cannot enforce has nowhere to go', () => {
  it.each(['window', 'quorum', 'ranked', 'secret', 'deadline'])('a trailing %s field is malformed', (extra) => {
    expect(readCharter(`${base.join('.')}.${extra}`)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('a missing field is malformed', () => {
    expect(readCharter(base.slice(0, 11).join('.'))).toEqual({ ok: false, reason: 'malformed' });
  });

  it('cannot be written as a Charter at all', () => {
    // These are compile-time checks: `npm run check` covers test/, so each line must fail to type.
    // @ts-expect-error a voting window is not a field
    const a: Charter = { ...led(), window: 7 };
    // @ts-expect-error a quorum is not a field
    const b: Charter = { ...led(), quorum: 3 };
    // @ts-expect-error ballots cast is not counted
    const c: Charter = { ...led(), ballotsCast: true };
    // @ts-expect-error no secret ballot
    const d: Charter = { ...led(), secret: true };
    // @ts-expect-error no ranked rounds
    const e: Charter = { ...led(), ranked: true };
    // @ts-expect-error an Any two unit carries no threshold
    const f: Governance = { shape: 'anyTwo', threshold: 'majority' };
    // @ts-expect-error an Any two unit carries no term
    const g: Governance = { shape: 'anyTwo', term: 12 };
    // @ts-expect-error an Any two unit carries no cap
    const h: Governance = { shape: 'anyTwo', coCap: 'none' };
    // @ts-expect-error a Led unit cannot express no term
    const i: Governance = { shape: 'led', threshold: 'majority', term: null, coCap: 'none' };
    // @ts-expect-error a Led unit cannot express no recall, or any other term
    const j: Governance = { shape: 'led', threshold: 'majority', term: 36, coCap: 'none' };
    expect([a, b, c, d, e, f, g, h, i, j]).toHaveLength(10);
  });

  it('refuses the same extra fields on a hand-built object at run time', () => {
    for (const extra of ['window', 'quorum', 'ballotsCast', 'secret', 'ranked']) {
      expect(() => charterCode({ ...led(), [extra]: 1 } as Charter)).toThrow(CharterError);
    }
    expect(() =>
      charterCode({ ...led(), governance: { shape: 'anyTwo', threshold: 'majority' } } as unknown as Charter)
    ).toThrow(CharterError);
  });
});

describe('F3: a newer release, not an error', () => {
  it('a newer format', () => {
    expect(readCharter(withField(0, 'nu2'))).toEqual({ ok: false, reason: 'needs-update', field: 'format' });
    // Even with a different number of fields: a later format may have any shape.
    expect(readCharter('nu2.something.else')).toEqual({ ok: false, reason: 'needs-update', field: 'format' });
  });

  it('a newer rule', () => {
    expect(readCharter(withField(1, 'g2'))).toEqual({ ok: false, reason: 'needs-update', field: 'rule' });
  });

  it.each(['i', 'a', 'q'])('template %s', (tpl) => {
    expect(readCharter(withField(2, tpl))).toEqual({ ok: false, reason: 'needs-update', field: 'template' });
  });

  it('an echelon marker this release does not know', () => {
    expect(readCharter(withField(9, 'y').replace(`.${EA}.`, `.pz${EA}.`))).toEqual({
      ok: false,
      reason: 'needs-update',
      field: 'higher'
    });
  });

  it('never throws, and caps what it parses', () => {
    const inputs: unknown[] = [
      undefined, null, 0, {}, [], '', '.', '...........', 'x'.repeat(10_000), `${base.join('.')}${' '.repeat(10_000)}`
    ];
    for (let i = 0; i < 500; i++) {
      const len = Math.floor(Math.random() * 200);
      let s = '';
      for (let j = 0; j < len; j++) s += String.fromCharCode(32 + Math.floor(Math.random() * 95));
      inputs.push(s);
    }
    for (const input of inputs) {
      const read = readCharter(input);
      expect(read.ok).toBe(false);
    }
    expect(readCharter('x'.repeat(10_000))).toEqual({ ok: false, reason: 'malformed' });
    // Long but otherwise plausible: still refused before parsing.
    expect(readCharter(`${base.join('.')}${'.-'.repeat(40)}`)).toEqual({ ok: false, reason: 'malformed' });
  });
});

describe('F4: pairings the menu does not allow', () => {
  it('Military with Any two', () => {
    expect(readCharter(anyTwoWith(2, 'm'))).toEqual({ ok: false, reason: 'off-menu', field: 'shape' });
  });

  it('Any two carrying a Led row', () => {
    expect(readCharter(anyTwoWith(5, 'm'))).toEqual({ ok: false, reason: 'off-menu', field: 'threshold' });
    expect(readCharter(anyTwoWith(6, '12'))).toEqual({ ok: false, reason: 'off-menu', field: 'term' });
    expect(readCharter(anyTwoWith(7, 'n'))).toEqual({ ok: false, reason: 'off-menu', field: 'cap' });
  });

  it('Any two with orders, or able to serve under a higher unit', () => {
    expect(readCharter(anyTwoWith(8, 'o'))).toEqual({ ok: false, reason: 'off-menu', field: 'authority' });
    expect(readCharter(anyTwoWith(8, 'n'))).toEqual({ ok: false, reason: 'off-menu', field: 'authority' });
    expect(readCharter(anyTwoWith(9, 'y'))).toEqual({ ok: false, reason: 'off-menu', field: 'serve' });
  });

  it('Led with a row left out', () => {
    expect(readCharter(withField(5, '-'))).toEqual({ ok: false, reason: 'off-menu', field: 'threshold' });
    expect(readCharter(withField(6, '-'))).toEqual({ ok: false, reason: 'off-menu', field: 'term' });
    expect(readCharter(withField(7, '-'))).toEqual({ ok: false, reason: 'off-menu', field: 'cap' });
  });

  it('markers out of order, or too many', () => {
    expect(readCharter(withField(10, `cp${EA}`))).toEqual({ ok: false, reason: 'off-menu', field: 'higher' });
    expect(readCharter(withField(10, `pp${EA}`))).toEqual({ ok: false, reason: 'off-menu', field: 'higher' });
    // Revised with the units-core-attack repair (BREAK 15): a sixth marker in a letter this release
    // does not know is a later release's echelon, so it reads as needing an update, not off the menu.
    expect(readCharter(withField(10, `pcbxdz${EA}`))).toEqual({ ok: false, reason: 'needs-update', field: 'higher' });
    // Six markers this release knows can only repeat one, and are off the menu.
    expect(readCharter(withField(10, `pcbxdd${EA}`))).toEqual({ ok: false, reason: 'off-menu', field: 'higher' });
  });

  it('markers on a unit that may not serve under anyone', () => {
    expect(readCharter(withField(9, 'n').replace(`.${EA}.`, `.p${EA}.`))).toEqual({
      ok: false,
      reason: 'off-menu',
      field: 'higher'
    });
  });

  it('a named higher reads, so a later summary can reuse it (the evaluator refuses it at founding)', () => {
    const read = readCharter(withField(10, `pc${EA}`));
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.charter.higher.under).toEqual(['platoon', 'company']);
  });
});

describe('F5: one spelling per charter', () => {
  it.each([
    ['uppercase Articles hash', withField(10, `e${'AB'.repeat(32)}`)],
    ['a room with a leading zero', withField(4, '08')],
    ['a space', ` ${base.join('.')}`],
    ['a space inside', withField(4, ' 12')],
    ['a 63-hex Articles hash', withField(10, `e${'1'.repeat(63)}`)],
    ['a 65-hex Articles hash', withField(10, `e${'1'.repeat(65)}`)],
    ['a 65-hex Articles hash starting with e', withField(10, `e${'e'.repeat(65)}`)],
    ['a 31-hex lineage', withField(11, '1'.repeat(31))],
    ['a 33-hex lineage', withField(11, '1'.repeat(33))],
    ['an uppercase lineage', withField(11, 'A'.repeat(32))],
    ['an empty field', withField(8, '')]
  ])('%s is malformed', (_name, code) => {
    expect(readCharter(code)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('charterCode throws on a hand-built object off the menu', () => {
    expect(() => charterCode({ ...led(), room: 5 as never })).toThrow(CharterError);
    expect(() => charterCode(led({}, { term: 18 as never }))).toThrow(CharterError);
    expect(() => charterCode({ ...led(), template: 'incident' as never })).toThrow(CharterError);
    expect(() => charterCode({ ...led(), lineage: 'AB'.repeat(16) })).toThrow(CharterError);
    expect(() => charterCode({ ...led(), rule: 'g2' as never })).toThrow(CharterError);
    expect(() =>
      charterCode({ ...led(), template: 'military', governance: { shape: 'anyTwo' } })
    ).toThrow(CharterError);
    expect(() => charterCode(null as never)).toThrow(CharterError);
  });
});

describe('H: every configuration round-trips to one code', () => {
  const tops = [
    { kind: 'independent' } as const,
    { kind: 'alliance', articles: ARTICLES_HASH_PLACEHOLDER } as const,
    { kind: 'alliance', articles: OTHER_HASH } as const
  ];

  it('every Led configuration, template, room, authority, top and lineage', () => {
    let count = 0;
    for (const threshold of ['majority', 'twoThirds'] as const)
      for (const term of [12, 24] as const)
        for (const coCap of ['none', 'twoThenOut'] as const)
          for (const template of ['military', 'plain'] as const)
            for (const room of ROOMS)
              for (const authority of ['word', 'orders', 'ordersNamed'] as const)
                for (const top of tops)
                  for (const lineage of [null, LINEAGE]) {
                    const c: Charter = {
                      rule: 'g1', template, room, authority, lineage,
                      governance: { shape: 'led', threshold, term, coCap },
                      higher: { mayServe: true, under: [], top }
                    };
                    const code = charterCode(c);
                    const read = readCharter(code);
                    expect(read).toEqual({ ok: true, charter: c, code });
                    expect(charterCode(read.ok ? read.charter : c)).toBe(code);
                    count++;
                  }
    expect(count).toBe(2 * 2 * 2 * 2 * 4 * 3 * 3 * 2);
  });

  it('Any two, both ways of saying where it stands', () => {
    for (const top of tops) {
      for (const room of ROOMS) {
        const c: Charter = {
          rule: 'g1', template: 'plain', room, authority: 'word', lineage: null,
          governance: { shape: 'anyTwo' }, higher: { mayServe: false, under: [], top }
        };
        expect(readCharter(charterCode(c))).toEqual({ ok: true, charter: c, code: charterCode(c) });
      }
    }
  });

  it('the example in the plan reads as written', () => {
    const code = `nu1.g1.m.l.12.m.12.2.w.y.e${'0'.repeat(64)}.-`;
    const read = readCharter(code);
    expect(read.ok && read.charter).toEqual(led());
    expect(code.startsWith(`${CHARTER_FORMAT}.`)).toBe(true);
  });

  it('the longest code is 128 characters', () => {
    const worst = charterCode(
      led(
        {
          room: 15,
          lineage: LINEAGE,
          higher: {
            mayServe: true,
            under: ['platoon', 'company', 'battalion', 'brigade', 'division'],
            top: { kind: 'alliance', articles: OTHER_HASH }
          }
        },
        { threshold: 'twoThirds', term: 24 }
      )
    );
    expect(worst.length).toBe(128);
  });

  it('ROOMS ends with the crew cap', () => {
    expect(ROOMS[ROOMS.length - 1]).toBe(CREW_ROOM_MAX);
    expect([...ROOMS]).toEqual([4, 8, 12, 15]);
  });

  it('charterId is the code’s hash, and sameCharter compares codes', () => {
    const a = charterCode(led());
    const b = charterCode(led({ room: 8 }));
    expect(charterId(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(charterId(a)).not.toBe(charterId(b));
    expect(sameCharter(a, a)).toBe(true);
    expect(sameCharter(a, b)).toBe(false);
    expect(sameCharter(a, `${a}.x`)).toBe(false);
  });
});

describe('the Articles hash', () => {
  it('reads the placeholder as a placeholder', () => {
    expect(ARTICLES_HASH_PLACEHOLDER).toBe('0'.repeat(64));
    expect(articlesStatus(led())).toBe('placeholder');
  });

  it('reads any other hash as other, and never refuses one: rival texts are allowed', () => {
    const c = led({ higher: { mayServe: true, under: [], top: { kind: 'alliance', articles: OTHER_HASH } } });
    expect(articlesStatus(c)).toBe('other');
    expect(readCharter(charterCode(c)).ok).toBe(true);
  });

  it('has no Articles status for an Independent unit', () => {
    expect(articlesStatus(led({ higher: { mayServe: true, under: [], top: { kind: 'independent' } } }))).toBeNull();
  });
});

describe('arithmetic', () => {
  it('reproduces the recall table (governance §4.3)', () => {
    // [electorate, majority, two-thirds]
    const table: [number, number, number][] = [
      [3, 2, 2],
      [5, 3, 4],
      [8, 5, 6],
      [11, 6, 8],
      [14, 8, 10]
    ];
    for (const [m, maj, two] of table) {
      expect(thresholdOf(m, 'majority')).toBe(maj);
      expect(thresholdOf(m, 'twoThirds')).toBe(two);
    }
  });

  it('three-quarters: 7 of 9, 12 of 15', () => {
    expect(threeQuartersOf(9)).toBe(7);
    expect(threeQuartersOf(15)).toBe(12);
  });

  it('never asks for fewer than one signature', () => {
    expect(thresholdOf(0, 'twoThirds')).toBe(1);
    expect(thresholdOf(1, 'majority')).toBe(1);
    expect(threeQuartersOf(0)).toBe(1);
  });

  it('adds calendar months in UTC and clamps to the end of the month', () => {
    const jan31 = Date.UTC(2027, 0, 31, 13, 5, 9) / 1000;
    expect(addMonthsUTC(jan31, 1)).toBe(Date.UTC(2027, 1, 28, 13, 5, 9) / 1000);
    expect(addMonthsUTC(Date.UTC(2028, 0, 31) / 1000, 1)).toBe(Date.UTC(2028, 1, 29) / 1000);
    expect(addMonthsUTC(Date.UTC(2027, 2, 9) / 1000, 12)).toBe(Date.UTC(2028, 2, 9) / 1000);
    expect(addMonthsUTC(Date.UTC(2027, 10, 30) / 1000, 24)).toBe(Date.UTC(2029, 10, 30) / 1000);
  });

  it('names a leaf by its room', () => {
    expect(leafEchelon(4)).toBe('team');
    expect(leafEchelon(8)).toBe('squad');
    expect(leafEchelon(15)).toBe('squad');
  });
});

describe('lineage', () => {
  const old = 'fe'.repeat(16);

  it('is deterministic, 32 hex, and does not contain the old id', () => {
    expect(lineageOf(old)).toBe(lineageOf(old));
    expect(lineageOf(old)).toMatch(/^[0-9a-f]{32}$/);
    expect(lineageOf(old)).not.toContain(old);
    expect(lineageOf(old)).not.toBe(lineageOf('fd'.repeat(16)));
  });

  it('refuses something that is not a unit id', () => {
    expect(() => lineageOf('xyz')).toThrow(CharterError);
    expect(() => lineageOf('FE'.repeat(16))).toThrow(CharterError);
  });
});
