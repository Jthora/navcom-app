/**
 * Raising the person holding the watch, while the Watch screen is open.
 *
 * The board was silent by design: *a phone that promised to interrupt them would be promising
 * something a backgrounded web page cannot deliver.* That holds for a page nobody is looking at.
 * It does not hold for the screen a holder keeps open in front of them all night, which can sound
 * and can stay lit, and whose holder is the one person who agreed to be raised for a `Distress`.
 *
 * So, while on station and only then:
 *
 * - **A Distress sounds until somebody answers it or silences it.** Nothing else rings: an Assist
 *   marked *now* chimes once, and nothing else on the board makes a sound. Overdue never does
 *   [invariant 3]; a board that rang for lateness would train its holder to ignore the ring
 * - **The screen is kept on**, where the browser allows it, so the page stays alive to sound
 * - Said as what it is: *while this screen is open.* A locked phone or a closed tab sounds nothing,
 *   and the readouts say when this browser cannot do either
 *
 * A setting of this phone's, on by default, because taking the watch is the consent: off is one tap.
 */
import { get, set } from './storage';

const FIELD = 'watch_sound';

/** Whether this phone sounds a Distress while it holds the watch. */
export function soundOn(): boolean {
  return get<boolean>('accruing', FIELD) ?? true;
}

export function setSound(on: boolean): void {
  set('accruing', FIELD, on);
}

let audio: AudioContext | null = null;
/** Whether this browser will play: it waits for somebody to touch the page first. */
let playable = $state(false);
let ringing: ReturnType<typeof setInterval> | null = null;

function context(): AudioContext | null {
  if (audio) return audio;
  const Ctor = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
  if (!Ctor) return null;
  try {
    audio = new Ctor();
    audio.onstatechange = () => (playable = audio?.state === 'running');
    playable = audio.state === 'running';
  } catch {
    audio = null;
  }
  return audio;
}

/** Short tones, one after another: `[hz, seconds]`. */
function tones(seq: [number, number][]): void {
  const a = context();
  if (!a || a.state !== 'running') return;
  let t = a.currentTime;
  for (const [hz, len] of seq) {
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = 'square';
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(gain).connect(a.destination);
    osc.start(t);
    osc.stop(t + len + 0.02);
    t += len + 0.06;
  }
}

const ALARM: [number, number][] = [[880, 0.18], [660, 0.18], [880, 0.18], [660, 0.18], [880, 0.18], [660, 0.18]];
const CHIME: [number, number][] = [[660, 0.12], [880, 0.2]];
/** How often an unanswered Distress sounds again. */
export const ALARM_EVERY_MS = 6_000;

function alarmOnce(): void {
  tones(ALARM);
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.([300, 150, 300, 150, 300]);
}

export const raise = {
  /** Whether a sound would play now. */
  get playable(): boolean {
    return playable;
  },

  /** Lets this browser play, from a touch: the only moment it allows the first sound. */
  unlock(): void {
    const a = context();
    if (a && a.state !== 'running') void a.resume().then(() => (playable = a.state === 'running')).catch(() => {});
  },

  /** Sounds a Distress now and again every few seconds, until told to stop. */
  alarm(on: boolean): void {
    if (!on) {
      if (ringing) clearInterval(ringing);
      ringing = null;
      return;
    }
    if (ringing) return;
    alarmOnce();
    ringing = setInterval(alarmOnce, ALARM_EVERY_MS);
  },

  /** Once, for an Assist marked now. */
  chime(): void {
    tones(CHIME);
  },

  /**
   * A Distress's sound, once, asked for (2026-11-04): a holder hears what it sounds like and at what
   * volume before the night, rather than learning that the laptop was muted, or playing into headphones
   * nobody wore, when the first one comes. From the press, which is also what lets the browser play.
   */
  test(): void {
    raise.unlock();
    alarmOnce();
  },

  stop(): void {
    raise.alarm(false);
  }
};

/**
 * The screen, kept on while this phone holds the watch and the page is showing.
 *
 * A wake lock is let go whenever the page is hidden, so it is asked for again each time the page
 * is shown. Null where this browser has none.
 */
let lock: { release(): Promise<void> } | null = null;
let wanted = false;
let held = $state<boolean | null>(null);

async function acquire(): Promise<void> {
  const wl = typeof navigator !== 'undefined' ? (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void>; addEventListener?(t: string, f: () => void): void }> } }).wakeLock : undefined;
  if (!wl) {
    held = null;
    return;
  }
  if (!wanted || lock || document.visibilityState !== 'visible') return;
  try {
    const sentinel = await wl.request('screen');
    if (!wanted) {
      void sentinel.release();
      return;
    }
    lock = sentinel;
    held = true;
    sentinel.addEventListener?.('release', () => {
      lock = null;
      held = false;
    });
  } catch {
    held = false;
  }
}

function onVisible(): void {
  if (document.visibilityState === 'visible') void acquire();
}

export const awake = {
  /** Whether this browser can keep a screen on at all. */
  get supported(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  },

  /** True while the screen is held on; false when asked and refused; null where this browser cannot. */
  get held(): boolean | null {
    return held;
  },

  keep(on: boolean): void {
    if (typeof document === 'undefined') return;
    wanted = on;
    if (on) {
      document.addEventListener('visibilitychange', onVisible);
      void acquire();
    } else {
      document.removeEventListener('visibilitychange', onVisible);
      const l = lock;
      lock = null;
      if (l) void l.release().catch(() => {});
      held = held === null ? null : false;
    }
  }
};
