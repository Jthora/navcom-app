import { beforeEach, describe, expect, it, vi } from 'vitest';
import { THE_RECORD } from '@navcom/core';

/**
 * Where the overdue nudge is listened for [retrofit audit, step 16]. It asks for responses addressed
 * to this operator's key, so the question names them — and The Record keeps every address it is sent.
 * It must go only where a Distress would: the watch's relays that `watchTargets()` allows.
 */

const asked: string[][] = [];
vi.mock('./subscribe', () => ({
  subscribeLive: (relays: string[]) => {
    asked.push([...relays]);
    return { close: () => {} };
  }
}));
vi.mock('./identity', () => ({ loadIdentity: () => ({ pubkey: 'b'.repeat(64), secretKey: new Uint8Array(32) }) }));
let relays: string[] = [];
vi.mock('./config', () => ({ loadConfig: () => ({ pubkey: 'a'.repeat(64), relays, holders: [] }) }));

beforeEach(() => {
  asked.length = 0;
});

describe('the overdue nudge', () => {
  it('is never asked for on a relay a Distress would not be sent to', async () => {
    relays = ['wss://watch.example', THE_RECORD];
    const { overdue } = await import('./overdue.svelte');
    overdue.start();
    expect(asked).toEqual([['wss://watch.example']]);
  });
});
