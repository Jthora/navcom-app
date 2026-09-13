/**
 * The part of a key a person compares by eye.
 *
 * Callsigns are not unique, so the name beside somebody's words does not say who is answerable
 * for them. These assert the one property that makes a print worth showing -- two keys read
 * differently -- and the one that makes it checkable: it is the start of the address anybody
 * can see in a link, not a derived value nobody can reproduce.
 */

import { describe, expect, it } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { keyPrint } from '../src/index.js';

describe('keyPrint', () => {
  it('is sixteen hex characters in four groups', () => {
    const print = keyPrint(getPublicKey(generateSecretKey()));
    expect(print).toMatch(/^[0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4}$/);
  });

  it('is the start of the key, so a reader can check it against the address in a link', () => {
    const key = getPublicKey(generateSecretKey());
    expect(key.startsWith(keyPrint(key)!.replace(/ /g, ''))).toBe(true);
  });

  it('tells apart two keys that share their first eight characters', () => {
    // Eight is what a determined impersonator can grind. The print must reach past it.
    const a = 'abcd1234' + '0'.repeat(56);
    const b = 'abcd1234' + 'f'.repeat(56);
    expect(keyPrint(a)).not.toBe(keyPrint(b));
  });

  it('refuses anything that is not a public key rather than printing a fragment of it', () => {
    expect(keyPrint('')).toBeNull();
    expect(keyPrint('abcd')).toBeNull();
    expect(keyPrint('A'.repeat(64))).toBeNull();
    expect(keyPrint('npub1' + 'q'.repeat(58))).toBeNull();
  });
});
