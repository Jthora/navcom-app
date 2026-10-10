/**
 * Missions, read live by this device from the relays that hold them.
 *
 * **Every device draws its own picture** [CLAUDE.md]. A mission is a signed event on The Record and
 * on the mirrors that copy it; this subscribes to all of them at once, verifies each package's
 * signature here, and keeps the subscriptions open so a new or closed mission shows without a
 * reload. Nothing is baked into the site and no server stands between a relay and the screen. An
 * earlier version had the site's build take a snapshot instead; that made one build draw the
 * picture for everyone and tied freshness to deploys, which is the centralisation this
 * architecture exists to avoid.
 *
 * **All at once, and the newest signed copy wins** [docs/design/grid.md]. Each relay contributes
 * its last answer, and the screen shows the newest version of each package across all of them —
 * and across what this device already saw, so a mirror that has fallen behind cannot roll back a
 * version this device read last week [11.R]. A mirror cannot forge a package, and since 11.R it
 * cannot stop the feed either: an event is checked before it is kept, so one malformed frame is
 * dropped rather than stored and replayed into every reload.
 *
 * What each relay learns is that a device opened NavCom's missions: one subscription to all of
 * them, never which part of the map anybody looked at. The Record also logs the address each
 * connection comes from until it applies the grid's reader rule [grid.md §1]; its mirror does not.
 *
 * **Offline is a normal state** [C10]. The last set seen is kept on this device, in the Wipeable
 * tier — mission history is Wipeable [invariant 5], so a panic wipe takes it — and shown with its
 * age when no relay can be reached. It is stored as the signed events, not as the missions read
 * from them, so a copy that was tampered with fails verification on the way back in. It is bounded,
 * and saved at most every two seconds, because the same tier holds sign-on and the patrol record.
 * **A wipe ends that copy for this subscription**, in this page or another tab: it is no longer
 * drawn, and nothing this subscription holds is written back. The next page keeps its own.
 *
 * Loaded by dynamic import after first paint: verification brings the signature library, and the
 * map should draw before it arrives.
 */
import { MISSION_PACKAGE_KIND, MISSION_PUBLISHERS, MISSION_RELAYS } from '@navcom/core';
import { generation, get, onWipe, set } from '$lib/terminal/storage';
// So this page hears a wipe in another tab, or one it slept through in the back-forward cache.
import '$lib/terminal/wiped-elsewhere';
import { collect, readingOf, type Collected, type Readings } from './collect';

export type Feed =
  | ({ status: 'live'; at: Date } & Collected)
  | ({ status: 'cached'; at: Date } & Collected)
  | { status: 'connecting' }
  | { status: 'unavailable' };

const STORE = 'missions';
/** Retried with backoff while the page is open: 5 s, 10 s, 20 s… never more than 5 minutes apart. */
const RETRY_MS = [5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000];
/**
 * How long a connection may take to open before it counts as failed. A phone with no signal can
 * leave a socket opening for minutes before the browser gives up; this says "unavailable" — or
 * shows the last copy with its age — long before that, and keeps trying behind it.
 */
const CONNECT_MS = 8_000;
/**
 * How long an open connection may take to finish its first answer. Longer than opening, because
 * the answer is every package The Record holds and a congested cell moves it slowly — but bounded,
 * because a relay that refuses the subscription or never finishes left "Reaching The Record…" up
 * for as long as the page was open [11.R].
 */
const ANSWER_MS = 30_000;
/**
 * How often a relay that has answered is asked whether it is still there. A socket that died
 * without closing — a network switch, a sleeping phone — sends nothing, and "live" stayed up over
 * a picture nobody was updating [11.E]. Nostr has no ping, so the question is an empty request.
 */
const PROBE_MS = 240_000;
/** The most packages kept from any one relay, and on this device: a night has dozens, not hundreds. */
export const PACKAGES_MAX = 100;
/** Characters the stored copy may take: a fifth of a browser's usual quota, which the tier shares. */
export const KEPT_CHARS_MAX = 1_000_000;
/**
 * Frames one connection may send whose signature does not verify before that relay is treated as
 * failed and tried again later [audit 11, second grid]. An honest relay sends none: the request
 * names the publishers, and a version a publisher signed verifies whether or not NavCom can read it.
 * Each one costs a full signature check on the main thread, and the cap below only ever counted
 * what was kept — so a relay streaming junk made a phone verify for as long as the page was open.
 */
export const UNVERIFIED_MAX = 20;
const SAVE_MS = 2_000;

type Stored = { at: string; events: unknown[] };
type Signed = { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string };

export interface Sources {
  /** The relays to read, all at once. */
  relays?: readonly string[];
  /** Whose packages count. The app reads its registered publishers; a test signs its own. */
  publishers?: NonNullable<Parameters<typeof collect>[2]>;
}

/** The shape a package must have before anything else is asked of it, and before it is kept. */
function wellFormed(e: unknown, publishers: Record<string, unknown>): e is Signed {
  const x = e as Partial<Signed> | null;
  return (
    !!x && typeof x === 'object' && x.kind === MISSION_PACKAGE_KIND &&
    typeof x.id === 'string' && /^[0-9a-f]{64}$/.test(x.id) &&
    typeof x.pubkey === 'string' && Object.hasOwn(publishers, x.pubkey) &&
    Number.isInteger(x.created_at) && typeof x.content === 'string' && typeof x.sig === 'string' &&
    Array.isArray(x.tags) && x.tags.every((t) => Array.isArray(t) && t.every((v) => typeof v === 'string'))
  );
}

const addressOf = (e: Signed) => `${e.kind}:${e.pubkey}:${e.tags.find((t) => t[0] === 'd')?.[1] ?? ''}`;
const newer = (a: Signed, b: Signed) => a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id);

export function subscribeMissions(onFeed: (feed: Feed) => void, sources: Sources = {}): () => void {
  const relays = sources.relays ?? MISSION_RELAYS;
  const publishers = sources.publishers ?? MISSION_PUBLISHERS;
  const readings: Readings = new Map();
  /** Whether an event is worth keeping: a package that is, or genuinely was, its publisher's. */
  const authentic = (e: Signed) => {
    const r = readingOf(e, publishers, readings);
    return r.ok || !!r.from;
  };
  /**
   * Each relay's last answer this session, newest version per package. A package leaves a relay's
   * share only when that relay answers again without it: a dropped connection says nothing about
   * what was withdrawn.
   */
  const shares = new Map<string, Map<string, Signed>>();
  /** Relays answering right now: connected and caught up. */
  const live = new Set<string>();
  /** When each relay was last heard from, so a picture is dated to the last moment it was true. */
  const heard = new Map<string, number>();
  /** Relays still on their first attempt. While any is, nothing has failed for good yet. */
  const firstTry = new Set(relays);
  /** The copy kept on this device, by package: drawn until a relay answers, and again if every relay drops. */
  let kept = new Map<string, Signed>();
  let keptAt: Date | null = null;
  let stopped = false;
  let saving: ReturnType<typeof setTimeout> | null = null;
  const closers: (() => void)[] = [];
  /**
   * The tier as this subscription found it. Every save hands it to `set`, which refuses one after a
   * wipe: the copy is kept in memory and saved on a timer and as the page closes, and a wipe was
   * followed by it coming straight back, from this page or another tab [invariant 5].
   */
  const since = generation('wipeable');

  const stored = get<Stored>('wipeable', STORE);
  if (stored && Array.isArray(stored.events)) {
    for (const e of stored.events) if (wellFormed(e, publishers)) kept.set(addressOf(e), e);
    if (kept.size > 0) keptAt = new Date(stored.at);
  }

  /** The kept copy, bounded: newest version per package, the most recent first, under the caps. */
  const bounded = (byAddress: Map<string, Signed>) => {
    const out = new Map<string, Signed>();
    let chars = 0;
    for (const e of [...byAddress.values()].sort((a, b) => b.created_at - a.created_at)) {
      const size = e.content.length + 512;
      if (out.size >= PACKAGES_MAX || chars + size > KEPT_CHARS_MAX) break;
      out.set(addressOf(e), e);
      chars += size;
    }
    return out;
  };
  const save = () => {
    if (saving) clearTimeout(saving);
    saving = null;
    if (keptAt) set('wipeable', STORE, { at: keptAt.toISOString(), events: [...kept.values()] } satisfies Stored, since);
  };
  const saveSoon = () => {
    if (!saving) saving = setTimeout(save, SAVE_MS);
  };

  /** Say what the screen should draw: every relay's last answer, live while any is answering. */
  const report = (settled = false) => {
    if (stopped) return;
    if (shares.size > 0) {
      const merged = new Map<string, Signed>();
      for (const share of shares.values()) {
        for (const [address, e] of share) {
          const held = merged.get(address);
          if (!held || newer(e, held)) merged.set(address, e);
        }
      }
      /*
       * A newer version this device already saw outranks an older one a lagging relay still
       * serves. A package no relay serves any more is not brought back from the copy: only what
       * some relay answered with is drawn.
       */
      for (const [address, e] of kept) {
        const served = merged.get(address);
        // Only a copy whose signature still verifies: a tampered one may hide nothing.
        if (served && newer(e, served) && authentic(e)) merged.set(address, e);
      }
      if (live.size > 0) {
        kept = bounded(merged);
        keptAt = new Date();
        // Each relay's full answer is kept at once; the events that follow it, a moment later [11.R].
        if (settled) save();
        else saveSoon();
        onFeed({ status: 'live', at: keptAt, ...collect([...merged.values()], keptAt, publishers, readings) });
      } else {
        // Every relay has dropped: the picture stands as of the last moment one was heard.
        onFeed({ status: 'cached', at: keptAt!, ...collect([...merged.values()], new Date(), publishers, readings) });
      }
    } else if (kept.size > 0 && keptAt) {
      onFeed({ status: 'cached', at: keptAt, ...collect([...kept.values()], new Date(), publishers, readings) });
    } else if (firstTry.size > 0) {
      // One relay failing while another is still reaching is not "unavailable" yet.
      onFeed({ status: 'connecting' });
    } else {
      onFeed({ status: 'unavailable' });
    }
  };

  const open = (url: string) => {
    let attempt = 0;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let waiting: ReturnType<typeof setTimeout> | null = null;
    let probing: ReturnType<typeof setTimeout> | null = null;

    /** Lost this relay: it stops counting as live, its last answer stands, and it is tried again later. */
    const fall = () => {
      // The retry is set first, so nothing that goes wrong while redrawing can stop it [11.R].
      const wait = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]!;
      attempt += 1;
      retry = setTimeout(connect, wait);
      if (live.delete(url) && live.size === 0 && keptAt) {
        // The last relay answering just went: the picture held until it was last heard, and no later.
        const last = Math.max(0, ...heard.values());
        keptAt = new Date(last > 0 ? last : Date.now());
        if (saving) clearTimeout(saving);
        save();
      }
      firstTry.delete(url);
      report();
    };

    const connect = () => {
      if (stopped) return;
      /** How many times in a row this relay had failed when this connection was made. */
      const tries = attempt;
      /** What this connection has received, newest per package. Becomes the relay's share at EOSE. */
      const received = new Map<string, Signed>();
      let caughtUp = false;
      let failed = false;
      /** Frames on this connection whose signature did not verify. */
      let unverified = 0;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        return fall();
      }
      socket = ws;
      const clear = () => {
        if (waiting) clearTimeout(waiting);
        if (probing) clearTimeout(probing);
        waiting = probing = null;
      };
      /*
       * Listeners, not `on*` properties, and every failure funnels through one place. A socket may
       * report failure only by dispatching an event, and a subscription listening on properties
       * alone never hears it: it would say "reaching The Record" forever.
       */
      const fail = () => {
        if (failed || stopped) return;
        failed = true;
        clear();
        try {
          ws.close();
        } catch {
          /* already gone */
        }
        if (socket === ws) socket = null;
        fall();
      };
      /*
       * A relay that answered and then misbehaved — frames that do not verify, or a refusal after the
       * answer — gets no credit for having answered: the wait goes on growing from where it was. The
       * reset at its end of answer came first, so a relay doing this every time was asked again every
       * five seconds, re-sending its whole answer each time [audit 11, second grid — review].
       */
      const refuse = () => {
        attempt = Math.max(attempt, tries);
        fail();
      };
      const send = (frame: unknown[]) => {
        try {
          ws.send(JSON.stringify(frame));
        } catch {
          fail();
        }
      };
      /** Ask whether the relay is still there: an empty request, which an answering relay ends at once. */
      const probe = () => {
        send(['REQ', 'still-there', { ids: ['0'.repeat(64)] }]);
        waiting = setTimeout(fail, CONNECT_MS);
      };
      waiting = setTimeout(fail, CONNECT_MS);
      ws.addEventListener('open', () => {
        if (waiting) clearTimeout(waiting);
        waiting = setTimeout(fail, ANSWER_MS);
        send(['REQ', 'missions', { kinds: [MISSION_PACKAGE_KIND], authors: Object.keys(publishers), '#t': ['navcom_mission'] }]);
      });
      ws.addEventListener('message', (m: MessageEvent) => {
        // A browser delivers nothing once a socket is closing; a socket that still does is not listened to.
        if (failed) return;
        let frame: unknown[];
        try {
          frame = JSON.parse(String(m.data)) as unknown[];
        } catch {
          return;
        }
        if (!Array.isArray(frame)) return;
        heard.set(url, Date.now());
        if (frame[0] === 'EVENT' && frame[1] === 'missions') {
          const e = frame[2];
          // Checked before it is kept: shape, publisher and signature [11.R] — the cheap questions
          // first, so nothing this would not keep costs a signature check [audit 11, second grid].
          if (!wellFormed(e, publishers)) return;
          const address = addressOf(e);
          const held = received.get(address);
          if (held ? !newer(e, held) : received.size >= PACKAGES_MAX) return;
          if (!authentic(e)) {
            if (++unverified >= UNVERIFIED_MAX) refuse();
            return;
          }
          received.set(address, e);
          // Before EOSE the relay is replaying what it holds; after it, every event is news.
          if (caughtUp) report();
        } else if (frame[0] === 'EOSE' && frame[1] === 'missions') {
          if (waiting) clearTimeout(waiting);
          waiting = null;
          caughtUp = true;
          /*
           * The wait starts over only once the relay has really answered, as `terminal/subscribe.ts`
           * does — and not for good: one that then refuses or sends what does not verify takes it
           * back (`refuse`). Reset when the socket merely opened, a relay that opened and then
           * refused was asked again every five seconds for as long as the page was open [audit 11,
           * second grid].
           */
          attempt = 0;
          firstTry.delete(url);
          live.add(url);
          shares.set(url, received);
          report(true);
          probing = setTimeout(probe, PROBE_MS);
        } else if ((frame[0] === 'EOSE' || frame[0] === 'CLOSED') && frame[1] === 'still-there') {
          // Any answer is an answer: a relay that refuses the question is still there to refuse it.
          if (waiting) clearTimeout(waiting);
          waiting = null;
          send(['CLOSE', 'still-there']);
          probing = setTimeout(probe, PROBE_MS);
        } else if (frame[0] === 'CLOSED' && frame[1] === 'missions') {
          // Refused — wants sign-in, is rate-limiting, or is shutting down: a failure, said as one.
          refuse();
        }
      });
      /*
       * A socket that says it closed was there until it said so; one caught by a timeout died at
       * some moment nobody saw, so its picture is dated to the last thing it sent [11.E].
       */
      const dropped = () => {
        if (caughtUp && !failed) heard.set(url, Date.now());
        fail();
      };
      ws.addEventListener('close', dropped);
      ws.addEventListener('error', dropped);
    };

    closers.push(() => {
      if (retry) clearTimeout(retry);
      if (waiting) clearTimeout(waiting);
      if (probing) clearTimeout(probing);
      socket?.close();
    });
    connect();
  };

  /** A page closing mid-wait keeps what it had: the copy is the offline picture. */
  const flush = () => {
    if (saving) {
      clearTimeout(saving);
      save();
    }
  };
  if (typeof addEventListener === 'function') addEventListener('pagehide', flush);
  /*
   * The copy on the device is gone, so it is no longer drawn: only what a relay answers this
   * session is. Offline, that is nothing, said as connecting or unavailable rather than as the
   * picture the wipe destroyed.
   */
  const unwipe = onWipe(() => {
    if (saving) clearTimeout(saving);
    saving = null;
    kept = new Map();
    report();
  });

  report();
  for (const url of relays) open(url);
  return () => {
    stopped = true;
    flush();
    unwipe();
    if (typeof removeEventListener === 'function') removeEventListener('pagehide', flush);
    for (const close of closers) close();
  };
}
