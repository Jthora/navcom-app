import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { KIND_CREW_STATEMENT, KIND_SIGNAL } from '../src/events/kinds.js';
import {
  MAX_PARENTS,
  STATEMENT_TAG,
  StatementError,
  actClass,
  checkCompact,
  compactOf,
  contentOf,
  needsCosign,
  readStatement,
  reasonHash,
  rootIdOf,
  signStatement,
  type Statement
} from '../src/units/statements.js';

/**
 * Every unit statement is read here before anything else looks at it. Failure paths first: what it
 * refuses, and that it never throws doing so.
 */

const sk = generateSecretKey();
const pk = getPublicKey(sk);
const other = getPublicKey(generateSecretKey());
const U = 'a1'.repeat(16);
const H = (n: number) => n.toString(16).padStart(64, '0');
const P = [H(1), H(2)];
const SIG = 'e'.repeat(128);
const C = [other, 1_800_000_000, SIG] as const;
const REASON = reasonHash('kept missing the handover');
const AT = 1_800_000_000;

const snapshot = {
  rule: 'g1' as const, roster: H(9),
  co: { holder: pk, acting: false, n: 1, start: AT, end: AT + 100 },
  xo: { holder: other, acting: false, n: 1, start: AT, end: AT + 100 },
  cap: { holder: pk, count: 1 }, petitioned: [], runs: [], recalled: [], removed: [], holding: [], invited: [],
  prevCommand: null
};

/** One valid statement of every type. */
const samples: Statement[] = [
  { t: 'found', unit: U, code: 'nu1.g1.p.a.4.-.-.-.w.n.i.-', role: 'member', other, callsign: 'Kestrel', former: null },
  { t: 'admit', unit: U, prev: P, key: other, callsign: 'Wren', readmits: null },
  { t: 'invite', unit: U, prev: P, former: other },
  { t: 'accept', unit: U, prev: P, invite: H(3), callsign: 'Raven', former: C },
  { t: 'remove', unit: U, prev: P, keys: [other], reason: REASON },
  { t: 'leave', unit: U, prev: P },
  { t: 'vacate', unit: U, prev: P, office: 'co' },
  { t: 'open', unit: U, prev: P, office: 'xo' },
  { t: 'petition', unit: U, prev: P, office: 'co', subject: other, reason: REASON },
  { t: 'result', unit: U, prev: P, run: H(4), candidate: other, rule: 'g1', digest: H(5), stand: [AT, SIG], sigs: [C] },
  { t: 'recall', unit: U, prev: P, petition: H(6), rule: 'g1', digest: H(7), sigs: [C] },
  { t: 'endorse', unit: U, run: H(4), candidate: other },
  { t: 'stand', unit: U, run: H(4) },
  { t: 'support', unit: U, petition: H(6) },
  { t: 'sign', unit: U, act: H(8) },
  { t: 'checkpoint', unit: U, head: [H(1)], snapshot },
  { t: 'refound-by', unit: U, lineage: '0f'.repeat(16), key: other },
  { t: 'accept-by', unit: U, invite: H(3), key: other }
];

/** Signs arbitrary content, bypassing the builder's checks: what a hand-rolled client can do. */
const raw = (content: unknown, kind = KIND_CREW_STATEMENT, tags: string[][] = []) =>
  finalizeEvent({ kind, created_at: AT, tags, content: typeof content === 'string' ? content : JSON.stringify(content) }, sk);

const refuses = (e: unknown, reason: string) => {
  let r: ReturnType<typeof readStatement> | undefined;
  expect(() => { r = readStatement(e); }).not.toThrow();
  expect(r).toEqual({ ok: false, reason });
};

describe('F: every type refuses a damaged copy, without throwing', () => {
  for (const s of samples) {
    describe(s.t, () => {
      const good = () => contentOf(s);

      it('another kind', () => refuses(raw(good(), KIND_SIGNAL), 'wrong-kind'));

      it('content changed after signing (a JSON clone)', () => {
        const e = JSON.parse(JSON.stringify(signStatement(sk, s, AT)));
        const a = JSON.parse(e.content);
        a.push('x');
        refuses({ ...e, content: JSON.stringify(a) }, 'bad-signature');
      });

      it('a signed event changed in place (the verifiedSymbol trap)', () => {
        const e = signStatement(sk, s, AT);
        expect(readStatement(e).ok).toBe(true); // nostr-tools now caches "verified" on `e`
        e.content = JSON.stringify([...good(), 'x']);
        refuses(e, 'bad-signature');
        const f = signStatement(sk, s, AT);
        readStatement(f);
        f.created_at += 1;
        refuses(f, 'bad-signature');
      });

      it('the wrong tag', () => refuses(raw(['navcom-unit-v2', ...good().slice(1)]), 'malformed'));

      it('a unit id that is not one', () => {
        const a = good();
        a[2] = 'A1'.repeat(16);
        refuses(raw(a), 'malformed');
        a[2] = 'a1'.repeat(15);
        refuses(raw(a), 'malformed');
      });

      it('one field more, or one fewer', () => {
        refuses(raw([...good(), null]), 'malformed');
        refuses(raw(good().slice(0, -1)), 'malformed');
      });

      it('a tag on the event', () => refuses(raw(good(), KIND_CREW_STATEMENT, [['p', other]]), 'malformed'));

      it('non-canonical JSON', () => refuses(raw(JSON.stringify(good(), null, 1)), 'malformed'));
    });
  }

  it('reads every sample back exactly', () => {
    for (const s of samples) {
      const e = signStatement(sk, s, AT);
      const r = readStatement(e);
      expect(r).toEqual({ ok: true, id: e.id, pubkey: pk, createdAt: AT, statement: s });
    }
  });

  it('anything that is not an event', () => {
    for (const x of [undefined, null, 1, 'x', [], {}, { id: 'x' }]) refuses(x, 'malformed');
  });
});

describe('F: fields', () => {
  const admit = contentOf(samples[1]!);
  const remove = contentOf(samples[4]!);
  const withAt = (a: unknown[], i: number, v: unknown) => {
    const b = [...a];
    b[i] = v;
    return b;
  };

  it('keys: upper case, short, or not a string', () => {
    refuses(raw(withAt(admit, 4, other.toUpperCase())), 'malformed');
    refuses(raw(withAt(admit, 4, other.slice(1))), 'malformed');
    refuses(raw(withAt(admit, 4, 7)), 'malformed');
  });

  it('prev: empty, more than four, unsorted, duplicated', () => {
    refuses(raw(withAt(admit, 3, [])), 'malformed');
    refuses(raw(withAt(admit, 3, [H(1), H(2), H(3), H(4), H(5)])), 'malformed');
    refuses(raw(withAt(admit, 3, [H(2), H(1)])), 'malformed');
    refuses(raw(withAt(admit, 3, [H(1), H(1)])), 'malformed');
    expect(readStatement(raw(withAt(admit, 3, [H(1), H(2), H(3), H(4)]))).ok).toBe(true);
    expect(MAX_PARENTS).toBe(4);
  });

  it('callsigns: empty, over 48, control characters, padded', () => {
    refuses(raw(withAt(admit, 5, '')), 'malformed');
    refuses(raw(withAt(admit, 5, 'x'.repeat(49))), 'malformed');
    refuses(raw(withAt(admit, 5, 'Wr\u0000en')), 'malformed');
    refuses(raw(withAt(admit, 5, 'Wren\u202e')), 'malformed');
    refuses(raw(withAt(admit, 5, ' Wren')), 'malformed');
  });

  it('a reason that is not a hash', () => {
    refuses(raw(withAt(remove, 5, 'because I said so')), 'malformed');
    refuses(raw(withAt(remove, 5, H(1).slice(2))), 'malformed');
  });

  it('removed keys unsorted or repeated', () => {
    const [a, b] = [pk, other].sort();
    refuses(raw(withAt(remove, 4, [b, a])), 'malformed');
    refuses(raw(withAt(remove, 4, [a, a])), 'malformed');
    refuses(raw(withAt(remove, 4, [])), 'malformed');
  });

  it('a result with no signatures, or a rule that is not one', () => {
    const result = contentOf(samples[9]!);
    refuses(raw(withAt(result, 9, [])), 'malformed');
    refuses(raw(withAt(result, 6, 'majority')), 'malformed');
    // A later rule code reads, so the evaluator can say "phones disagree" rather than "garbage".
    expect(readStatement(raw(withAt(result, 6, 'g2'))).ok).toBe(true);
  });

  it('times that are not whole seconds', () => {
    const e = finalizeEvent({ kind: KIND_CREW_STATEMENT, created_at: 1.5, tags: [], content: JSON.stringify(admit) }, sk);
    refuses(e, 'malformed');
    const c = contentOf(samples[3]!);
    refuses(raw(withAt(c, 6, [other, -1, SIG])), 'malformed');
  });

  it('the builder refuses what the reader would', () => {
    expect(() => signStatement(sk, { ...samples[1]!, callsign: '' } as Statement, AT)).toThrow(StatementError);
    expect(() => signStatement(sk, { ...samples[1]!, prev: [] } as Statement, AT)).toThrow(StatementError);
    expect(() => signStatement(sk, samples[1]!, -5)).toThrow(StatementError);
  });
});

describe('F2: what the menu leaves out has no statement', () => {
  it.each([
    'close', 'tally', 'teller', 'lot', 'rank', 'appoint', 'nominate', 'against', 'abstain', 'window', 'deadline',
    'blind', 'ring'
  ])('%s reads as an act this release does not know', (t) => {
    refuses(raw([STATEMENT_TAG, t, U, P, other]), 'unknown-act');
  });

  it('an endorsement of two candidates at once', () => {
    refuses(raw([STATEMENT_TAG, 'endorse', U, H(4), [other, pk]]), 'malformed');
  });

  it('a vacate that names a successor', () => {
    refuses(raw([STATEMENT_TAG, 'vacate', U, P, 'co', other]), 'malformed');
  });

  it('an admission flagged as an agent', () => {
    refuses(raw([...contentOf(samples[1]!), 'agent']), 'malformed');
    refuses(raw([...contentOf(samples[1]!), { agent: true }]), 'malformed');
  });

  it('a type that is not a word', () => {
    refuses(raw([STATEMENT_TAG, 'Close Now!', U]), 'malformed');
  });

  it('a compact signature reused for another run, candidate or unit fails', () => {
    const endorse = { t: 'endorse' as const, unit: U, run: H(4), candidate: other };
    const e = signStatement(sk, endorse, AT);
    const c = compactOf(e);
    expect(checkCompact(c, endorse)).toBe(true);
    expect(checkCompact(c, { ...endorse, run: H(5) })).toBe(false);
    expect(checkCompact(c, { ...endorse, candidate: pk })).toBe(false);
    expect(checkCompact(c, { ...endorse, unit: 'b2'.repeat(16) })).toBe(false);
    expect(checkCompact([c[0], c[1] + 1, c[2]], endorse)).toBe(false);
    expect(checkCompact([other, c[1], c[2]], endorse)).toBe(false);
    expect(checkCompact(['x', 1, 'y'] as never, endorse)).toBe(false);
  });
});

describe('the classes and second signers', () => {
  it('orders removals first and admissions last', () => {
    expect(actClass('remove')).toBe(0);
    expect(actClass('leave')).toBe(0);
    expect(actClass('result')).toBe(1);
    expect(actClass('recall')).toBe(2);
    expect(actClass('vacate')).toBe(3);
    expect(actClass('open')).toBe(4);
    expect(actClass('petition')).toBe(4);
    expect(actClass('admit')).toBe(5);
    expect(actClass('accept')).toBe(5);
  });

  it('asks a second signer for admit, invite and remove only', () => {
    expect(['admit', 'invite', 'remove'].every((t) => needsCosign(t as never))).toBe(true);
    expect(['leave', 'open', 'petition', 'result', 'recall', 'vacate', 'accept'].some((t) => needsCosign(t as never))).toBe(false);
  });

  it('roots on both founding statements, whichever phone computes it', () => {
    const sk2 = generateSecretKey();
    const a = signStatement(sk, { ...(samples[0] as Extract<Statement, { t: 'found' }>), other: getPublicKey(sk2) }, AT);
    const b = signStatement(sk2, { ...(samples[0] as Extract<Statement, { t: 'found' }>), other: pk }, AT);
    expect(rootIdOf(a, b)).toBe(rootIdOf(b, a));
    expect(rootIdOf(a, b)).toMatch(/^[0-9a-f]{64}$/);
    expect(() => rootIdOf(a, a)).toThrow(StatementError);
  });
});
