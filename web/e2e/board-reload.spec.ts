import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { seedDevice, open, serviceWorkerReady, holdUntil, TEST_SECRET } from './device';

/**
 * A board left open on an older build asks to be reloaded, on the Watch screen and nowhere else.
 *
 * `escalation.spec.md` decided it: a board on an older build can answer in a way a newer operator's
 * phone shows and cannot confirm, so it asks to be reloaded when a newer one is waiting. Everything
 * on a board lives in that page, so the asking is all it does — the holder reloads, by holding a
 * control that says first what reloading clears.
 *
 * **What is faked, and why.** A newer build cannot be deployed in the middle of a test, and
 * Playwright cannot reach a worker's own fetches to stand one in. So the worker controlling the page
 * is stood in for, at `navigator.serviceWorker.controller`, by one that says it is another commit,
 * and the page is told a worker took over the way the browser tells it. The page's own code does
 * everything else, against the built output. That the real worker answers with the commit the stamp
 * names is asserted against the real worker, below.
 *
 * Nothing here may interrupt anybody: no notification, no badge, no vibration, from the moment the
 * newer build is known until the holder's own press. Counted from just before it is known: the
 * holder's own hold to take the watch vibrates, as every held threshold does (`haptic.spec.ts`).
 *
 * `ServiceWorkerRegistration.update` is counted, and can stand in for a deploy's worker taking over:
 * a second build cannot be served beside the first, so the one fact checked is the one that matters
 * [review: board reload] -- nothing but the hold asks the browser for a new worker. Asked in the
 * background, the new worker deleted the old build's caches as it took over, and the next tap to a
 * screen the page had not loaded yet reloaded it, clearing the board.
 */

const WATCH_SECRET = 'a'.repeat(63) + '3';

/** The commit this build is, and one it is not. */
const BUILT = (JSON.parse(readFileSync('build/version.json', 'utf8')) as { commit: string }).commit;
const ANOTHER = BUILT === 'fffffff' ? 'eeeeeee' : 'fffffff';

async function watchPub(): Promise<string> {
  const { getPublicKey } = await import('nostr-tools/pure');
  return getPublicKey(Uint8Array.from((WATCH_SECRET.match(/../g) ?? []).map((b) => parseInt(b, 16))));
}

/** A signal from an operator, sealed to this phone as the watch's holder. */
async function signalTo(type: 'on-station' | 'query', payload: Record<string, unknown>) {
  const { generateSecretKey, finalizeEvent, getPublicKey } = await import('nostr-tools/pure');
  const { buildSignal } = await import('@navcom/core');
  const mine = Uint8Array.from((TEST_SECRET.match(/../g) ?? []).map((b) => parseInt(b, 16)));
  const sender = generateSecretKey();
  return finalizeEvent(
    buildSignal(sender, { pubkey: await watchPub(), holders: [getPublicKey(mine)] }, type, payload as never, 1_800_000_000),
    sender
  );
}

/**
 * Counts anything that would interrupt somebody, and lets a test stand another build in as the worker
 * controlling the page. Installed before the app's own scripts, on every load.
 */
async function standIns(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const g = globalThis as unknown as Record<string, unknown>;
    const counts = { notification: 0, vibrate: 0, badge: 0 };
    g.__interrupts = counts;

    const proto = ServiceWorkerContainer.prototype;
    const real = Object.getOwnPropertyDescriptor(proto, 'controller');
    Object.defineProperty(proto, 'controller', {
      configurable: true,
      get(this: ServiceWorkerContainer) {
        return (g.__otherBuild as ServiceWorker | undefined) ?? real?.get?.call(this) ?? null;
      }
    });

    const vibrate = typeof navigator.vibrate === 'function' ? navigator.vibrate.bind(navigator) : null;
    navigator.vibrate = ((pattern: VibratePattern) => {
      counts.vibrate += 1;
      return vibrate ? vibrate(pattern) : true;
    }) as Navigator['vibrate'];
    (navigator as unknown as { setAppBadge: () => Promise<void> }).setAppBadge = async () => {
      counts.badge += 1;
    };
    if (typeof Notification !== 'undefined') {
      const Real = Notification;
      g.Notification = new Proxy(Real, {
        construct(target, args) {
          counts.notification += 1;
          return Reflect.construct(target, args);
        }
      });
      Real.requestPermission = () => {
        counts.notification += 1;
        return Promise.resolve('denied' as NotificationPermission);
      };
    }
    // Every ask for a new worker, and -- where a test says so -- a deploy's worker taking over at once.
    g.__updates = 0;
    const realUpdate = ServiceWorkerRegistration.prototype.update;
    ServiceWorkerRegistration.prototype.update = function (this: ServiceWorkerRegistration) {
      g.__updates = (g.__updates as number) + 1;
      const commit = g.__updateTakesOver as string | undefined;
      if (!commit) return realUpdate.call(this);
      g.__otherBuild = {
        postMessage(message: { ask?: string } | null, ports?: MessagePort[]) {
          if (message?.ask === 'build') ports?.[0]?.postMessage({ commit, version: 'deployed' });
        }
      };
      navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
      return Promise.resolve(this) as unknown as ReturnType<typeof realUpdate>;
    } as typeof realUpdate;

    const show = ServiceWorkerRegistration.prototype.showNotification;
    ServiceWorkerRegistration.prototype.showNotification = function (...args: Parameters<typeof show>) {
      counts.notification += 1;
      return show.apply(this, args);
    };
  });
}

/**
 * A worker of `commit` takes over this page, as the browser would say it -- answering which build it is
 * after `afterMs`, as a worker that has gone idle does.
 */
async function takenOverBy(page: Page, commit: string, afterMs = 0): Promise<void> {
  await page.evaluate(
    ({ c, ms }) => {
      (globalThis as unknown as Record<string, unknown>).__otherBuild = {
        postMessage(message: { ask?: string } | null, ports?: MessagePort[]) {
          if (message?.ask !== 'build') return;
          setTimeout(() => ports?.[0]?.postMessage({ commit: c, version: 'another' }), ms);
        }
      };
      navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
    },
    { c: commit, ms: afterMs }
  );
}

/**
 * Counts every time the readout or the reload section appears, from now: a node inserted, or the
 * readout's attribute set. A flash that is gone again before anybody asserts on it is still counted.
 */
async function countAppearances(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = globalThis as unknown as Record<string, unknown>;
    g.__appeared = 0;
    const hit = () => (g.__appeared = (g.__appeared as number) + 1);
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes' && (r.target as Element).hasAttribute('data-update-ready')) hit();
        for (const n of r.addedNodes) {
          if (n instanceof Element && (n.matches('[data-reload],[data-update-ready]') || n.querySelector('[data-reload],[data-update-ready]'))) hit();
        }
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-update-ready'] });
  });
}

const appeared = (page: Page) => page.evaluate(() => (globalThis as unknown as { __appeared: number }).__appeared);
const updates = (page: Page) => page.evaluate(() => (globalThis as unknown as { __updates: number }).__updates);

/** The deploy stamp, answering `commit` -- for the page, and for a worker's fetch on its behalf. */
async function deployed(page: Page, commit: string): Promise<void> {
  await page.context().route('**/version.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'max-age=0, must-revalidate' },
      body: JSON.stringify({ commit, builtAt: '2026-10-09T00:00:00Z', dirty: false })
    })
  );
}

const interrupts = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __interrupts: Record<string, number> }).__interrupts);

/** Waits until a worker actually controls the page, so the stand-in replaces one rather than installing one. */
async function controlled(page: Page): Promise<void> {
  await serviceWorkerReady(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 20_000 });
}

test.describe('a board on an older build', () => {
  test.setTimeout(60_000);

  test('says so in its panel, says what reloading clears, and reloads only on the hold', async ({ page }) => {
    await standIns(page);
    await seedDevice(page, {
      callsign: 'Wren',
      watchSecret: WATCH_SECRET,
      relayEvents: [
        await signalTo('on-station', { callsign: 'Owl', area: 'north', expected_duration: 3600 }),
        await signalTo('query', { text: 'bed tonight, has a dog', area: 'north' })
      ]
    });
    await open(page, '/terminal/watch/');
    await controlled(page);

    // The same build: nothing to say.
    await expect(page.getByText(/bed tonight, has a dog/)).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await expect(page.locator('[data-update-ready]')).toHaveCount(0);

    await holdUntil(page, 'button:has-text("take the watch")');
    await expect(page.locator('[data-watch-post]')).toContainText(/on station/i, { timeout: 10_000 });

    // Counted from here: taking the watch was the holder's own press, and a held threshold vibrates.
    const before = await interrupts(page);

    // A worker of the same commit, rebuilt — the box's daily rebuild — is not a newer build. Not even
    // for the moment before it has said so: a flash of the readout moves nothing now, but says
    // something false [review: board reload].
    await countAppearances(page);
    await takenOverBy(page, BUILT, 1_500);
    await page.waitForTimeout(2_500);
    await expect(page.locator('[data-update-ready]')).toHaveCount(0);
    expect(await appeared(page), 'the readout flashed for a same-commit rebuild').toBe(0);

    await takenOverBy(page, ANOTHER);
    const ready = page.locator('[data-watch-post] [data-update-ready]');
    await expect(ready).toBeVisible({ timeout: 10_000 });
    await expect(ready).toContainText(/older build/i);

    const cost = page.locator('[data-reload-cost]');
    await expect(cost).toBeVisible();
    await expect(cost).toContainText(/1 out, 1 waiting/i);
    await expect(cost).toContainText(/take the watch again after it/i);

    // Told, and nothing else: no notification, no badge, no buzz.
    expect(await interrupts(page)).toEqual(before);

    // Nothing reloads by itself, and nothing asks for a new worker.
    await page.evaluate(() => ((globalThis as unknown as Record<string, unknown>).__beforeReload = true));
    await page.waitForTimeout(2_000);
    expect(await page.evaluate(() => (globalThis as unknown as Record<string, unknown>).__beforeReload)).toBe(true);
    expect(await interrupts(page)).toEqual(before);
    expect(await updates(page)).toBe(0);

    const loaded = page.waitForEvent('load');
    await holdUntil(page, 'button:has-text("Hold to reload")');
    await loaded;
    await page.waitForSelector('html[data-hydrated="true"]', { timeout: 15_000 });
    expect(await page.evaluate(() => (globalThis as unknown as Record<string, unknown>).__beforeReload)).toBeUndefined();

    // A reload is not a take: the holder takes the watch again by their own hold.
    await expect(page.locator('[data-watch-post]')).toContainText(/off watch/i, { timeout: 10_000 });
    await page.waitForTimeout(500);
    await expect(page.locator('[data-update-ready]')).toHaveCount(0);
  });

  test('is not offered a reload while this phone is sending a Distress', async ({ page }) => {
    await standIns(page);
    await seedDevice(page, {
      callsign: 'Wren',
      watchSecret: WATCH_SECRET,
      watchtower: { pubkey: await watchPub(), relays: ['wss://fake.relay'] },
      relayEvents: []
    });
    await open(page, '/terminal/distress/');
    await controlled(page);
    await page.locator('button.raise').dispatchEvent('pointerdown');
    await page.waitForFunction(
      () => ((window as never as { __navcomPublished?: { kind: number }[] }).__navcomPublished ?? []).some((e) => e.kind === 20911),
      undefined,
      { timeout: 15_000 }
    );

    // To the Watch screen without leaving the page: a full load would stop the Distress itself.
    await page.getByRole('link', { name: /status/i }).first().click();
    await page.locator('nav[data-rail="all"] a[href="/terminal/watch/"]').click();
    await expect(page.locator('[data-watch-post]')).toBeVisible({ timeout: 10_000 });

    await takenOverBy(page, ANOTHER);
    await expect(page.locator('[data-update-ready]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-reload-held]')).toBeVisible();
    await expect(page.locator('[data-reload-held]')).toContainText(/sending a Distress/);
    await expect(page.locator('button:has-text("Hold to reload")')).toHaveCount(0);
    await expect(page.locator('[data-reload-cost]')).toHaveCount(0);
  });

  test('is said on the Watch screen only, never on Status or Distress', async ({ page }) => {
    await standIns(page);
    await seedDevice(page, { callsign: 'Wren', watchSecret: WATCH_SECRET, relayEvents: [] });
    for (const screen of ['/terminal/', '/terminal/distress/']) {
      await open(page, screen);
      await controlled(page);
      const before = await interrupts(page);
      await takenOverBy(page, ANOTHER);
      await page.waitForTimeout(1_000);
      await expect(page.locator('[data-update-ready]'), screen).toHaveCount(0);
      await expect(page.locator('[data-reload]'), screen).toHaveCount(0);
      expect(await interrupts(page)).toEqual(before);
      expect(await updates(page), screen).toBe(0);
    }
  });

  test('says a newer deploy, and asks the browser for its worker only from the hold', async ({ page }) => {
    // The deploy is known from the stamp while the worker serving this page is still this build. Asked
    // for in the background, that worker would take over and delete this build's caches, and leaving
    // this screen for one not yet loaded would reload the page.
    await standIns(page);
    await deployed(page, ANOTHER);
    await seedDevice(page, { callsign: 'Wren', watchSecret: WATCH_SECRET, relayEvents: [] });
    await open(page, '/terminal/watch/');
    await controlled(page);

    const ready = page.locator('[data-watch-post] [data-update-ready]');
    await expect(ready).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-reload]')).toContainText(/fetched first/i);
    await page.waitForTimeout(1_000);
    expect(await updates(page), 'asked the browser for a new worker by itself').toBe(0);

    // Away to a screen this page has not loaded, and back: the same page, the board still in it.
    await page.evaluate(() => ((globalThis as unknown as Record<string, unknown>).__samePage = true));
    await page.locator('a[href="/terminal/"]').first().click();
    await page.locator('nav[data-rail="all"] a[href="/terminal/patrols/"]').click();
    await expect(page).toHaveURL(/\/terminal\/patrols\/$/);
    await page.goBack();
    await page.goBack();
    await expect(ready).toBeVisible({ timeout: 10_000 });
    expect(await page.evaluate(() => (globalThis as unknown as Record<string, unknown>).__samePage)).toBe(true);
    expect(await updates(page)).toBe(0);

    // The hold asks for it, waits for it to take over, and only then reloads.
    await page.evaluate((c) => ((globalThis as unknown as Record<string, unknown>).__updateTakesOver = c), ANOTHER);
    const loaded = page.waitForEvent('load');
    await holdUntil(page, 'button:has-text("Hold to reload")');
    await loaded;
    await page.waitForSelector('html[data-hydrated="true"]', { timeout: 15_000 });
    expect(await page.evaluate(() => (globalThis as unknown as Record<string, unknown>).__samePage)).toBeUndefined();
  });

  test('knows a worker of another commit took over before the Watch screen opened', async ({ page }) => {
    // It took over while the holder was on another screen, where nothing was listening for it.
    await standIns(page);
    await seedDevice(page, { callsign: 'Wren', watchSecret: WATCH_SECRET, relayEvents: [] });
    await open(page, '/terminal/');
    await controlled(page);
    await page.evaluate((c) => {
      const g = globalThis as unknown as Record<string, unknown>;
      g.__otherBuild = {
        postMessage(message: { ask?: string } | null, ports?: MessagePort[]) {
          if (message?.ask === 'build') ports?.[0]?.postMessage({ commit: c, version: 'another' });
        }
      };
      g.__samePage = true;
    }, ANOTHER);
    await page.locator('nav[data-rail="all"] a[href="/terminal/watch/"]').click();
    await expect(page.locator('[data-watch-post] [data-update-ready]')).toBeVisible({ timeout: 10_000 });
    expect(await page.evaluate(() => (globalThis as unknown as Record<string, unknown>).__samePage)).toBe(true);
  });

  test('the real worker says which commit it is: the one the deploy stamp names', async ({ page }) => {
    await seedDevice(page, { callsign: 'Wren', relayEvents: [] });
    await open(page, '/terminal/');
    await controlled(page);
    const said = await page.evaluate(
      () =>
        new Promise<unknown>((resolve) => {
          const channel = new MessageChannel();
          const timer = setTimeout(() => resolve('<no answer>'), 5_000);
          channel.port1.onmessage = (e) => {
            clearTimeout(timer);
            resolve((e.data as { commit?: unknown }).commit);
          };
          navigator.serviceWorker.controller?.postMessage({ ask: 'build' }, [channel.port2]);
        })
    );
    expect(said).toBe(BUILT);

    // And the stamp is read from the network, not the worker's cache: what the host serves now.
    const stamped = await page.evaluate(async () => {
      const r = await fetch('/version.json', { cache: 'no-store' });
      return ((await r.json()) as { commit: string }).commit;
    });
    expect(stamped).toBe(BUILT);
    // The worker keeps a public document after answering with it, so give it the moment it takes.
    await page.waitForTimeout(500);
    const cached = await page.evaluate(async () => {
      for (const name of await caches.keys()) {
        if (await (await caches.open(name)).match('/version.json')) return name;
      }
      return null;
    });
    expect(cached, 'the deploy stamp was kept in a cache').toBeNull();
  });
});

test.describe('a board with no service worker -- a private window', () => {
  // Nothing serves a reload from a cache, so it loads whatever is deployed, and only while online.
  test.use({ serviceWorkers: 'block' });
  test.setTimeout(60_000);

  test('says a newer deploy off watch, stops saying it offline, and the hold reloads', async ({ page, context }) => {
    await standIns(page);
    await deployed(page, ANOTHER);
    await seedDevice(page, { callsign: 'Wren', watchSecret: WATCH_SECRET, relayEvents: [] });
    await open(page, '/terminal/watch/');
    expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
    await expect(page.locator('[data-watch-post]')).toContainText(/off watch/i, { timeout: 10_000 });

    const ready = page.locator('[data-watch-post] [data-update-ready]');
    await expect(ready).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-reload-cost]')).toBeVisible();

    // Offline, a reload would load nothing at all.
    await context.setOffline(true);
    await expect(page.locator('[data-update-ready]')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.locator('[data-reload]')).toHaveCount(0);
    await context.setOffline(false);
    await expect(ready).toBeVisible({ timeout: 5_000 });

    await page.evaluate(() => ((globalThis as unknown as Record<string, unknown>).__samePage = true));
    const loaded = page.waitForEvent('load');
    await holdUntil(page, 'button:has-text("Hold to reload")');
    await loaded;
    await page.waitForSelector('html[data-hydrated="true"]', { timeout: 15_000 });
    expect(await page.evaluate(() => (globalThis as unknown as Record<string, unknown>).__samePage)).toBeUndefined();
    expect(await updates(page)).toBe(0);
  });

  test('says nothing where the deploy stamp cannot be read', async ({ page }) => {
    await standIns(page);
    await page.context().route('**/version.json', (route) => route.abort('connectionrefused'));
    await seedDevice(page, { callsign: 'Wren', watchSecret: WATCH_SECRET, relayEvents: [] });
    await open(page, '/terminal/watch/');
    await expect(page.locator('[data-watch-post]')).toContainText(/off watch/i, { timeout: 10_000 });
    await page.waitForTimeout(1_500);
    await expect(page.locator('[data-update-ready]')).toHaveCount(0);
  });
});
