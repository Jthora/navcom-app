import type { Browser, BrowserContext, Page } from '@playwright/test';
import { devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';
import type { LocalRelay } from './relay-server';

/**
 * A first visit with nothing faked inside the page.
 *
 * Every other harness here either stubs `WebSocket` inside the page [device.ts, `seedDevice`] or
 * points one relay setting at a local relay [`liveDevice`]. A journey from a first visit can do
 * neither: the visitor has no settings yet, and the app dials the relays it is built with — the
 * meeting set, The Record, its mirror — which are strangers' servers. So the page keeps its own
 * `WebSocket` and every socket it opens, to any address, is carried to one relay on this machine.
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

export async function hermetic(browser: Browser, relay: LocalRelay, over: Parameters<Browser['newContext']>[0] = {}): Promise<Hermetic> {
  const context = await browser.newContext({ ...devices['Pixel 5'], ...over });
  const dialled = new Set<string>();
  const outside: string[] = [];
  await context.routeWebSocket(/.*/, (route) => {
    dialled.add(route.url());
    const upstream = new WebSocket(relay.url);
    const waiting: string[] = [];
    upstream.on('open', () => {
      for (const m of waiting.splice(0)) upstream.send(m);
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
    route.onMessage((m) => {
      const s = typeof m === 'string' ? m : m.toString();
      if (upstream.readyState === WebSocket.OPEN) upstream.send(s);
      else waiting.push(s);
    });
    route.onClose(() => upstream.close());
  });
  context.on('request', (r) => {
    const u = new URL(r.url());
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost' && u.protocol.startsWith('http')) outside.push(r.url());
  });
  const page = await context.newPage();
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
