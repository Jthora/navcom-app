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

const {
  ConfigError,
  addOfferedWatch,
  forgetOfferedWatch,
  loadConfig,
  offerWatch,
  offeredWatch,
  saveConfig,
  storedWatch,
  watchForm
} = await import('./config');
const { get, panicWipe } = await import('./storage');

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

describe('a relay address this phone cannot reach [audit: relay paths, F01/F21]', () => {
  it('is refused on saving, by name, rather than stored to fail every Distress later', () => {
    for (const bad of ['wss://', 'wss://relay.example:99999', 'wss://relay.example>', 'ws://relay.example.com']) {
      expect(() => saveConfig(KEY, `wss://good.example\n${bad}`), bad).toThrow(ConfigError);
    }
    expect(loadConfig()).toBeNull();
  });

  it('is accepted for a relay on this device', () => {
    expect(saveConfig(KEY, 'ws://127.0.0.1:7777').relays).toEqual(['ws://127.0.0.1:7777']);
  });

  it('is dropped on loading, so a config saved before this check, or restored, still sends', () => {
    localStorage.setItem('navcom.accruing', JSON.stringify({ watchtower: KEY, relays: ['wss://', 'wss://good.example', 'wss://x.example:99999'] }));
    expect(loadConfig()?.relays).toEqual(['wss://good.example']);
  });

  it('sends nowhere when none of its relays can be reached', () => {
    localStorage.setItem('navcom.accruing', JSON.stringify({ watchtower: KEY, relays: ['wss://', 'ws://relay.example.com'] }));
    expect(loadConfig()).toBeNull();
  });
});

describe('a watch whose every relay this page refuses [audit: relay paths, review]', () => {
  /*
   * Saved on a page that accepted any ws:// prefix: a squad's LAN relay, or a typo for wss://.
   * It reached nothing from https before either. What changed is the explanation — it read as
   * "no watch", and Setup opened blank with the key and the holders needed to repair it hidden.
   */
  const LAN = 'ws://192.168.1.50:7777';

  it('is still the watch somebody added, with its key, its holders and every line as saved', () => {
    localStorage.setItem('navcom.accruing', JSON.stringify({ watchtower: KEY, relays: [LAN], watch_holders: [HOLDER] }));
    expect(loadConfig(), 'nothing may be sent to a relay this page refuses').toBeNull();
    const watch = storedWatch();
    expect(watch?.pubkey).toBe(KEY);
    expect(watch?.holders).toEqual([HOLDER]);
    expect(watch?.lines).toEqual([LAN]);
    expect(watch?.relays).toEqual([]);
  });

  it('names each refused line and why, in words an operator can act on', () => {
    localStorage.setItem('navcom.accruing', JSON.stringify({ watchtower: KEY, relays: [LAN, 'wss://good.example'] }));
    const watch = storedWatch();
    expect(watch?.relays).toEqual(['wss://good.example']);
    expect(watch?.refused).toEqual([{ address: LAN, why: expect.stringMatching(/needs wss:\/\//) }]);
    expect(watch?.refused[0]?.why).toContain(LAN);
  });

  it('is repaired by one edit that keeps the holders', () => {
    // Setup fills the form from `storedWatch`, so correcting the line is the whole repair.
    localStorage.setItem('navcom.accruing', JSON.stringify({ watchtower: KEY, relays: [LAN], watch_holders: [HOLDER] }));
    const watch = storedWatch()!;
    saveConfig(watch.pubkey, 'wss://relay.example', watch.holders.join('\n'));
    expect(loadConfig()).toEqual({ pubkey: KEY, relays: ['wss://relay.example'], holders: [HOLDER] });
  });

  it('is not invented where there is none', () => {
    expect(storedWatch()).toBeNull();
  });
});

describe('a watch a restored backup named [audit: relay paths, review]', () => {
  const named = { pubkey: KEY, relays: ['ws://192.168.1.50:7777', 'wss://watch.example'], holders: [HOLDER] };

  it('outlasts the screen that showed it, without becoming a watch', () => {
    offerWatch(named);
    // "Reopen the terminal" — the screen's own advice — used to lose it. Storage does not.
    expect(offeredWatch()).toEqual(named);
    expect(loadConfig(), 'an offer routes nothing until the operator adds it').toBeNull();
    expect(get('accruing', 'watchtower')).toBeNull();
  });

  it('is added with the relays this page can reach, the rest left out, and the holders kept', () => {
    // One line the old phone had long since stopped dialling refused the whole watch.
    offerWatch(named);
    addOfferedWatch(named);
    expect(loadConfig()).toEqual({ pubkey: KEY, relays: ['wss://watch.example'], holders: [HOLDER] });
    expect(offeredWatch(), 'an added watch is not still on offer').toBeNull();
  });

  it('is refused only when nothing would be left, and then nothing is written', () => {
    const stranded = { ...named, relays: ['ws://192.168.1.50:7777'] };
    offerWatch(stranded);
    expect(() => addOfferedWatch(stranded)).toThrow(ConfigError);
    expect(() => addOfferedWatch(stranded)).toThrow(/setup screen/);
    // `loadConfig` alone cannot see a write here: it is null for any watch whose every relay is
    // refused, so a stranded watch stored before the throw would pass it.
    expect(storedWatch(), 'no watch the operator did not agree to add').toBeNull();
    for (const field of ['watchtower', 'relays', 'watch_holders']) {
      expect(get('accruing', field), field).toBeNull();
    }
    expect(offeredWatch(), 'still there to fix in setup').toEqual(stranded);
  });

  it('goes when the operator says it is not theirs', () => {
    offerWatch(named);
    forgetOfferedWatch();
    expect(offeredWatch()).toBeNull();
  });

  it('is taken by a panic wipe, and a wipe takes nothing else', () => {
    // Invariant 5. It names a watch, which is association data; the wipeable tier exists to go.
    saveConfig(KEY, 'wss://relay.example');
    offerWatch(named);
    panicWipe();
    expect(offeredWatch()).toBeNull();
    expect(loadConfig()?.pubkey).toBe(KEY);
  });
});

describe('the watch as Setup opens it [audit: relay paths, review]', () => {
  /*
   * Setup fills its form from `watchForm` and saves what the form holds with `saveConfig`, which
   * checks every line it is given. These drive that pair the way the screen does.
   */
  const LAN = 'ws://192.168.1.50:7777';
  const GOOD = 'wss://relay.good.example';
  const LEFT = 'c'.repeat(64);

  it('opens a working watch with only the relays this page reaches, so removing a holder saves', () => {
    // Saved before the check: one LAN line beside one that works. The watch works here.
    localStorage.setItem(
      'navcom.accruing',
      JSON.stringify({ watchtower: KEY, relays: [LAN, GOOD], watch_holders: [HOLDER, LEFT] })
    );
    const form = watchForm()!;
    expect(form.from).toBe('saved');
    expect(form.relays, 'the field').toEqual([GOOD]);
    expect(form.refused, 'named beside it').toEqual([{ address: LAN, why: expect.stringContaining(LAN) }]);
    expect(form.reachable).toBe(1);

    // A squad member leaves. The operator deletes their key and taps Update.
    saveConfig(form.pubkey, form.relays.join('\n'), HOLDER);
    expect(loadConfig(), 'the holder who left no longer reads every Distress').toEqual({
      pubkey: KEY,
      relays: [GOOD],
      holders: [HOLDER]
    });
  });

  it('opens a watch with nothing reachable with every line as saved, so the line to fix is in the field', () => {
    localStorage.setItem('navcom.accruing', JSON.stringify({ watchtower: KEY, relays: [LAN], watch_holders: [HOLDER] }));
    const form = watchForm()!;
    expect(form.relays).toEqual([LAN]);
    expect(form.reachable).toBe(0);
    expect(form.holders).toEqual([HOLDER]);
    // Saving it unchanged is refused, by name; fixing the line is the repair.
    expect(() => saveConfig(form.pubkey, form.relays.join('\n'), form.holders.join('\n'))).toThrow(LAN);
    saveConfig(form.pubkey, 'wss://relay.example', form.holders.join('\n'));
    expect(loadConfig()?.holders).toEqual([HOLDER]);
  });

  it('opens a backup’s watch by the same rule, marked as not yet added', () => {
    offerWatch({ pubkey: KEY, relays: [LAN, GOOD], holders: [HOLDER] });
    const form = watchForm()!;
    expect(form.from).toBe('backup');
    expect(form.relays).toEqual([GOOD]);
    expect(loadConfig(), 'shown, not added').toBeNull();
    saveConfig(form.pubkey, form.relays.join('\n'), form.holders.join('\n'));
    expect(loadConfig()).toEqual({ pubkey: KEY, relays: [GOOD], holders: [HOLDER] });
  });

  it('prefers the watch saved here over one a backup named', () => {
    saveConfig(KEY, GOOD);
    offerWatch({ pubkey: HOLDER, relays: [GOOD], holders: [] });
    expect(watchForm()?.from).toBe('saved');
    expect(watchForm()?.pubkey).toBe(KEY);
  });

  it('opens empty when there is neither', () => {
    expect(watchForm()).toBeNull();
  });
});
