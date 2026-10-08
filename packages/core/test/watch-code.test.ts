import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { KIND_WATCH_CODE_SIGNATURE, watchCodeSignatureEvent } from '../src/index.js';

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
