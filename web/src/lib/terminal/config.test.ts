/**
 * A watch is configured completely, or not at all.
 *
 * The half-written case is worse than either: `loadConfig()` returning a pubkey and relays with
 * no holders reads as *configured* everywhere in the app — sign-on arms, Query arms, Distress
 * arms — while every signal is sealed to the watch key alone. A squad's members then decrypt
 * nothing, and the operator goes out believing people are behind them.
 */

import { beforeEach, describe, expect, it } from 'vitest';

/** Enough of the real thing for these assertions; the browser API is tiny here. */
function installLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null
  };
}

const { ConfigError, loadConfig, saveConfig } = await import('./config');

const KEY = 'a'.repeat(64);
const HOLDER = 'b'.repeat(64);

beforeEach(() => installLocalStorage());

describe('saving a watch', () => {
  it('writes nothing at all when a holder key is mistyped', () => {
    /*
     * The pubkey and relays were written before the holders were validated, so one wrong
     * character left the first two on disk and the third absent — and the screen, which only
     * sees the throw, told the operator nothing had been saved.
     */
    expect(() => saveConfig(KEY, 'wss://relay.example', `${HOLDER} nope`)).toThrow(ConfigError);
    expect(loadConfig(), 'a refused config must leave no watch behind').toBeNull();
  });

  it('writes nothing when the relay list is empty', () => {
    expect(() => saveConfig(KEY, '   ')).toThrow(ConfigError);
    expect(loadConfig()).toBeNull();
  });

  it('writes all three parts when everything passes', () => {
    const saved = saveConfig(KEY, 'wss://relay.example', HOLDER);
    expect(saved.holders).toEqual([HOLDER]);
    expect(loadConfig()?.holders).toEqual([HOLDER]);
    expect(loadConfig()?.relays).toEqual(['wss://relay.example']);
  });

  it('keeps a box with no holders as a box', () => {
    // The common case: somebody handed a pubkey and nothing else configures nothing extra.
    expect(saveConfig(KEY, 'wss://relay.example').holders).toEqual([]);
    expect(loadConfig()?.holders).toEqual([]);
  });
});
