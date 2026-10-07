/**
 * A small NIP-01 relay on 127.0.0.1, for tests that need the real `SimplePool` on the other end.
 *
 * The defects this was written for live in how nostr-tools behaves on a real socket -- what it
 * does with `since` on reconnect, what a `CLOSED` does to its bookkeeping, what happens when a
 * relay is not there at boot. A fake pool models what somebody believed about that, and the
 * belief is what was wrong. Nothing here touches the network beyond loopback.
 *
 * Honest by default: it filters with nostr-tools' own `matchFilters`, `since` included, so a
 * filter pushed into the future really does make it deliver nothing.
 */
import { createServer } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { matchFilters, type Filter } from "nostr-tools/filter";
import type { Event } from "nostr-tools/core";

export interface Req {
  sub: string;
  filters: Filter[];
  at: number;
}

export interface LocalRelay {
  url: string;
  port: number;
  /** Every REQ received, in order. */
  reqs: Req[];
  /** Every EVENT published to it, accepted or not. */
  published: Event[];
  /** Open subscriptions right now, across connections. */
  openSubs(): number;
  /** Sends a raw EVENT frame to every open subscription, ignoring its filters -- a hostile relay. */
  push(event: Event): void;
  /** Delivers an event the way a client publishing it would: stored if not ephemeral, sent to matches. */
  deliver(event: Event): void;
  /** Drops every connection without a word, as a router reboot does. */
  dropAll(): void;
  /** When set, a REQ is answered with CLOSED carrying this reason instead of being held. */
  refuseReq: ((filters: Filter[]) => string | null) | null;
  /** When set, an EVENT is answered OK false with this reason. */
  refuseEvent: ((event: Event) => string | null) | null;
  /**
   * Sends CLOSED for every open subscription, keeping the connection. The reason is sent as given,
   * whatever its type: a relay that sends `null` or an object is the case being modelled.
   */
  closeSubs(reason: unknown): void;
  /**
   * When false, a REQ is held open and never answered: no stored events and no EOSE, though live
   * events still reach it. A relay that takes the subscription and says nothing.
   */
  answerReqs: boolean;
  /** When true, nothing is answered at all -- no EOSE, no OK, no events. A relay that is hung. */
  hang: boolean;
  close(): Promise<void>;
}

/** A port nothing is listening on yet, for a relay that comes up later. */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

const isEphemeral = (kind: number) => kind >= 20_000 && kind < 30_000;

export async function startRelay(opts: { port?: number } = {}): Promise<LocalRelay> {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: opts.port ?? 0 });
  await new Promise<void>((resolve, reject) => {
    wss.once("listening", () => resolve());
    wss.once("error", reject);
  });
  const address = wss.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const stored: Event[] = [];
  const subs = new Map<WebSocket, Map<string, Filter[]>>();
  const send = (ws: WebSocket, frame: unknown[]) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
  };

  const relay: LocalRelay = {
    url: `ws://127.0.0.1:${port}`,
    port,
    reqs: [],
    published: [],
    refuseReq: null,
    refuseEvent: null,
    answerReqs: true,
    hang: false,
    openSubs: () => [...subs.values()].reduce((n, m) => n + m.size, 0),
    push(event) {
      for (const [ws, mine] of subs) for (const id of mine.keys()) send(ws, ["EVENT", id, event]);
    },
    deliver(event) {
      if (!isEphemeral(event.kind)) stored.push(event);
      for (const [ws, mine] of subs) {
        for (const [id, filters] of mine) {
          if (matchFilters(filters, event)) send(ws, ["EVENT", id, event]);
        }
      }
    },
    dropAll() {
      for (const ws of wss.clients) ws.terminate();
    },
    closeSubs(reason) {
      for (const [ws, mine] of subs) {
        for (const id of mine.keys()) send(ws, ["CLOSED", id, reason]);
        mine.clear();
      }
    },
    async close() {
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };

  wss.on("connection", (ws) => {
    subs.set(ws, new Map());
    ws.on("close", () => subs.delete(ws));
    ws.on("error", () => {});
    ws.on("message", (data) => {
      let msg: unknown[];
      try {
        msg = JSON.parse(String(data)) as unknown[];
      } catch {
        return;
      }
      const mine = subs.get(ws);
      if (!mine) return;
      switch (msg[0]) {
        case "REQ": {
          const id = String(msg[1]);
          const filters = msg.slice(2) as Filter[];
          relay.reqs.push({ sub: id, filters: JSON.parse(JSON.stringify(filters)) as Filter[], at: Date.now() });
          if (relay.hang) return;
          const refusal = relay.refuseReq?.(filters) ?? null;
          if (refusal) {
            send(ws, ["CLOSED", id, refusal]);
            return;
          }
          mine.set(id, filters);
          if (!relay.answerReqs) return;
          for (const e of stored) if (matchFilters(filters, e)) send(ws, ["EVENT", id, e]);
          send(ws, ["EOSE", id]);
          return;
        }
        case "CLOSE": {
          mine.delete(String(msg[1]));
          return;
        }
        case "EVENT": {
          const event = msg[1] as Event;
          relay.published.push(event);
          if (relay.hang) return;
          const refusal = relay.refuseEvent?.(event) ?? null;
          send(ws, ["OK", event.id, refusal === null, refusal ?? ""]);
          if (refusal === null) relay.deliver(event);
          return;
        }
      }
    });
  });

  return relay;
}

/** Polls until `check` stops throwing, or fails with its last error. */
export async function eventually(check: () => void | Promise<void>, ms = 8_000, every = 50): Promise<void> {
  const until = Date.now() + ms;
  let last: unknown;
  for (;;) {
    try {
      await check();
      return;
    } catch (err) {
      last = err;
    }
    if (Date.now() > until) throw last;
    await new Promise((r) => setTimeout(r, every));
  }
}
