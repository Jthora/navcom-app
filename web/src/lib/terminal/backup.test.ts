/**
 * Carrying an identity to another phone.
 *
 * A backup is the one blob in this system somebody can **hand you**, and restoring it writes
 * into the tier that holds the identity, the standing and the patrol record.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { newSecretKey, openBackup, publicKeyOf, sealBackup } from '@navcom/core';
import { RestoreError, lastMade, makeBackup, restore, restoreCode } from './backup';
import { get, set } from './storage';
import { loadIdentity } from './identity';
import { addOfferedWatch, loadConfig, offeredWatch } from './config';
import { relays } from './relays';
import { watchCode } from './watch-code';

const PASS = 'correct horse battery staple';

beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  };
});

/** A blob somebody could hand over, carrying whatever they like. */
const handed = (accruing: Record<string, unknown>, v: unknown = 1) =>
  sealBackup(PASS, { v, at: '2026-08-21', accruing });

describe('a backup somebody handed you', () => {
  it('cannot choose which relays this phone talks to', () => {
    // `DEVICE_ONLY` was enforced on the way out and not on the way in — and `relays_own` is
    // the list of relays this phone uses, so a crafted backup routed everything this
    // operator sends through relays somebody else chose.
    restore(PASS, handed({ callsign: 'Wren', relays_own: ['wss://attacker.example'] }));
    expect(get('accruing', 'relays_own')).toBeNull();
    expect(get('accruing', 'callsign')).toBe('Wren');
  });

  it('is refused if it was written by a version this build does not know', () => {
    // Declared and never checked. A kit written to a shape this build has never seen may
    // mean something different by the same key names.
    expect(() => restore(PASS, handed({ callsign: 'Wren' }, 2))).toThrow(RestoreError);
    expect(() => restore(PASS, handed({ callsign: 'Wren' }, 2))).toThrow(/newer version/i);
  });

  it('cannot be a storage bomb', () => {
    // A full phone stops saving, and this writes into the tier holding the identity.
    const many = Object.fromEntries(
      Array.from({ length: 500 }, (_, i) => [`junk${i}`, 'x'.repeat(200)])
    );
    expect(() => restore(PASS, handed(many))).toThrow(/more than a NavCom backup should/i);
    // And nothing was written before it refused.
    expect(get('accruing', 'junk0')).toBeNull();
  });

  it('still restores a real one', () => {
    set('accruing', 'callsign', 'Wren');
    set('accruing', 'peers', [{ pubkey: 'aa', callsign: 'Raven', since: 1 }]);
    const blob = makeBackup(PASS);

    // A fresh phone.
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k)
    };

    const { keys } = restore(PASS, blob);
    expect(keys).toBeGreaterThan(0);
    expect(get('accruing', 'callsign')).toBe('Wren');
  });

  it('refuses to overwrite an identity that is already here', () => {
    set('accruing', 'secret', 'a'.repeat(64));
    expect(() => restore(PASS, handed({ callsign: 'Someone else' }))).toThrow(/already has an identity/i);
  });

  it('gives the same answer for a wrong passphrase and a damaged blob', () => {
    // Telling them apart would tell somebody holding a stolen backup whether they were
    // getting closer.
    const blob = handed({ callsign: 'Wren' });
    // The ciphertext, not the envelope: a malformed envelope is a structural error and is
    // *meant* to read differently. What must be indistinguishable is a wrong passphrase from
    // a damaged payload, since telling those apart tells somebody holding a stolen backup
    // whether they are getting closer.
    const parsed = JSON.parse(blob) as { data: string };
    const tampered = JSON.stringify({
      ...parsed,
      data: parsed.data.slice(0, -4) + (parsed.data.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA')
    });

    const wrong = (() => { try { restore('not the passphrase', blob); } catch (e) { return (e as Error).message; } })();
    const damaged = (() => { try { restore(PASS, tampered); } catch (e) { return (e as Error).message; } })();
    expect(wrong).toBe(damaged);
    expect(wrong).toMatch(/wrong passphrase, or the backup is damaged/i);
  });
});

describe('whether this operator has a backup at all', () => {
  it('knows they have not made one', () => {
    // The screen stated the rule — "a backup you never made does not exist" — and the app
    // had no way to tell an operator which of those two people they were.
    expect(lastMade()).toBeNull();
  });

  it('records the date once one is actually made', () => {
    set('accruing', 'callsign', 'Wren');
    makeBackup(PASS);
    expect(lastMade()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('does not record one that failed', () => {
    // An empty passphrase throws, and a backup that threw is not a backup that exists.
    set('accruing', 'callsign', 'Wren');
    expect(() => makeBackup('')).toThrow();
    expect(lastMade()).toBeNull();
  });

  it("travels with the operator, because it is theirs rather than the handset's", () => {
    set('accruing', 'callsign', 'Wren');
    const blob = makeBackup(PASS);

    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k)
    };
    restore(PASS, blob);
    expect(lastMade()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('a backup that would hold nothing', () => {
  it('is refused rather than sealed', () => {
    // A blob that looks like a backup and holds nothing is worse than no backup, because the
    // operator stops worrying about it.
    expect(() => makeBackup(PASS)).toThrow(/nothing on this phone to back up/i);
  });

  it('says the storage is damaged rather than quietly backing up an empty tier', () => {
    // 0.X established that corrupt storage reads as empty everywhere else, which is right —
    // a terminal that will not start is worse than one asking to be set up again. It is the
    // wrong call here: the operator makes a backup, is told it worked, keeps it for a year,
    // and it holds nothing.
    localStorage.setItem('navcom.accruing', '{not json');
    expect(() => makeBackup(PASS)).toThrow(/storage is damaged/i);
  });

  it('points at where the damage can be looked at', () => {
    localStorage.setItem('navcom.accruing', '{not json');
    expect(() => makeBackup(PASS)).toThrow(/Status/);
  });

  it('refuses to report a restore of nothing as a success', () => {
    // "Restored 0 things" read as a success. An operator told it worked stops looking for
    // the backup that would have.
    expect(() => restore(PASS, sealBackup(PASS, { v: 1, at: '2026-08-21', accruing: {} })))
      .toThrow(/holds nothing/i);
  });

  it('still seals and restores a real one', () => {
    set('accruing', 'callsign', 'Wren');
    const blob = makeBackup(PASS);
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k)
    };
    expect(restore(PASS, blob).keys).toBeGreaterThan(0);
  });
});


describe('what a backup is allowed to carry', () => {
  it('seals the decade and not tonight', () => {
    /*
     * The module's first line — *"the accruing tier and nothing else"* — and **nothing held
     * it**. A backup carrying the wipeable tier carries the thing a panic wipe destroys, so
     * restoring one would undo a wipe somebody meant, on the night they meant it.
     *
     * The end-to-end story cannot catch this alone: the property is defended twice, and
     * restore writing only into `accruing` hides a seal that carries too much. This is the
     * half that has to be checked where it can be isolated.
     */
    set('accruing', 'secret', 'a'.repeat(63) + '1');
    set('accruing', 'callsign', 'Wren');
    set('wipeable', 'signon', { area: 'Downtown', since: 1 });
    set('wipeable', 'notes', { 'st-louis-x': 'side door after 9' });

    const kit = openBackup<{ accruing: Record<string, unknown> }>(PASS, makeBackup(PASS));

    expect(kit.accruing['callsign']).toBe('Wren');
    expect(kit.accruing['signon']).toBeUndefined();
    expect(kit.accruing['notes']).toBeUndefined();
    // And nowhere in the blob under any other name.
    expect(JSON.stringify(kit)).not.toContain('Downtown');
    expect(JSON.stringify(kit)).not.toContain('side door');
  });
});

describe('a bare recovery code (found in robustness audit)', () => {
  it('restores a real one', () => {
    restoreCode('a'.repeat(63) + '1');
    expect(loadIdentity()?.secretKey).toBeDefined();
  });

  it('refuses a code that is 64 hex characters but not a usable key, rather than writing it and failing silently later', () => {
    // Shape-valid is not usable: this used to pass the regex, get written to storage, and
    // only fail later inside loadIdentity()'s own catch -- silently, so the screen told the
    // operator their callsign was back when it was not.
    expect(() => restoreCode('0'.repeat(64))).toThrow(RestoreError);
    expect(loadIdentity()).toBeNull();
  });

  it('refuses the wrong length', () => {
    expect(() => restoreCode('ab')).toThrow(RestoreError);
  });
});

describe('a watch named in a backup [audit: relay paths, F02]', () => {
  const W = 'a'.repeat(64);
  const H = 'b'.repeat(64);

  it('chooses nothing until the operator adds it: no relays, no holders, no Distress routed', () => {
    const { watch } = restore(PASS, handed({ callsign: 'Wren', watchtower: W, relays: ['wss://attacker.example'], watch_holders: [H] }));
    expect(loadConfig(), 'a kit installed a watch nobody chose').toBeNull();
    expect(relays()).not.toContain('wss://attacker.example');
    expect(watch).toEqual({ pubkey: W, relays: ['wss://attacker.example'], holders: [H] });
  });

  it('is still a backup worth restoring when it names only a watch', () => {
    expect(restore(PASS, handed({ watchtower: W, relays: ['wss://watch.example'] })).watch?.pubkey).toBe(W);
  });
});

describe('moving a watch to a new phone [audit: relay paths, review]', () => {
  const W = 'a'.repeat(64);
  const H = 'b'.repeat(64);
  const fresh = () => {
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k)
    };
  };

  it('arrives with the relays the old phone was still using, and its holders', () => {
    // Saved where any ws:// prefix passed: one line the old phone drops, beside one it uses.
    set('accruing', 'callsign', 'Wren');
    set('accruing', 'watchtower', W);
    set('accruing', 'relays', ['ws://192.168.1.50:7777', 'wss://watch.example']);
    set('accruing', 'watch_holders', [H]);
    expect(loadConfig()?.relays, 'the old phone still reaches its watch').toEqual(['wss://watch.example']);
    const blob = makeBackup(PASS);

    fresh();
    restore(PASS, blob);
    addOfferedWatch(offeredWatch()!);
    expect(loadConfig()).toEqual({ pubkey: W, relays: ['wss://watch.example'], holders: [H] });
  });

  it('is still on offer after the screen that showed it has gone', () => {
    // The restore screen said "reopen the terminal", and the offer lived only in that screen.
    restore(PASS, handed({ callsign: 'Wren', watchtower: W, relays: ['wss://watch.example'], watch_holders: [H] }));
    expect(offeredWatch()).toEqual({ pubkey: W, relays: ['wss://watch.example'], holders: [H] });
    expect(loadConfig(), 'and still not installed').toBeNull();
  });

  it('offers nothing when the backup names no watch', () => {
    restore(PASS, handed({ callsign: 'Wren' }));
    expect(offeredWatch()).toBeNull();
  });
});

describe('a watch’s escalation key in a backup [G3]', () => {
  /*
   * The key whose answer ends a `Distress` on a box. Left out of the watch a backup names, it was
   * written straight into this phone's storage, where it would decide whose answer ends a `Distress`
   * on whatever watch the phone held, with nobody having agreed to anything — and it never travelled
   * with the watch it belonged to. It travels now inside the signed code it came in.
   */
  const WATCH = newSecretKey();
  const W = publicKeyOf(WATCH);
  const X = publicKeyOf(newSecretKey());
  const STRANGER = publicKeyOf(newSecretKey());
  const code = (executor: string) =>
    watchCode({ pubkey: W, relays: ['wss://watch.example'], holders: [], executor }, WATCH).split('#')[1]!;

  it('travels with the watch from the old phone, and arrives when the watch is added', () => {
    set('accruing', 'callsign', 'Wren');
    set('accruing', 'watchtower', W);
    set('accruing', 'relays', ['wss://watch.example']);
    set('accruing', 'watch_escalation', code(X));
    const blob = makeBackup(PASS);

    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k)
    };
    const { watch } = restore(PASS, blob);
    expect(get('accruing', 'watch_escalation'), 'written in before anybody added the watch').toBeNull();
    expect(offeredWatch()?.executor).toBe(X);
    expect(watch?.escalation).toBeTruthy();
    addOfferedWatch(offeredWatch()!);
    expect(loadConfig()?.executor).toBe(X);
  });

  it('is never written in by a restore, before anybody adds the watch it names', () => {
    // Somebody else's watch saved here; a handed kit naming an escalation key for it, every way it could.
    set('accruing', 'watchtower', W);
    set('accruing', 'relays', ['wss://watch.example']);
    restore(PASS, handed({ callsign: 'Raven', watch_executor: STRANGER, watch_escalation: code(X) }));
    expect(get('accruing', 'watch_executor'), 'a kit chose whose answer ends this phone’s Distress').toBeNull();
    expect(get('accruing', 'watch_escalation'), 'a kit chose whose answer ends this phone’s Distress').toBeNull();
    expect(loadConfig()?.executor).toBeUndefined();
  });

  it('names no key from a kit whose code the watch did not sign, though the watch can still be added', () => {
    const forged = code(X).replace(`x=${X}`, `x=${STRANGER}`);
    restore(PASS, handed({ callsign: 'Raven', watchtower: W, relays: ['wss://watch.example'], watch_escalation: forged }));
    expect(offeredWatch()?.executor).toBeUndefined();
    addOfferedWatch(offeredWatch()!);
    expect(loadConfig()).toMatchObject({ pubkey: W });
    expect(loadConfig()?.executor, 'a stranger’s key ends this phone’s Distress').toBeUndefined();
  });
});
