/**
 * Raising the person holding the watch: a Distress sounds until answered or silenced, and the
 * screen stays on while they hold it. Browser objects are stood in for; what is checked is when
 * each is asked for and let go.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let started: number[] = [];
let state: 'running' | 'suspended' = 'running';

class FakeAudio {
  currentTime = 0;
  destination = {};
  onstatechange: (() => void) | null = null;
  get state() {
    return state;
  }
  resume() {
    state = 'running';
    return Promise.resolve();
  }
  createOscillator() {
    return {
      type: '', frequency: { value: 0 },
      connect: (g: { connect: (d: unknown) => unknown }) => g,
      start: (t: number) => started.push(t),
      stop: () => {}
    };
  }
  createGain() {
    return {
      gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect: (d: unknown) => d
    };
  }
}

let requests = 0;
let releases = 0;
const listeners = new Map<string, () => void>();
let raise: typeof import('./raise.svelte');

beforeEach(async () => {
  started = [];
  state = 'running';
  requests = 0;
  releases = 0;
  listeners.clear();
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  });
  vi.stubGlobal('window', { AudioContext: FakeAudio });
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: (t: string, f: () => void) => listeners.set(t, f),
    removeEventListener: (t: string) => listeners.delete(t)
  });
  vi.stubGlobal('navigator', {
    wakeLock: {
      request: async () => {
        requests++;
        return { release: async () => void releases++, addEventListener() {} };
      }
    }
  });
  vi.useFakeTimers();
  vi.resetModules();
  raise = await import('./raise.svelte');
});

afterEach(() => {
  raise.raise.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a Distress on the board of a phone holding the watch', () => {
  it('sounds at once, and again every few seconds while nobody has answered it', () => {
    raise.raise.unlock();
    raise.raise.alarm(true);
    const first = started.length;
    expect(first).toBeGreaterThan(0);
    vi.advanceTimersByTime(raise.ALARM_EVERY_MS * 2);
    expect(started.length).toBe(first * 3);
  });

  it('stops when it is answered or silenced', () => {
    raise.raise.unlock();
    raise.raise.alarm(true);
    raise.raise.alarm(false);
    const n = started.length;
    vi.advanceTimersByTime(raise.ALARM_EVERY_MS * 3);
    expect(started.length).toBe(n);
  });

  it('does not start a second ring over the first', () => {
    raise.raise.unlock();
    raise.raise.alarm(true);
    raise.raise.alarm(true);
    const n = started.length;
    vi.advanceTimersByTime(raise.ALARM_EVERY_MS);
    expect(started.length).toBe(n * 2);
  });

  it('plays nothing until this browser has been touched, and says so', () => {
    state = 'suspended';
    raise.raise.alarm(true);
    expect(started).toHaveLength(0);
    expect(raise.raise.playable).toBe(false);
  });
});

describe('the sound setting', () => {
  it('is on until the holder turns it off, and stays off', () => {
    expect(raise.soundOn()).toBe(true);
    raise.setSound(false);
    expect(raise.soundOn()).toBe(false);
  });
});

describe('the screen, while this phone holds the watch', () => {
  it('is kept on, and let go when they stand down', async () => {
    raise.awake.keep(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toBe(1);
    expect(raise.awake.held).toBe(true);
    raise.awake.keep(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(releases).toBe(1);
    expect(listeners.has('visibilitychange')).toBe(false);
  });

  it('is asked for again when the page is shown after being hidden', async () => {
    raise.awake.keep(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(listeners.has('visibilitychange')).toBe(true);
    expect(raise.awake.supported).toBe(true);
  });
});
