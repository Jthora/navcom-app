/**
 * Whether a newer build is waiting on this phone, for the one screen where an older one matters.
 *
 * A board is a page left open for hours, and everything on it lives in that page's memory: who is
 * out, what is waiting, the beat that keeps a holder announced. Nothing in the app ever asked the
 * page to move to a newer build, and nothing should do it unasked, because a reload is the board
 * being cleared. But an older board can answer in a way a newer operator's phone shows and cannot
 * confirm — what makes an answer attributable to a person has changed between builds before — and
 * `escalation.spec.md` decided that a board left open on an older build asks to be reloaded when a
 * newer one is waiting. This is how it knows one is.
 *
 * ## What "waiting" means
 *
 * **Reloading now would load a different commit, and would work.** Two different questions hide in
 * that, and the code keeps them apart:
 *
 * - **What a reload would load.** Where a service worker controls the page, its cache serves the
 *   shell, so the answer is the worker's build — asked of the worker itself, which answers with no
 *   network. Where none does (a private window), the answer is whatever is deployed, and only while
 *   online
 * - **Whether a newer one exists at all.** `/version.json`, asked at most every five minutes while
 *   the Watch screen is open, and every thirty regardless. Where it names a commit the controlling
 *   worker is not, the hold fetches that worker first — never this module in the background
 *   [review: board reload]. A new worker deletes the old build's caches as it takes over, and this
 *   host keeps no old build's files, so from then on a tap to any screen this page had not loaded yet
 *   fails to load and SvelteKit loads the whole page instead: the board cleared, the beat stopped, and
 *   a Distress this phone was sending ended, by a tap on Status. Fetched only by the hold, the old
 *   worker and its caches stay until the holder chooses
 *
 * By commit, not by SvelteKit's build version, which changes on every build: the box rebuilds the
 * site daily from the same commit, and a holder asked to clear their board for an identical build
 * learns to ignore the question.
 *
 * ## What it never does
 *
 * **It never reloads**, and it never interrupts: no notification, no badge, no sound, no vibration.
 * The holder is told on the Watch screen, in its panel, and reloads by holding a control there —
 * only they know when the board is quiet enough to lose. It never polls `_app/version.json`, which
 * is SvelteKit's, and sets no `pollInterval`. It never asks the browser for a new worker except from
 * that hold, and never while this phone is sending a `Distress`.
 */

import { BUILT_COMMIT } from '$lib/built';
import { sending } from './sending.svelte';

/**
 * How often an open Watch screen asks what is deployed. Never tighter: the site sits behind a host
 * whose bot mitigation has challenged repeated fetches before, and this is one request per open board.
 */
export const CHECK_EVERY_MS = 30 * 60_000;

/** The least time between two asks, however often the screen is hidden and shown again. */
export const CHECK_AT_MOST_EVERY_MS = 5 * 60_000;

/**
 * How long the worker has to say which build it is before it counts as not saying. Generous: a
 * worker that has gone idle is started to answer, and that is slow on the phones this is for.
 */
export const ASK_WORKER_MS = 5_000;

/**
 * How long the hold waits for the deployed build's worker to take over before saying it could not.
 * Generous: it fetches the whole shell, on the phones and the signal this is for.
 */
export const TAKE_OVER_MS = 90_000;

/** What decides whether a newer build is waiting. Pure data, for {@link newerWaiting}. */
export interface UpdateRead {
  /** This page's commit, from its bundle; null where the build could not say. */
  mine: string | null;
  /** Whether a service worker controls this page now, so a reload is served from its cache. */
  controlled: boolean;
  /** Whether a worker has taken over from another since this page loaded. */
  changed: boolean;
  /** The commit the controlling worker says it is; null where it has not said. */
  theirs: string | null;
  /** The commit `/version.json` names; null where it could not be read. */
  deployed: string | null;
  online: boolean;
}

/**
 * Whether the hold would load a different build, and would work.
 *
 * - **A page that cannot say its own commit never asks** (`built.ts`: null is "cannot establish",
 *   never a match). Comparing nothing, every rebuild of the same commit would look new, and a holder
 *   asked to clear their board for nothing learns to ignore the question
 * - Controlled, and the worker has said another commit: that is what a reload loads, from this phone
 * - Controlled, and a worker that took over since this page loaded will not say: a different build of
 *   something, and asking costs the holder a look
 * - Otherwise the worker would serve this build again, so only a deploy of another commit, while
 *   online: the hold fetches its worker first ({@link fetchFirst})
 * - Not controlled: a reload goes to the network, so the same, only while online
 */
export function newerWaiting(r: UpdateRead): boolean {
  if (r.mine === null) return false;
  if (r.controlled) {
    if (r.theirs !== null && r.theirs !== r.mine) return true;
    if (r.theirs === null && r.changed) return true;
  }
  return r.online && r.deployed !== null && r.deployed !== r.mine;
}

/**
 * Whether the hold must fetch the deployed build's worker before reloading: a worker controls the page
 * and would serve this build again. Pure, for the tests.
 */
export function fetchFirst(r: UpdateRead): boolean {
  if (!r.controlled || r.mine === null) return false;
  const servesMine = r.theirs === r.mine || (r.theirs === null && !r.changed);
  return servesMine && r.deployed !== null && r.deployed !== r.mine;
}

/** A commit as the stamp and the worker write it, or null. */
function commitOf(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-f]{7}$/.test(value) ? value : null;
}

function container(): ServiceWorkerContainer | null {
  return typeof navigator !== 'undefined' ? (navigator.serviceWorker ?? null) : null;
}

/**
 * The worker last seen controlling this page, from when this module loaded. A worker claiming a page
 * that had none is a first install, not an update, so only a change from one worker to another counts.
 */
let seen: ServiceWorker | null = container()?.controller ?? null;
let controlled = $state(seen !== null);
let changed = $state(false);
let theirs = $state<string | null>(null);
/** The worker `theirs` is the answer of: an answer belongs to the worker that gave it. */
let theirsFrom: ServiceWorker | null = null;
let deployed = $state<string | null>(null);
let online = $state(typeof navigator === 'undefined' || navigator.onLine !== false);
/**
 * What `waiting` said when a different worker took over, held until that worker has said which build
 * it is [review: board reload]. Read in between, it had no answer yet and counted as a different build,
 * so the box's daily rebuild of the same commit flashed the readout and the reload section into the
 * page for up to five seconds -- a reflow under the holder's thumb, for nothing.
 */
let held = $state<boolean | null>(null);
/** Where the hold has got to: fetching the deployed build first, or that it could not. */
let phase = $state<'idle' | 'fetching' | 'failed'>('idle');
/** When `/version.json` was last asked for, module-wide, so a screen opened again does not ask again. */
let lastFetch = -Infinity;
/** Moved on by every ask of the worker: only the newest answer counts. */
let asking = 0;

/** Everything {@link newerWaiting} reads, as it stands. */
function current(): UpdateRead {
  return { mine: BUILT_COMMIT, controlled, changed, theirs, deployed, online };
}

/** The controlling worker's commit, asked on a port of its own. Null on no answer, or none in time. */
function askWorker(worker: ServiceWorker): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const channel = new MessageChannel();
    const finish = (commit: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      channel.port1.close();
      resolve(commit);
    };
    const timer = setTimeout(() => finish(null), ASK_WORKER_MS);
    channel.port1.onmessage = (e: MessageEvent) =>
      finish(commitOf((e.data as { commit?: unknown } | null)?.commit));
    try {
      worker.postMessage({ ask: 'build' }, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}

/**
 * Which build a reload would load, as the controlling worker says. Local: no network.
 *
 * `moved` when a different worker has just taken over: it counts as changed only once it has had its
 * chance to say which build it is, in the same step as its answer, so nothing reads "changed, and has
 * not said" in between.
 */
async function readWorker(moved = false): Promise<void> {
  const worker = container()?.controller ?? null;
  controlled = worker !== null;
  // Another worker's answer says nothing about this one.
  if (worker !== theirsFrom) {
    theirs = null;
    theirsFrom = worker;
  }
  if (!worker) {
    held = null;
    return;
  }
  const mine = ++asking;
  const said = await askWorker(worker);
  // A newer ask owns the answer now, and settles what this one would have.
  if (mine !== asking) return;
  // A worker slow to wake that said nothing this time is still the build it said it was last time.
  if ((container()?.controller ?? null) === worker && said !== null) theirs = said;
  if (moved || held !== null) changed = true;
  held = null;
}

/**
 * What is deployed, at most once per {@link CHECK_AT_MOST_EVERY_MS}. Only read: a deploy the controlling
 * worker is not is fetched by the hold, never here (see the top of this file).
 */
async function readDeployed(): Promise<void> {
  const now = Date.now();
  if (now - lastFetch < CHECK_AT_MOST_EVERY_MS) return;
  lastFetch = now;
  online = navigator.onLine !== false;
  try {
    // Past every cache: the worker never stores this file, and the browser is told not to either.
    const response = await fetch('/version.json', { cache: 'no-store' });
    if (!response.ok) return;
    deployed = commitOf(((await response.json()) as { commit?: unknown } | null)?.commit);
  } catch {
    // Offline, or the host refused: what is deployed is unknown, and nothing is guessed.
    return;
  }
}

async function check(): Promise<void> {
  await readWorker();
  await readDeployed();
}

/**
 * Asks the browser for the deployed build's worker and waits for it to take over this page. True once a
 * different worker controls it; false where none arrives in {@link TAKE_OVER_MS}, the browser found
 * nothing new, or it could not ask.
 */
function takeOver(sw: ServiceWorkerContainer, before: ServiceWorker): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sw.removeEventListener('controllerchange', onChange);
      resolve(ok);
    };
    const onChange = () => {
      const now = sw.controller;
      if (now && now !== before) finish(true);
    };
    const timer = setTimeout(() => finish(false), TAKE_OVER_MS);
    sw.addEventListener('controllerchange', onChange);
    void (async () => {
      try {
        const registration = await sw.getRegistration();
        if (!registration) return finish(false);
        await registration.update();
        // The same worker script: nothing is coming.
        if (!registration.installing && !registration.waiting && sw.controller === before) finish(false);
      } catch {
        finish(false);
      }
    })();
  });
}

export const update = {
  /** Whether the hold would load a different build, and would work. */
  get waiting(): boolean {
    return held ?? newerWaiting(current());
  },

  /** Whether the hold fetches the newer build before it reloads: it is deployed, not yet on this phone. */
  get fetchFirst(): boolean {
    return fetchFirst(current());
  },

  /** Where the hold has got to: `fetching` the deployed build, or `failed` to, with nothing cleared. */
  get phase(): 'idle' | 'fetching' | 'failed' {
    return phase;
  },

  /**
   * Listens while the Watch screen is open. Returns what stops it.
   *
   * Asks once now, again whenever the screen is shown (no more than every five minutes), and every
   * thirty minutes while it stays open; and asks the worker again whenever a worker takes over.
   */
  start(): () => void {
    const sw = container();
    const onChange = () => {
      const now = sw?.controller ?? null;
      const moved = seen !== null && now !== null && now !== seen;
      if (now !== null) seen = now;
      // What it said until the new worker has said which build it is: a same-commit rebuild changes nothing.
      if (moved && held === null) held = newerWaiting(current());
      void readWorker(moved);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    const onLine = () => {
      online = navigator.onLine !== false;
    };
    sw?.addEventListener('controllerchange', onChange);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onLine);
      window.addEventListener('offline', onLine);
    }
    const every = setInterval(() => void check(), CHECK_EVERY_MS);
    void check();
    return () => {
      clearInterval(every);
      sw?.removeEventListener('controllerchange', onChange);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onLine);
        window.removeEventListener('offline', onLine);
      }
    };
  },

  /**
   * The reload. Called by the hold control on the Watch screen and by nothing else.
   *
   * Where the newer build is deployed and not yet on this phone, it is fetched first, and the page
   * reloads only once its worker has taken over: reloaded before, the old worker would serve this build
   * again and the board would be cleared for nothing. Where it does not arrive, nothing is cleared and
   * the screen says so. Never while this phone is sending a `Distress`: a reload stops it.
   */
  async reload(): Promise<void> {
    if (sending.distress || phase === 'fetching') return;
    const sw = container();
    const before = sw?.controller ?? null;
    if (sw && before && fetchFirst(current())) {
      phase = 'fetching';
      const took = await takeOver(sw, before);
      // Started sending while it fetched: the board stays, and so does the Distress.
      if (sending.distress) {
        phase = 'idle';
        return;
      }
      if (!took) {
        phase = 'failed';
        return;
      }
    }
    phase = 'idle';
    location.reload();
  }
};
