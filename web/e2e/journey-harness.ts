import type { Browser, BrowserContext, Page } from '@playwright/test';
import { devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';
import { startRelay, type LocalRelay } from './relay-server';

/**
 * Every relay a journey's phones dial, each its own relay on this machine.
 *
 * The first journeys carried every address to one relay, so a phone that published to one relay
 * while the other listened on another would have passed: nothing could tell them apart. Here
 * `wss://relay.damus.io`, `wss://nos.lol`, The Record and every other address are separate, shared
 * by the phones in one journey as the real ones are, and each keeps only the newest replaceable
 * event and honours `limit`, as real relays do [relay-server.ts, `realistic`].
 */
export class RelayNet {
  private relays = new Map<string, Promise<LocalRelay>>();

  /** The relay standing in for `url`, by host: a trailing slash or a path is the same relay. */
  of(url: string): Promise<LocalRelay> {
    const host = new URL(url).host;
    let relay = this.relays.get(host);
    if (!relay) {
      relay = startRelay({ realistic: true });
      this.relays.set(host, relay);
    }
    return relay;
  }

  /** Every event any of them accepted, with the host it went to. */
  async received(): Promise<{ host: string; event: LocalRelay['received'][number] }[]> {
    const out: { host: string; event: LocalRelay['received'][number] }[] = [];
    for (const [host, relay] of this.relays) for (const event of (await relay).received) out.push({ host, event });
    return out;
  }

  /** Which hosts were dialled at all. */
  hosts(): string[] {
    return [...this.relays.keys()].sort();
  }

  async close(): Promise<void> {
    await Promise.all([...this.relays.values()].map(async (r) => (await r).close()));
  }
}

/**
 * A first visit with nothing faked inside the page.
 *
 * Every other harness here either stubs `WebSocket` inside the page [device.ts, `seedDevice`] or
 * points one relay setting at a local relay [`liveDevice`]. A journey from a first visit can do
 * neither: the visitor has no settings yet, and the app dials the relays it is built with — the
 * meeting set, The Record, its mirror — which are strangers' servers. So the page keeps its own
 * `WebSocket` and every socket it opens, to any address, is carried to a relay on this machine: given
 * a {@link RelayNet}, the one standing in for that address.
 * The app speaks real NIP-01 to a real relay, and nothing it signs reaches the internet.
 *
 * `dialled` records which addresses the app tried, so a journey can say where it would have gone.
 */
export interface Hermetic {
  context: BrowserContext;
  page: Page;
  dialled: Set<string>;
  /** Requests to anywhere but this server, by URL: read, never blocked. */
  outside: string[];
}

export async function hermetic(browser: Browser, relays: LocalRelay | RelayNet, over: Parameters<Browser['newContext']>[0] = {}): Promise<Hermetic> {
  // The project's own engine; the phone it plays is Pixel 5 unless JOURNEY_DEVICE names another,
  // so the same journeys run as an iPhone under WebKit.
  const phone = devices[process.env['JOURNEY_DEVICE'] ?? 'Pixel 5']!;
  const { defaultBrowserType: _engine, ...look } = phone;
  const context = await browser.newContext({ ...look, ...over });
  const dialled = new Set<string>();
  const outside: string[] = [];
  await context.routeWebSocket(/.*/, (route) => {
    dialled.add(route.url());
    const waiting: string[] = [];
    let upstream: WebSocket | null = null;
    let closed = false;
    route.onMessage((m) => {
      const s = typeof m === 'string' ? m : m.toString();
      if (upstream?.readyState === WebSocket.OPEN) upstream.send(s);
      else waiting.push(s);
    });
    route.onClose(() => {
      closed = true;
      upstream?.close();
    });
    const target = relays instanceof RelayNet ? relays.of(route.url()) : Promise.resolve(relays);
    void target.then((relay) => {
      if (closed) return;
      upstream = new WebSocket(relay.url);
      upstream.on('open', () => {
        for (const m of waiting.splice(0)) upstream!.send(m);
      });
      upstream.on('message', (data) => {
        try {
          route.send(data.toString());
        } catch {
          /* the page closed it */
        }
      });
      upstream.on('close', () => void route.close().catch(() => {}));
      upstream.on('error', () => void route.close().catch(() => {}));
    });
  });
  context.on('request', (r) => {
    const u = new URL(r.url());
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost' && u.protocol.startsWith('http')) outside.push(r.url());
  });
  const page = await context.newPage();
  // A weak signal, when asked for: about 400 kbps each way and 400 ms round trips, Chromium only.
  if (process.env['JOURNEY_THROTTLE'] && browser.browserType().name() === 'chromium') {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 50_000, uploadThroughput: 50_000 });
  }
  return { context, page, dialled, outside };
}

/** Puts an event on the relay as a publisher would, and waits for its OK. */
export async function publish(relay: LocalRelay, event: { id: string }): Promise<void> {
  const ws = new WebSocket(relay.url);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => ws.send(JSON.stringify(['EVENT', event])));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg[0] === 'OK' && msg[1] === event.id) {
        ws.close();
        msg[2] ? resolve() : reject(new Error(String(msg[3])));
      }
    });
    ws.once('error', reject);
  });
}

/** Screenshots a journey's steps in order, into one folder, so a person can walk them after. */
export function shots(dir: string) {
  mkdirSync(dir, { recursive: true });
  let n = 0;
  return async (page: Page, name: string, fullPage = false) => {
    n += 1;
    await page.screenshot({ path: join(dir, `${String(n).padStart(2, '0')}-${name}.png`), fullPage });
  };
}
