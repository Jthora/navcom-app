/**
 * A watch handed over in one piece, scanned or pasted, and signed by the watch it names [G3;
 * `escalation.spec.md`, *It arrives scanned, never typed*].
 *
 * The escalation executor's key decides whose answer ends a `Distress`, and a typed one is wrong
 * often enough to matter: off the curve, it is read as none and the watch keeps the old rule without
 * a word; on it and nobody's, no answer could ever end a `Distress`. So it comes only in a code.
 *
 * And the code is signed. Unsigned, anybody could post a link naming an operator's own watch — its
 * address and relays are public — with a key of their own as its escalation key, and one tap on
 * Setup made their answer the one that ends that operator's `Distress` [review: live hole, phone].
 */
import { describe, expect, it } from 'vitest';
import { newSecretKey, publicKeyOf } from '@navcom/core';
import {
  WatchCodeError,
  codeChanges,
  escalationOf,
  looksLikeWatchCode,
  parseWatchCode,
  watchCode,
  watchCodeSignatureEvent
} from './watch-code';
import { finalizeEvent } from 'nostr-tools/pure';

const WATCH = newSecretKey();
const W = publicKeyOf(WATCH);
const X = publicKeyOf(newSecretKey());
const STRANGER = newSecretKey();
const S = publicKeyOf(STRANGER);
const H1 = publicKeyOf(newSecretKey());
const H2 = publicKeyOf(newSecretKey());
const AT = 1_790_000_000;

/** 64 hex characters that are not a point on the curve, found by trying. */
function offCurve(): string {
  const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
  for (let i = 5; ; i++) {
    const k = i.toString(16).padStart(64, '0');
    const x = BigInt('0x' + k);
    const c = (((x * x) % P) * x + 7n) % P;
    let r = 1n, b = c, e = (P + 1n) / 4n;
    while (e > 0n) { if (e & 1n) r = (r * b) % P; b = (b * b) % P; e >>= 1n; }
    if ((r * r) % P !== c) return k;
  }
}

/** A code's fragment with one parameter set to something else, everything else as signed. */
function altered(code: string, edit: (p: URLSearchParams) => void): string {
  const params = new URLSearchParams(code.split('#')[1]);
  edit(params);
  return `https://navcom.app/terminal/setup/#${params.toString()}`;
}

/** A code for these fields, signed by `secret` but claiming the watch `W` — as a stranger would make one. */
function signedByAnotherKey(secret: Uint8Array): string {
  const fields = { pubkey: W, relays: ['wss://r.example'], holders: [], executor: S };
  const signed = finalizeEvent(watchCodeSignatureEvent(fields, AT), secret);
  return `https://navcom.app/terminal/setup/#watch=1&w=${W}&r=wss%3A%2F%2Fr.example&x=${S}&t=${AT}&s=${signed.sig}`;
}

describe('a watch code', () => {
  it('carries a box’s address, relays and escalation key, signed and dated, and reads back the same', () => {
    const code = watchCode(
      { pubkey: W, relays: ['wss://relay.one.example', 'wss://relay.two.example/x?y=1'], holders: [], executor: X },
      WATCH,
      AT
    );
    expect(code.startsWith('https://navcom.app/terminal/setup/#watch=1&')).toBe(true);
    expect(parseWatchCode(code)).toEqual({
      pubkey: W,
      relays: ['wss://relay.one.example', 'wss://relay.two.example/x?y=1'],
      holders: [],
      executor: X,
      issuedAt: AT,
      text: code.split('#')[1]
    });
  });

  it('carries a squad’s holders, and no escalation key where the watch names none', () => {
    expect(parseWatchCode(watchCode({ pubkey: W, relays: ['wss://r.example'], holders: [H1, H2] }, WATCH, AT))).toMatchObject({
      pubkey: W,
      relays: ['wss://r.example'],
      holders: [H1, H2],
      issuedAt: AT
    });
  });

  it('is found inside whatever a messaging app wrapped round it, punctuation included, or as the bare fragment', () => {
    const code = watchCode({ pubkey: W, relays: ['wss://r.example'], holders: [], executor: X }, WATCH, AT);
    expect(parseWatchCode(`here you go: ${code} — see you at 9`).executor).toBe(X);
    for (const wrapped of [`Code: ${code}.`, `(${code})`, `<${code}>`, `“${code}”`, `${code}!`, `${code},`]) {
      expect(parseWatchCode(wrapped).executor, wrapped.slice(0, 8)).toBe(X);
    }
    expect(parseWatchCode(code.split('#')[1]!).pubkey).toBe(W);
    expect(looksLikeWatchCode(code)).toBe(true);
    expect(looksLikeWatchCode(W)).toBe(false);
  });

  it('keeps the relays exactly, so the last one is not handed a stray full stop', () => {
    const code = watchCode({ pubkey: W, relays: ['wss://r.example'], holders: [] }, WATCH, AT);
    expect(parseWatchCode(`${code}.`).relays).toEqual(['wss://r.example']);
  });
});

describe('a watch code the watch did not sign fills in nothing [review: live hole, phone]', () => {
  const good = () => watchCode({ pubkey: W, relays: ['wss://r.example'], holders: [], executor: X }, WATCH, AT);

  it('refuses one with no signature: anybody can write the address of somebody else’s watch', () => {
    const unsigned = altered(good(), (p) => {
      p.delete('s');
      p.delete('t');
    });
    expect(() => parseWatchCode(unsigned)).toThrow(WatchCodeError);
    expect(() => parseWatchCode(unsigned)).toThrow(/not signed by the watch/);
  });

  it('refuses a stranger’s key put in place of the escalation key of a code the watch did sign', () => {
    expect(() => parseWatchCode(altered(good(), (p) => p.set('x', S)))).toThrow(/not signed by the watch/);
  });

  it('refuses a holder or a relay added to a code the watch signed, or its date changed', () => {
    expect(() => parseWatchCode(altered(good(), (p) => p.append('h', S)))).toThrow(/not signed by the watch/);
    expect(() => parseWatchCode(altered(good(), (p) => p.append('r', 'wss://evil.example')))).toThrow(/not signed/);
    expect(() => parseWatchCode(altered(good(), (p) => p.set('t', String(AT + 1))))).toThrow(/not signed/);
    // An escalation key taken out is a change too: read as none, the watch would drop to the old rule.
    expect(() => parseWatchCode(altered(good(), (p) => p.delete('x')))).toThrow(/not signed/);
  });

  it('refuses one signed by any key but the watch’s own', () => {
    expect(() => parseWatchCode(signedByAnotherKey(STRANGER))).toThrow(/not signed by the watch/);
  });

  it('cannot be made by anybody but the watch', () => {
    expect(() => watchCode({ pubkey: W, relays: ['wss://r.example'], holders: [], executor: S }, STRANGER, AT)).toThrow(
      WatchCodeError
    );
  });
});

describe('what else a code can get wrong', () => {
  it('fills in nothing when its escalation key is not a key, even signed', () => {
    for (const bad of [offCurve(), X.slice(0, 63), 'g'.repeat(64), W]) {
      const code = altered(watchCode({ pubkey: W, relays: ['wss://r.example'], holders: [] }, WATCH, AT), (p) =>
        p.set('x', bad)
      );
      expect(() => parseWatchCode(code), bad).toThrow(WatchCodeError);
      expect(() => parseWatchCode(code)).toThrow(/escalation key/);
    }
    expect(() => watchCode({ pubkey: W, relays: ['wss://r.example'], holders: [], executor: W }, WATCH, AT)).toThrow(
      /not a key/
    );
  });

  it('fills in nothing when it names two escalation keys', () => {
    const code = altered(watchCode({ pubkey: W, relays: ['wss://r.example'], holders: [], executor: X }, WATCH, AT), (p) =>
      p.append('x', H1)
    );
    expect(() => parseWatchCode(code)).toThrow(/two escalation keys/);
  });

  it('says what is wrong with one that is damaged, or newer than this phone, and tells the two apart', () => {
    expect(() => parseWatchCode('hello')).toThrow(/not a watch code/);
    expect(() => parseWatchCode(`watch=2&w=${W}&r=wss://r.example`)).toThrow(/newer version/);
    for (const v of ['0', 'abc', '', '1.5', '-3']) {
      expect(() => parseWatchCode(`watch=${v}&w=${W}&r=wss://r.example`), v).toThrow(/damaged/);
    }
    expect(() => parseWatchCode(`watch=1&w=nope&r=wss://r.example`)).toThrow(/no address/);
    expect(() => parseWatchCode(`watch=1&w=${W}`)).toThrow(/no relay/);
    expect(() => parseWatchCode(`watch=1&w=${W}&r=wss://r.example&h=zz`)).toThrow(/holder/);
  });
});

describe('the escalation key a kept code gives a watch', () => {
  it('is the key, for the watch that signed it', () => {
    const code = parseWatchCode(watchCode({ pubkey: W, relays: ['wss://r.example'], holders: [], executor: X }, WATCH, AT));
    expect(escalationOf(code.text, W)).toEqual({ key: X, issuedAt: AT });
  });

  it('is none for another watch, for a code nobody signed, for a bare key, and for a code naming none', () => {
    const code = parseWatchCode(watchCode({ pubkey: W, relays: ['wss://r.example'], holders: [], executor: X }, WATCH, AT));
    expect(escalationOf(code.text, H1)).toBeNull();
    expect(escalationOf(code.text.replace(`x=${X}`, `x=${S}`), W)).toBeNull();
    expect(escalationOf(X, W)).toBeNull();
    expect(escalationOf({ watch: W, key: X }, W)).toBeNull();
    expect(escalationOf(watchCode({ pubkey: W, relays: ['wss://r.example'], holders: [] }, WATCH, AT), W)).toBeNull();
  });
});

describe('what a code would change about the watch saved here, said before it is saved [review: live hole, phone]', () => {
  const saved = { pubkey: W, relays: ['wss://r.example'], holders: [], executor: null, executorAt: null };
  const form = { pubkey: W, relays: ['wss://r.example'], holders: [] as string[] };

  it('counts an escalation key added to a watch that had none as a change, as much as one replaced', () => {
    // Every box's operators have none saved today: this is where a key that is not the watch's arrives.
    const added = codeChanges(saved, form, { pubkey: W, executor: S, executorAt: AT });
    expect(added.key, 'a first key for a saved watch went in without a word').toBe('added');
    expect(added.lines).toContain('Adds an escalation key, the one key whose answer ends your Distress');
    expect(codeChanges({ ...saved, executor: X, executorAt: AT }, form, { pubkey: W, executor: S, executorAt: AT }).key).toBe('replaced');
  });

  it('counts a code naming none, for a watch that has one, as dropping it', () => {
    const dropped = codeChanges({ ...saved, executor: X, executorAt: AT }, form, { pubkey: W, executor: null, executorAt: AT });
    expect(dropped.key).toBe('dropped');
    expect(dropped.lines.join(' ')).toMatch(/anything holding the watch key can tell you a person has it/);
  });

  it('says when the code is older than the one this phone has', () => {
    const older = codeChanges({ ...saved, executor: X, executorAt: AT }, form, { pubkey: W, executor: S, executorAt: AT - 86_400 });
    expect(older.older).toBe(true);
    expect(older.lines).toContain('The code is older than the one this phone already has');
  });

  it('lists the relays and holders it adds and removes', () => {
    const { lines } = codeChanges(
      { ...saved, holders: [H1] },
      { pubkey: W, relays: ['wss://other.example'], holders: [H2] },
      { pubkey: W, executor: null, executorAt: AT }
    );
    expect(lines).toEqual(
      expect.arrayContaining(['Adds the relay wss://other.example', 'Removes the relay wss://r.example'])
    );
    expect(lines.filter((l) => /holder/.test(l))).toHaveLength(2);
  });

  it('is nothing for the same key, or for another watch, which is a new watch rather than a change', () => {
    expect(codeChanges({ ...saved, executor: X, executorAt: AT }, form, { pubkey: W, executor: X, executorAt: AT })).toEqual({
      key: null,
      older: false,
      lines: []
    });
    expect(codeChanges(saved, { ...form, pubkey: H1 }, { pubkey: H1, executor: S, executorAt: AT }).lines).toEqual([]);
    expect(codeChanges(null, form, { pubkey: W, executor: S, executorAt: AT }).key).toBeNull();
  });
});
