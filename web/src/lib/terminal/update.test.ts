/**
 * Whether a newer build is waiting, and what asking costs.
 *
 * The Watch screen asks so it can say, in its panel, that the board is an older build than the one
 * this phone would load. Two failures matter and they point opposite ways: a prompt that fires on
 * the box's daily rebuild of the same commit teaches a holder to ignore it, and a prompt that never
 * fires leaves a board answering in a way newer phones cannot confirm. Asking must also cost
 * nothing anybody notices — one small request, never a notification, a badge or a buzz.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILT_COMMIT } from '$lib/built';
import type { UpdateRead } from './update.svelte';

const MINE = BUILT_COMMIT ?? 'aaaaaaa';
const OTHER = MINE === 'bbbbbbb' ? 'ccccccc' : 'bbbbbbb';

describe('the page knows its own commit', () => {
  it('from the bundle, as the deploy stamp writes it', () => {
    // Without it every comparison below is "cannot establish", and the prompt can only ever guess.
    expect(BUILT_COMMIT).toMatch(/^[0-9a-f]{7}$/);
  });
});

describe('newerWaiting', () => {
  let newerWaiting: (r: UpdateRead) => boolean;
  let fetchFirst: (r: UpdateRead) => boolean;
  beforeEach(async () => {
    ({ newerWaiting, fetchFirst } = await import('./update.svelte'));
  });

  const read = (r: Partial<UpdateRead>): UpdateRead => ({
    mine: MINE,
    controlled: true,
    changed: false,
    theirs: null,
    deployed: null,
    online: true,
    ...r
  });

  it('is not a first install: a worker claiming a page that had none is this build', () => {
    expect(newerWaiting(read({ theirs: MINE }))).toBe(false);
    expect(newerWaiting(read({ theirs: null, changed: false }))).toBe(false);
  });

  it('is not the daily rebuild of the same commit, though a new worker took over', () => {
    expect(newerWaiting(read({ changed: true, theirs: MINE, deployed: MINE }))).toBe(false);
  });

  it('asks rather than guesses when a new worker took over and will not say which build it is', () => {
    expect(newerWaiting(read({ changed: true, theirs: null }))).toBe(true);
  });

  it('is a worker of another commit, even one that took over before this screen opened', () => {
    expect(newerWaiting(read({ changed: false, theirs: OTHER }))).toBe(true);
  });

  it('is a newer deploy the worker serving this page has not fetched, while online: the hold fetches it first', () => {
    // The hold asks the browser for that worker and reloads once it has taken over, so this is what it loads.
    expect(newerWaiting(read({ theirs: MINE, deployed: OTHER }))).toBe(true);
    expect(fetchFirst(read({ theirs: MINE, deployed: OTHER }))).toBe(true);
    expect(fetchFirst(read({ theirs: null, changed: false, deployed: OTHER }))).toBe(true);
    // Offline, the hold could fetch nothing, and a reload would load this build again.
    expect(newerWaiting(read({ theirs: MINE, deployed: OTHER, online: false }))).toBe(false);
  });

  it('fetches nothing first where the worker already holds another build, or where nothing controls the page', () => {
    expect(fetchFirst(read({ theirs: OTHER, deployed: OTHER }))).toBe(false);
    expect(fetchFirst(read({ changed: true, theirs: null, deployed: OTHER }))).toBe(false);
    expect(fetchFirst(read({ controlled: false, deployed: OTHER }))).toBe(false);
    expect(fetchFirst(read({ theirs: MINE, deployed: MINE }))).toBe(false);
  });

  it('with no worker, is a different deploy only while online', () => {
    expect(newerWaiting(read({ controlled: false, deployed: OTHER, online: true }))).toBe(true);
    expect(newerWaiting(read({ controlled: false, deployed: OTHER, online: false }))).toBe(false);
    expect(newerWaiting(read({ controlled: false, deployed: MINE }))).toBe(false);
    expect(newerWaiting(read({ controlled: false, deployed: null }))).toBe(false);
  });

  it('never matches a page that cannot say its own commit to anything', () => {
    // `built.ts`: null is "cannot establish", never a match. Matched by "a worker changed", every rebuild
    // of the same commit -- the box's, daily -- would ask a holder to clear their board for nothing.
    expect(newerWaiting(read({ mine: null, controlled: false, deployed: OTHER }))).toBe(false);
    expect(newerWaiting(read({ mine: null, changed: true }))).toBe(false);
    expect(newerWaiting(read({ mine: null, changed: true, theirs: OTHER, deployed: OTHER }))).toBe(false);
    expect(fetchFirst(read({ mine: null, deployed: OTHER }))).toBe(false);
  });
});

// ── start(), against stand-ins for the browser ─────────────────────────────────────────────────

class FakePort {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  other: FakePort | null = null;
  postMessage(data: unknown): void {
    const to = this.other;
    queueMicrotask(() => to?.onmessage?.({ data }));
  }
  close(): void {}
}
class FakeChannel {
  port1 = new FakePort();
  port2 = new FakePort();
  constructor() {
    this.port1.other = this.port2;
    this.port2.other = this.port1;
  }
}

/** A worker that says it is `commit`, or says nothing at all -- after `afterMs`, where it is slow to wake. */
function worker(commit: string | undefined, afterMs = 0) {
  return {
    postMessage(message: { ask?: string }, ports?: FakePort[]) {
      if (message?.ask !== 'build' || commit === undefined) return;
      if (afterMs > 0) setTimeout(() => ports?.[0]?.postMessage({ commit }), afterMs);
      else ports?.[0]?.postMessage({ commit });
    }
  };
}

/** The registration the page is handed: `installing` while a new worker installs, as a browser sets it. */
interface FakeRegistration {
  update: () => Promise<void>;
  installing: unknown;
  waiting: unknown;
}

interface Harness {
  sw: EventTarget & { controller: unknown; getRegistration: () => Promise<FakeRegistration> };
  registration: FakeRegistration;
  doc: EventTarget & { visibilityState: string };
  fetch: ReturnType<typeof vi.fn>;
  registrationUpdate: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
  interrupts: { notification: number; vibrate: number; badge: number };
  deployed: { commit: string };
}

async function harness(controller: unknown, deployedCommit = MINE): Promise<Harness & { update: typeof import('./update.svelte').update }> {
  const interrupts = { notification: 0, vibrate: 0, badge: 0 };
  const deployed = { commit: deployedCommit };
  const registrationUpdate = vi.fn(async () => {});
  const registration: FakeRegistration = { update: registrationUpdate, installing: null, waiting: null };
  const sw = Object.assign(new EventTarget(), {
    controller,
    getRegistration: async () => registration
  });
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    json: async () => ({ commit: deployed.commit, builtAt: '2026-10-09T00:00:00Z', dirty: false })
  }));
  const reload = vi.fn();
  vi.stubGlobal('navigator', {
    serviceWorker: sw,
    onLine: true,
    vibrate: () => ((interrupts.vibrate += 1), true),
    setAppBadge: async () => void (interrupts.badge += 1)
  });
  vi.stubGlobal('Notification', class {
    constructor() {
      interrupts.notification += 1;
    }
    static requestPermission() {
      interrupts.notification += 1;
      return Promise.resolve('denied');
    }
  });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('location', { reload });
  vi.stubGlobal('MessageChannel', FakeChannel);
  vi.resetModules();
  const { update } = await import('./update.svelte');
  return { sw, registration, doc, fetch, registrationUpdate, reload, interrupts, deployed, update };
}

/** Lets the asks in flight finish: the worker's answer, the fetch, and what follows them. */
const settle = () => vi.advanceTimersByTimeAsync(0);

const fetchesOf = (h: Harness) => h.fetch.mock.calls.length;

describe('update.start', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('asks what is deployed once on opening, past every cache, and never asks SvelteKit', async () => {
    const h = await harness(worker(MINE));
    const stop = h.update.start();
    await settle();
    expect(fetchesOf(h)).toBe(1);
    expect(h.fetch).toHaveBeenCalledWith('/version.json', { cache: 'no-store' });
    expect(h.fetch.mock.calls.some(([url]) => String(url).includes('_app/version.json'))).toBe(false);
    stop();
  });

  it('asks no more than once in five minutes however often the screen is hidden and shown', async () => {
    const h = await harness(worker(MINE));
    const stop = h.update.start();
    await settle();
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
      h.doc.dispatchEvent(new Event('visibilitychange'));
      await settle();
    }
    expect(fetchesOf(h)).toBe(1);
    // Past five minutes, being shown again asks once more.
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    h.doc.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(fetchesOf(h)).toBe(2);
    stop();
  });

  it('asks every thirty minutes while the screen stays open, and stops when it closes', async () => {
    const h = await harness(worker(MINE));
    const stop = h.update.start();
    await settle();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    await settle();
    expect(fetchesOf(h)).toBe(2);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    await settle();
    expect(fetchesOf(h)).toBe(3);
    stop();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    h.doc.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(fetchesOf(h)).toBe(3);
  });

  it('opened again within five minutes, asks nothing of the host', async () => {
    const h = await harness(worker(MINE));
    h.update.start()();
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);
    const stop = h.update.start();
    await settle();
    expect(fetchesOf(h)).toBe(1);
    stop();
  });

  it('never asks the browser for a new worker by itself: a deploy is said, and fetched only by the hold', async () => {
    // Fetched in the background, the new worker deleted the old build's caches as it took over, and the
    // host keeps no old build's files: the next tap to a screen this page had not loaded yet reloaded the
    // whole page -- the board cleared, and a Distress this phone was sending stopped.
    const h = await harness(worker(MINE), OTHER);
    const stop = h.update.start();
    await settle();
    expect(h.update.waiting).toBe(true);
    expect(h.update.fetchFirst).toBe(true);
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
    h.doc.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(h.registrationUpdate).not.toHaveBeenCalled();
    expect(h.reload).not.toHaveBeenCalled();
    stop();
  });

  it('says a newer build is waiting once a worker of another commit takes over', async () => {
    const h = await harness(worker(MINE), MINE);
    const stop = h.update.start();
    await settle();
    expect(h.update.waiting).toBe(false);
    h.sw.controller = worker(OTHER);
    h.sw.dispatchEvent(new Event('controllerchange'));
    await settle();
    expect(h.update.waiting).toBe(true);
    stop();
  });

  it('says nothing when the worker that takes over is the same commit rebuilt', async () => {
    const h = await harness(worker(MINE), MINE);
    const stop = h.update.start();
    await settle();
    h.sw.controller = worker(MINE);
    h.sw.dispatchEvent(new Event('controllerchange'));
    await settle();
    expect(h.update.waiting).toBe(false);
    stop();
  });

  it('says nothing, not even for a moment, while a same-commit worker slow to wake has not yet said so', async () => {
    // Read before it answered, it counted as a different build: the readout and the reload section
    // flashed into the page for up to five seconds, under the thumb of a holder reaching for a Distress.
    const h = await harness(worker(MINE), MINE);
    const stop = h.update.start();
    await settle();
    h.sw.controller = worker(MINE, 2_000);
    h.sw.dispatchEvent(new Event('controllerchange'));
    expect(h.update.waiting).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.update.waiting).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(h.update.waiting).toBe(false);
    stop();
  });

  it('keeps saying a newer build is waiting while a newer worker still has not said which', async () => {
    const h = await harness(worker(OTHER), MINE);
    const stop = h.update.start();
    await settle();
    expect(h.update.waiting).toBe(true);
    h.sw.controller = worker('ccccccd', 2_000);
    h.sw.dispatchEvent(new Event('controllerchange'));
    expect(h.update.waiting).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.update.waiting).toBe(true);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(h.update.waiting).toBe(true);
    stop();
  });

  it('says one is waiting when a worker that will not say which build it is takes over', async () => {
    const h = await harness(worker(MINE));
    const stop = h.update.start();
    await settle();
    h.sw.controller = worker(undefined);
    h.sw.dispatchEvent(new Event('controllerchange'));
    // The worker had five seconds to answer and did not.
    await vi.advanceTimersByTimeAsync(5_500);
    expect(h.update.waiting).toBe(true);
    stop();
  });

  it('says nothing for a first install that will not say which build it is', async () => {
    const h = await harness(null);
    const stop = h.update.start();
    await settle();
    h.sw.controller = worker(undefined);
    h.sw.dispatchEvent(new Event('controllerchange'));
    await vi.advanceTimersByTimeAsync(5_500);
    expect(h.update.waiting).toBe(false);
    stop();
  });

  it('knows a worker of another commit took over before the screen opened', async () => {
    // The change happened on another screen, where nothing was listening.
    const h = await harness(worker(OTHER), OTHER);
    const stop = h.update.start();
    await settle();
    expect(h.update.waiting).toBe(true);
    stop();
  });

  it('keeps what a worker said when it is too slow to wake the next time it is asked', async () => {
    // A worker that has gone idle is started to answer, and a cheap phone can take longer than the
    // ask allows. Silence from the same worker is not a different build; the prompt must not flicker.
    let says: string | undefined = OTHER;
    const slow = {
      postMessage(message: { ask?: string }, ports?: FakePort[]) {
        if (message?.ask === 'build' && says !== undefined) ports?.[0]?.postMessage({ commit: says });
      }
    };
    const h = await harness(slow, OTHER);
    const stop = h.update.start();
    await settle();
    expect(h.update.waiting).toBe(true);
    says = undefined;
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    h.doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(5_500);
    expect(h.update.waiting).toBe(true);
    stop();
  });

  it('never notifies, badges, buzzes or reloads by itself', async () => {
    const h = await harness(worker(MINE), OTHER);
    const stop = h.update.start();
    await settle();
    h.sw.controller = worker(OTHER);
    h.sw.dispatchEvent(new Event('controllerchange'));
    await settle();
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
    h.doc.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(h.update.waiting).toBe(true);
    expect(h.interrupts).toEqual({ notification: 0, vibrate: 0, badge: 0 });
    expect(h.reload).not.toHaveBeenCalled();
    // Only the hold reloads.
    await h.update.reload();
    expect(h.reload).toHaveBeenCalledTimes(1);
    stop();
  });

  it('the hold fetches a deployed build first, and reloads once its worker has taken over', async () => {
    const h = await harness(worker(MINE), OTHER);
    const stop = h.update.start();
    await settle();
    h.registrationUpdate.mockImplementation(async () => {
      // The browser fetches the new worker, which installs, skips waiting and claims this page.
      h.registration.installing = {};
      setTimeout(() => {
        h.registration.installing = null;
        h.sw.controller = worker(OTHER);
        h.sw.dispatchEvent(new Event('controllerchange'));
      }, 3_000);
    });
    const held = h.update.reload();
    await settle();
    expect(h.registrationUpdate).toHaveBeenCalledTimes(1);
    expect(h.update.phase).toBe('fetching');
    // Not before it has arrived: the old worker would serve this build again, and the board be cleared for nothing.
    expect(h.reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3_000);
    await held;
    expect(h.reload).toHaveBeenCalledTimes(1);
    stop();
  });

  it('the hold that cannot fetch it clears nothing, and says so', async () => {
    const h = await harness(worker(MINE), OTHER);
    const stop = h.update.start();
    await settle();
    // The browser found nothing to install.
    h.registrationUpdate.mockImplementation(async () => {});
    await h.update.reload();
    expect(h.update.phase).toBe('failed');
    expect(h.reload).not.toHaveBeenCalled();
    stop();
  });

  it('the hold that waits for a worker that never takes over gives up, and clears nothing', async () => {
    const h = await harness(worker(MINE), OTHER);
    const stop = h.update.start();
    await settle();
    // It began to install and never finished: a dropped connection, a cell that went away.
    h.registrationUpdate.mockImplementation(async () => {
      h.registration.installing = {};
    });
    const held = h.update.reload();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.update.phase).toBe('fetching');
    await vi.advanceTimersByTimeAsync(31_000);
    await held;
    expect(h.update.phase).toBe('failed');
    expect(h.reload).not.toHaveBeenCalled();
    stop();
  });

  it('the hold reloads nothing, and fetches nothing, while this phone is sending a Distress', async () => {
    const h = await harness(worker(OTHER), MINE);
    const { setDistressSending } = await import('./sending.svelte');
    const stop = h.update.start();
    await settle();
    expect(h.update.waiting).toBe(true);
    setDistressSending(true);
    await h.update.reload();
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.registrationUpdate).not.toHaveBeenCalled();
    setDistressSending(false);
    stop();
  });

  it('with no worker, says a newer deploy is waiting only while online', async () => {
    const h = await harness(null, OTHER);
    const stop = h.update.start();
    await settle();
    expect(h.update.waiting).toBe(true);
    (navigator as unknown as { onLine: boolean }).onLine = false;
    window.dispatchEvent(new Event('offline'));
    expect(h.update.waiting).toBe(false);
    stop();
  });
});
