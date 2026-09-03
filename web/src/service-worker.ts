/// <reference types="@sveltejs/kit" />
/**
 * Offline shell for the Field Terminal.
 *
 * Registered only when a terminal page is visited — the public site runs no script, so it
 * never reaches this code. That is deliberate: a document does not need a worker, and a
 * reader who has scripting off should not be handed one.
 *
 * The terminal is a different matter. **Offline is a normal state, not an error** [C10], and
 * the Outpost's whole situation is a parking lot with no service. So the shell is cached on
 * install and served from cache first, because a terminal that needs the network to render
 * "Dark" has failed at the exact moment it mattered.
 */

import { base, build, files, version } from '$service-worker';
import { TERMINAL_ROUTES } from '$lib/terminal/routes';

const CACHE = `navcom-terminal-${version}`;

/**
 * The shell, plus the terminal's own pages.
 *
 * The directory is prerendered INTO the terminal's directory page rather than fetched as
 * data, so caching the page caches the records — one artifact, no second request that could
 * fail exactly when it matters. Cached on install, not on first use: the moment an operator
 * needs the directory is the moment they have no signal, and "we'll fetch it when you open
 * the screen" is a fallback that only works when you did not need a fallback.
 */
const SHELL = [
  ...build,
  ...files.filter((f) => !f.endsWith('.csv')),
  ...TERMINAL_ROUTES.map(
    (page) => `${base}/terminal/${page}`
  )
];

/**
 * Individual area pages are NOT precached.
 *
 * There are dozens and an operator works in one. Precaching them all would fill a cheap
 * phone with cities somebody will never visit, so opening an area is what saves it — which
 * is why that page says so in those words rather than offering a download button.
 */
const isAreaPage = (pathname: string) => /\/terminal\/directory\/[^/]+\/?$/.test(pathname);

const sw = self as unknown as ServiceWorkerGlobalScope;

/** No network and nothing cached. Fail visibly — degrade visibly, never fail silently. */
function offline(): Response {
  return new Response('Offline, and this was not cached.', {
    status: 503,
    headers: { 'content-type': 'text/plain' }
  });
}

/**
 * What this install could not save.
 *
 * Read by the terminal so it can say what it actually has, rather than assuming. Empty is
 * the ordinary case and the only one anybody should have to think about.
 */
let missing: string[] = [];

/**
 * Caches the shell, one request at a time.
 *
 * **`addAll` was the wrong primitive here and it took an audit to see it.** It rejects if
 * *any* request fails, which fails the whole install — so `skipWaiting` never runs, the
 * worker never takes over, and the terminal has **no offline capability at all**. On a
 * screen that is online at the time, nothing looks wrong. The operator finds out in a car
 * park with no signal, which is the one moment this exists for.
 *
 * One flaky asset, one 404 after a partial deploy, one connection dropping mid-install: any
 * of them turned "offline-first" into "online-only, quietly".
 *
 * So each entry is cached on its own and a failure is recorded rather than fatal. A shell
 * that is 95% cached is worth far more than no shell, and the 5% is worth saying out loud.
 */
async function cacheShell(): Promise<void> {
  const cache = await caches.open(CACHE);
  const failed: string[] = [];

  await Promise.all(
    SHELL.map(async (url) => {
      try {
        await cache.add(new Request(url, { credentials: 'same-origin' }));
      } catch {
        failed.push(url);
      }
    })
  );

  missing = failed;
  if (failed.length > 0) {
    // Loud in the console, because a partly-cached shell is a real state somebody debugging
    // an offline failure needs to know about.
    console.warn(`[navcom] ${failed.length} of ${SHELL.length} shell entries did not cache`, failed);
  }
}

sw.addEventListener('install', (event) => {
  // `skipWaiting` regardless: a worker that serves most of the shell beats no worker.
  event.waitUntil(cacheShell().then(() => sw.skipWaiting()));
});

/**
 * Moves the areas an operator chose to carry into the new version's cache.
 *
 * **A deploy used to silently throw them away.** The cache name carries the build version,
 * so activating a new one deleted the old cache whole — and the directory areas live there
 * too, added on visit rather than shipped in the shell. An operator who was carrying
 * St. Louis, opened the app once on wifi, and then went out with no signal found nothing.
 * Nothing told them, because from the app's point of view nothing had gone wrong.
 *
 * "Opening it is what saves it" was quietly revoked by an unrelated event.
 *
 * The pages carried over are the previous build's HTML, which is the right trade: a
 * prerendered record page is readable without its scripts, and a readable record with a
 * build-time age beats an empty screen. The next visit on a connection replaces it.
 */
async function carryAreasForward(): Promise<void> {
  const names = (await caches.keys()).filter((k) => k !== CACHE);
  if (names.length === 0) return;

  const current = await caches.open(CACHE);
  for (const name of names) {
    try {
      const old = await caches.open(name);
      for (const request of await old.keys()) {
        if (!isAreaPage(new URL(request.url).pathname)) continue;
        // Never overwrite what this version already has.
        if (await current.match(request)) continue;
        const hit = await old.match(request);
        if (hit) await current.put(request, hit);
      }
    } catch {
      // One unreadable old cache must not stop the rest being carried, or the new version
      // activating at all.
    }
  }
}

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    carryAreasForward()
      .then(() => caches.keys())
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim())
  );
});

/**
 * A page asking to be saved.
 *
 * Area pages are cached on request rather than precached — there are dozens and an operator
 * works in one. The obvious mechanism, caching whatever gets fetched, **does not work here**:
 * SvelteKit navigates on the client, so clicking through to an area fetches its data and
 * never its HTML document. The document was therefore never cached, and "opening an area is
 * what saves it" was false for the only path anybody actually takes.
 *
 * So the page asks, explicitly, once it has rendered.
 */
sw.addEventListener('message', (event) => {
  const data = event.data as { cache?: string; ask?: string } | null;

  // "What did you fail to save?" -- so a screen can tell the truth about what works offline
  // rather than assuming the install went perfectly.
  if (data?.ask === 'missing') {
    event.source?.postMessage({ missing });
    return;
  }

  const path = data?.cache;
  if (typeof path !== 'string' || !path.startsWith('/terminal/')) return;

  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.add(new Request(path, { credentials: 'same-origin' })))
      // A failure here is an area not saved, which the page reports on its own terms. It
      // must not take down the worker that is also serving Distress.
      .catch(() => undefined)
  );
});

/**
 * A page, and the only notification this app is allowed to show.
 *
 * **The field terminal is silent.** No badges, no activity, no nudges, no "somebody signed
 * on". The single exception is a `Distress` reaching somebody who registered themselves as
 * on-call, which is the one message in this system where failing to interrupt a person is
 * the failure.
 *
 * ## Why web push rather than a third-party topic
 *
 * A page over an ntfy topic passes its text through somebody else's server in the clear. A
 * Web Push payload is encrypted to keys that only this browser holds, so the push service —
 * Google's, Mozilla's or Apple's, and there is no avoiding one — relays a blob it cannot
 * read. That is a real improvement on the one channel that carries an emergency.
 *
 * It is also the one native-grade capability a web app already has on both platforms: Chrome
 * on Android, and iOS 16.4+ once the app is on the home screen. No app store in either case.
 *
 * ## What it deliberately does not do
 *
 * No payload from the wire is rendered. The sender is a machine that cannot read the
 * `Distress` either, so there is nothing to render — and a notification that quoted
 * attacker-controlled text on a locked screen would be a way to put words in front of
 * somebody at their least critical moment. The text is fixed and lives here.
 */
sw.addEventListener('push', (event) => {
  // A push with no data, or data this version does not understand, still wakes somebody.
  // Failing closed here would mean a silent page, which is the failure this exists to
  // prevent -- so anything unparseable is treated as a real Distress.
  let drill = false;
  /*
   * The `20911` this page is about, when the sender could carry one.
   *
   * **Not rendered, and it is not text.** Everything above still holds: no payload from the
   * wire reaches the screen. This is an opaque id, read only to build the URL the tap opens,
   * so a `distress-ack` can name the event it acknowledges.
   *
   * It has to arrive this way. `20911` is ephemeral, so a relay forwards it to whoever is
   * subscribed at that instant and stores nothing -- a phone that was asleep and woke on this
   * notification finds the event gone and has nothing to acknowledge [2.5].
   *
   * Validated as hex before it is used: it is going into a URL, and a payload is still a
   * payload even when the channel that carried it is encrypted.
   */
  let distress: string | null = null;
  try {
    const data = event.data?.json() as { drill?: boolean; distress?: string } | null;
    drill = data?.drill === true;
    if (typeof data?.distress === 'string' && /^[0-9a-f]{64}$/.test(data.distress)) {
      distress = data.distress;
    }
  } catch {
    drill = false;
  }

  event.waitUntil(
    sw.registration.showNotification(
      drill ? 'NavCom drill — not an emergency' : 'NavCom — Distress',
      {
        /*
         * Named paths, because the previous text named one that does not exist.
         *
         * It said *"Open the terminal and acknowledge"* and **there is no acknowledge control
         * in the terminal.** A squad member holding the watch answers from the board — the
         * button is literally *"Tell them you are awake"* — and a node's on-call operator
         * acknowledges in the console, which is what the SMS page already tells them. Somebody
         * woken at 3am has seconds, and the one thing the text must not do is send them
         * looking for a button that is not there.
         */
        body: drill
          ? distress
            ? 'A drill, not an emergency. Tap to acknowledge it, so the roster can be proven.'
            : 'A drill, not an emergency. Acknowledge it in the console so the roster can be proven.'
          : distress
            ? 'An operator is waiting for a human. Tap to say you have it.'
            : 'An operator is waiting for a human. Open the board and tell them you are awake.',
        // Distinguishable by the recipient, in the text they actually read [C29]. Somebody
        // woken at 3am has seconds and no context.
        tag: drill ? 'navcom-drill' : 'navcom-distress',
        requireInteraction: !drill,
        data: { url: distress ? `${base}/terminal/?ack=${distress}` : `${base}/terminal/` }
      }
    )
  );
});

/**
 * Tapping it opens the terminal, focusing a tab that is already there rather than adding one.
 *
 * **And navigates that tab, which it did not before.** Focusing alone discarded the URL, so an
 * operator who already had the terminal open -- the likeliest person to be on-call -- would tap
 * a page about a Distress and land on whatever screen they had left open, with the `ack` id
 * dropped on the floor. The feature would have worked only for somebody with no tab open,
 * which is the opposite of who it is for.
 */
sw.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | null)?.url ?? `${base}/terminal/`;
  event.waitUntil(
    sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if (!client.url.includes('/terminal') || !('focus' in client)) continue;
        // Best-effort: a client that refuses to navigate is still focused, which is what the
        // old behaviour was. Never fail the tap.
        if ('navigate' in client && !client.url.endsWith(url)) {
          try {
            await client.navigate(url);
          } catch {
            /* not controlled, or cross-origin: focus is still better than nothing */
          }
        }
        return client.focus();
      }
      return sw.clients.openWindow(url);
    })
  );
});

sw.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  // Only the terminal is offline-capable. The public site is served normally.
  if (!url.pathname.startsWith('/terminal') && !url.pathname.startsWith('/_app')) return;

  // The directory page is the one worth refreshing when there IS a network: a cached copy
  // that silently never updates is how a phone ends up confidently reciting a shelter that
  // closed in March. Cache remains the fallback, so being offline changes nothing.
  if (url.pathname.endsWith('/terminal/directory/') || isAreaPage(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit ?? offline()))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).catch(() => {
          return offline();
        })
    )
  );
});
