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
 * its last answer, and the screen shows the newest version of each package across all of them. A
 * mirror that has fallen behind cannot hide a newer version The Record has, and cannot forge one;
 * either answering alone is enough to draw the map.
 *
 * What each relay learns is that a device opened NavCom's missions: one subscription to all of
 * them, never which part of the map anybody looked at. The Record also logs the address each
 * connection comes from until it applies the grid's reader rule [grid.md §1]; its mirror does not.
 *
 * **Offline is a normal state** [C10]. The last set seen is kept on this device, in the Wipeable
 * tier — mission history is Wipeable [invariant 5], so a panic wipe takes it — and shown with its
 * age when no relay can be reached. It is stored as the signed events, not as the missions read
 * from them, so a copy that was tampered with fails verification on the way back in.
 *
 * Loaded by dynamic import after first paint: verification brings the signature library, and the
 * map should draw before it arrives.
 */
import { MISSION_PACKAGE_KIND, MISSION_PUBLISHERS, MISSION_RELAYS } from '@navcom/core';
import { get, set } from '$lib/terminal/storage';
import { collect, type Collected } from './collect';

export type Feed =
  | ({ status: 'live'; at: Date } & Collected)
  | ({ status: 'cached'; at: Date } & Collected)
  | { status: 'connecting' }
  | { status: 'unavailable' };

const STORE = 'missions';
/** Retried with backoff while the page is open: 5 s, 10 s, 20 s… never more than 5 minutes apart. */
const RETRY_MS = [5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000];
/**
 * How long a connection may take before it counts as failed. A phone with no signal can leave a
 * socket opening for minutes before the browser gives up; this says "unavailable" — or shows the
 * last copy with its age — long before that, and keeps trying behind it.
 */
const CONNECT_MS = 8_000;

type Stored = { at: string; events: unknown[] };

export interface Sources {
  /** The relays to read, all at once. */
  relays?: readonly string[];
  /** Whose packages count. The app reads its registered publishers; a test signs its own. */
  publishers?: NonNullable<Parameters<typeof collect>[2]>;
}

export function subscribeMissions(onFeed: (feed: Feed) => void, sources: Sources = {}): () => void {
  const relays = sources.relays ?? MISSION_RELAYS;
  const publishers = sources.publishers ?? MISSION_PUBLISHERS;
  /**
   * Each relay's last answer this session. A package leaves a relay's share only when that relay
   * answers again without it: a dropped connection says nothing about what was withdrawn.
   */
  const shares = new Map<string, Map<string, unknown>>();
  /** Relays answering right now: connected and caught up. */
  const live = new Set<string>();
  /** Relays still on their first attempt. While any is, nothing has failed for good yet. */
  const firstTry = new Set(relays);
  /** The copy kept on this device: drawn until a relay answers, and again if every relay drops. */
  let kept = new Map<string, unknown>();
  let keptAt: Date | null = null;
  let stopped = false;
  const closers: (() => void)[] = [];

  const stored = get<Stored>('wipeable', STORE);
  if (stored && Array.isArray(stored.events)) {
    for (const e of stored.events) {
      const id = (e as { id?: string })?.id;
      if (typeof id === 'string') kept.set(id, e);
    }
    if (kept.size > 0) keptAt = new Date(stored.at);
  }

  /** Say what the screen should draw: every relay's last answer, live while any is answering. */
  const report = () => {
    if (stopped) return;
    if (shares.size > 0) {
      const merged = new Map<string, unknown>();
      for (const held of shares.values()) for (const [id, e] of held) merged.set(id, e);
      const all = [...merged.values()];
      if (live.size > 0) {
        kept = merged;
        keptAt = new Date();
        set('wipeable', STORE, { at: keptAt.toISOString(), events: all } satisfies Stored);
        onFeed({ status: 'live', at: keptAt, ...collect(all, keptAt, publishers) });
      } else {
        // Every relay has dropped: the picture stands as of the last moment one was answering.
        onFeed({ status: 'cached', at: keptAt!, ...collect(all, new Date(), publishers) });
      }
    } else if (kept.size > 0 && keptAt) {
      onFeed({ status: 'cached', at: keptAt, ...collect([...kept.values()], new Date(), publishers) });
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
    let opening: ReturnType<typeof setTimeout> | null = null;

    /** Lost this relay: it stops counting as live, its last answer stands, and it is tried again later. */
    const fall = () => {
      if (live.delete(url) && live.size === 0 && keptAt) {
        // The last relay answering just went: the picture held until this moment, and no later.
        keptAt = new Date();
        set('wipeable', STORE, { at: keptAt.toISOString(), events: [...kept.values()] } satisfies Stored);
      }
      firstTry.delete(url);
      report();
      const wait = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]!;
      attempt += 1;
      retry = setTimeout(connect, wait);
    };

    const connect = () => {
      if (stopped) return;
      /** What this connection has received. Becomes the relay's share at EOSE, so nothing withdrawn lingers. */
      const received = new Map<string, unknown>();
      let caughtUp = false;
      let failed = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        return fall();
      }
      socket = ws;
      /*
       * Listeners, not `on*` properties, and every failure funnels through one place. A socket may
       * report failure only by dispatching an event, and a subscription listening on properties
       * alone never hears it: it would say "reaching The Record" forever.
       */
      const fail = () => {
        if (failed || stopped) return;
        failed = true;
        if (opening) clearTimeout(opening);
        try {
          ws.close();
        } catch {
          /* already gone */
        }
        if (socket === ws) socket = null;
        fall();
      };
      opening = setTimeout(fail, CONNECT_MS);
      ws.addEventListener('open', () => {
        if (opening) clearTimeout(opening);
        attempt = 0;
        ws.send(
          JSON.stringify([
            'REQ',
            'missions',
            { kinds: [MISSION_PACKAGE_KIND], authors: Object.keys(publishers), '#t': ['navcom_mission'] }
          ])
        );
      });
      ws.addEventListener('message', (m: MessageEvent) => {
        let frame: unknown[];
        try {
          frame = JSON.parse(String(m.data)) as unknown[];
        } catch {
          return;
        }
        if (frame[0] === 'EVENT') {
          const e = frame[2] as { id?: string } | undefined;
          if (!e || typeof e.id !== 'string') return;
          received.set(e.id, e);
          // Before EOSE the relay is replaying what it holds; after it, every event is news.
          if (caughtUp) report();
        } else if (frame[0] === 'EOSE') {
          caughtUp = true;
          firstTry.delete(url);
          live.add(url);
          shares.set(url, received);
          report();
        }
      });
      ws.addEventListener('close', fail);
      ws.addEventListener('error', fail);
    };

    closers.push(() => {
      if (retry) clearTimeout(retry);
      if (opening) clearTimeout(opening);
      socket?.close();
    });
    connect();
  };

  report();
  for (const url of relays) open(url);
  return () => {
    stopped = true;
    for (const close of closers) close();
  };
}
