import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { KIND_WATCH_CODE_SIGNATURE, WatchCodeError, parseWatchCode, watchCode, watchCodeSignatureEvent } from '../src/index.js';

/**
 * The bytes a watch code's signature is over. The box makes codes and the phone reads them, so these
 * are pinned by hand here, from the spec's words, rather than by calling the builder twice.
 */

const watch = 'AB'.repeat(32);
const executor = 'CD'.repeat(32);

describe('watch code signature', () => {
  it('is its own never-published kind', () => {
    expect(KIND_WATCH_CODE_SIGNATURE).toBe(20916);
  });

  it('signs the address, relays, holders and executor, each once, sorted and lower-case', () => {
    const event = watchCodeSignatureEvent(
      { pubkey: watch, relays: [' wss://b.example ', 'wss://a.example', 'wss://b.example', ''], holders: ['FF'.repeat(32), 'ee'.repeat(32), 'ff'.repeat(32)], executor },
      1_700_000_000
    );
    expect(event).toEqual({
      kind: 20916,
      pubkey: 'ab'.repeat(32),
      created_at: 1_700_000_000,
      tags: [],
      content: JSON.stringify([
        'navcom-watch-code-v1',
        'ab'.repeat(32),
        ['wss://a.example', 'wss://b.example'],
        ['ee'.repeat(32), 'ff'.repeat(32)],
        'cd'.repeat(32)
      ])
    });
  });

  it('names no executor as null, and a box as having no holders', () => {
    const event = watchCodeSignatureEvent({ pubkey: watch, relays: ['wss://a.example'], holders: [] }, 1);
    expect(JSON.parse(event.content)).toEqual(['navcom-watch-code-v1', 'ab'.repeat(32), ['wss://a.example'], [], null]);
  });

  it('is checked by any nostr library once the watch key signs it', () => {
    const secret = generateSecretKey();
    const pubkey = getPublicKey(secret);
    const signed = finalizeEvent(watchCodeSignatureEvent({ pubkey, relays: ['wss://a.example'], holders: [] }, 2), secret);
    expect(verifyEvent(signed)).toBe(true);
    expect(signed.pubkey).toBe(pubkey);
  });
});

describe('a watch code naming tonight’s teams (2026-11-02)', () => {
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  const fields = { pubkey, relays: ['wss://a.example'], holders: [pubkey] };

  it('signs them under words of its own, each once whatever its case, in the order given', () => {
    const event = watchCodeSignatureEvent({ ...fields, teams: [' Zone  Guardians', 'Rescue Rangers', 'zone guardians'] }, 3);
    expect(JSON.parse(event.content)).toEqual([
      'navcom-watch-code-v2', pubkey, ['wss://a.example'], [pubkey], null, ['Zone Guardians', 'Rescue Rangers']
    ]);
  });

  it('is version 2 and reads back whole; a code with none is version 1, as every code was', () => {
    const code = parseWatchCode(watchCode({ ...fields, teams: ['Zone Guardians', 'Rescue Rangers'] }, secret, 10));
    expect(code.text).toMatch(/^watch=2&/);
    expect(code.teams).toEqual(['Zone Guardians', 'Rescue Rangers']);
    const plain = parseWatchCode(watchCode(fields, secret, 10));
    expect(plain.text).toMatch(/^watch=1&/);
    expect(plain.teams).toBeUndefined();
  });

  it('refuses a code whose teams were changed after it was signed', () => {
    const made = watchCode({ ...fields, teams: ['Zone Guardians'] }, secret, 10);
    expect(() => parseWatchCode(made.replace('n=Zone+Guardians', 'n=Somebody+Else'))).toThrow(WatchCodeError);
    expect(() => parseWatchCode(made.replace('&n=Zone+Guardians', ''))).toThrow(WatchCodeError);
  });

  it('reads no teams into a version-1 code, which never signed any', () => {
    const made = watchCode(fields, secret, 10).replace('&t=', '&n=Planted&t=');
    expect(parseWatchCode(made).teams).toBeUndefined();
  });

  it('names at most twelve', () => {
    const many = Array.from({ length: 13 }, (_, i) => `Team ${i}`);
    expect(() => watchCode({ ...fields, teams: many }, secret, 10)).toThrow(WatchCodeError);
  });
});
