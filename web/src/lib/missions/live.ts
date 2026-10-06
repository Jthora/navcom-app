/**
 * Missions, read live by this device from the relay that holds them.
 *
 * **Every device draws its own picture** [CLAUDE.md]. A mission is a signed event on The Record;
 * this subscribes to it directly, verifies each package's signature here, and keeps the
 * subscription open so a new or closed mission shows without a reload. Nothing is baked into the
 * site and no server stands between the relay and the screen.
 *
 * An earlier version had the site's build take a snapshot instead, so that the map would contact
 * nobody but navcom.app. That made one build draw the picture for everyone and tied freshness to
 * deploys, which is the centralisation this architecture exists to avoid. The privacy cost of the
 * direct route is small and stated: The Record learns that a device opened NavCom's missions — one
 * subscription to all of them, never which part of the map anybody looked at.
 *
 * **Offline is a normal state** [C10]. The last set seen is kept on this device, in the Wipeable
 * tier — mission history is Wipeable [invariant 5], so a panic wipe takes it — and shown with its
 * age when the relay cannot be reached. It is stored as the signed events, not as the missions
 * read from them, so a copy that was tampered with fails verification on the way back in.
 *
 * Loaded by dynamic import after first paint: verification brings the signature library, and the
 * map should draw before it arrives.
 */
import { MISSION_PACKAGE_KIND, MISSION_PUBLISHERS, THE_RECORD } from '@navcom/core';
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

export function subscribeMissions(onFeed: (feed: Feed) => void, relay = THE_RECORD): () => void {
  /** What the screen is drawing from: the remembered copy until the relay has answered, then the relay's. */
  let shown = new Map<string, unknown>();
  /** What this connection has received. Replaces `shown` at EOSE, so nothing withdrawn lingers. */
  let received = new Map<string, unknown>();
  let shownAt: Date | null = null;
  let live = false;
  let stopped = false;
  let attempt = 0;
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const remembered = get<Stored>('wipeable', STORE);
  if (remembered && Array.isArray(remembered.events) && remembered.events.length > 0) {
    for (const e of remembered.events) {
      const id = (e as { id?: string })?.id;
      if (typeof id === 'string') shown.set(id, e);
    }
    shownAt = new Date(remembered.at);
    onFeed({ status: 'cached', at: shownAt, ...collect([...shown.values()], new Date()) });
  } else {
    onFeed({ status: 'connecting' });
  }

  /** The relay has answered: what it sent is now the truth, kept on this device for next time. */
  const publishLive = () => {
    shown = received;
    shownAt = new Date();
    const all = [...shown.values()];
    set('wipeable', STORE, { at: shownAt.toISOString(), events: all } satisfies Stored);
    onFeed({ status: 'live', at: shownAt, ...collect(all, shownAt) });
  };

  /** Lost the relay: say so with what this device last saw, and try again later. */
  const fall = () => {
    live = false;
    if (shown.size > 0 && shownAt) {
      onFeed({ status: 'cached', at: shownAt, ...collect([...shown.values()], new Date()) });
    } else {
      onFeed({ status: 'unavailable' });
    }
    const wait = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]!;
    attempt += 1;
    retry = setTimeout(connect, wait);
  };

  let opening: ReturnType<typeof setTimeout> | null = null;
  let failed = false;

  const connect = () => {
    if (stopped) return;
    received = new Map();
    failed = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(relay);
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
          { kinds: [MISSION_PACKAGE_KIND], authors: Object.keys(MISSION_PUBLISHERS), '#t': ['navcom_mission'] }
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
        if (live) publishLive();
      } else if (frame[0] === 'EOSE') {
        live = true;
        publishLive();
      }
    });
    ws.addEventListener('close', fail);
    ws.addEventListener('error', fail);
  };

  connect();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    if (opening) clearTimeout(opening);
    socket?.close();
  };
}
