/// <reference types="@sveltejs/kit" />
/**
 * Offline shell for the Field Terminal, and the whole origin's repeat-visit cache.
 *
 * Two jobs, and they are worth separating because they have different failure modes.
 *
 * ## The terminal, which must work with no network at all
 *
 * **Offline is a normal state, not an error** [C10], and the Outpost's whole situation is a
 * parking lot with no service. So the shell is cached on install and served from cache first,
 * because a terminal that needs the network to render "Dark" has failed at the exact moment
 * it mattered.
 *
 * ## The public site, which must not re-download itself every visit
 *
 * Since 2026-10-05 this worker also serves `(site)` — the directory, docs, status and about —
 * from a second, version-keyed cache. A returning reader fetches **nothing** until a deploy
 * changes the build version, at which point the old cache is dropped whole and the next visit
 * refills it. That is the whole mechanism: no revalidation, no age heuristics, no manifest to
 * keep in step. Deploy happens on every push, so the invalidation is frequent and automatic.
 *
 * ### How a zero-JavaScript page gets a worker
 *
 * It does not register one, and that is not a loophole. `(site)` is `csr = false` and ships no
 * script, as [`delivery.md`](../../docs/delivery.md) requires. The root console is `csr = true`,
 * hydrates, and registers this worker at scope `/` — so a reader who passed through the landing
 * page is thereafter served by a worker the documents themselves never mention. The promise is
 * about what a page ships, and a cached document ships less than an uncached one.
 *
 * ### What this does not fix
 *
 * **Crawlers.** A bot does not run JavaScript, so it never registers this and never benefits
 * from it. The August CDN spike was crawler traffic and the answer to it was the firewall rule
 * and `robots.txt`, not this. This is for the human who opens the site twice.
 */

import { base, build, files, version } from '$service-worker';
import { TERMINAL_ROUTES } from '$lib/terminal/routes';
import { noticeFor, showPage } from '$lib/terminal/page-notice';
import { savedPage } from '$lib/terminal/offline-page';
import { BUILT_COMMIT } from '$lib/built';

const CACHE = `navcom-terminal-${version}`;

/**
 * The public site's cache, separate from the terminal's on purpose.
 *
 * Two reasons, both about eviction. The terminal's cache holds the areas an operator
 * *deliberately chose to carry*, and nothing may throw those away to make room for a docs page
 * somebody read once — `carryAreasForward` exists because a deploy did exactly that. And the
 * public set is unbounded where the terminal's is not: there are 1,912 region pages, and a
 * reader clicking through them must not fill a cheap phone.
 *
 * So they are different caches with different rules: the terminal's is precious and precached,
 * this one is disposable and capped.
 */
const SITE = `navcom-site-${version}`;

/**
 * How many public documents to keep.
 *
 * Generous enough for a session of real browsing, small enough to be invisible on the device
 * floor — a prepaid Android 8 with 400 MB free. Entries are evicted oldest-first, which
 * `cache.keys()` gives us in insertion order by specification.
 */
const SITE_LIMIT = 60;

/**
 * Never cached, at any size, in either cache.
 *
 * `directory.json` is 16 MB and would consume a twenty-fifth of the device floor's free space
 * in one request nobody asked for. The CSV and CAR artifacts are bulk exports for other
 * machines. `.well-known` is read by external consumers — other people's agents — and serving
 * one of them a stale refusals file from our cache would be a small lie told on our behalf.
 *
 * `version.json` is the deploy stamp, and its whole job is being current. It was kept cache-first
 * in the site cache like any public document, so within one build of this worker a page asking what
 * is deployed was told what was deployed when it first asked — and the Watch screen, which asks so
 * it can say a newer build is waiting, would never have heard of one.
 */
const isNeverCached = (pathname: string) =>
  pathname === `${base}/version.json` ||
  pathname === `${base}/directory.json` ||
  pathname.endsWith('.csv') ||
  pathname.endsWith('.car') ||
  pathname.endsWith('/sitemap.xml') ||
  pathname.startsWith(`${base}/.well-known/`);

/** The terminal and the app's own immutable assets: precached, cache-first, precious. */
const isTerminalScope = (pathname: string) =>
  pathname.startsWith(`${base}/terminal`) || pathname.startsWith(`${base}/_app`);

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
  /*
   * The landing page, where a signed-on operator in a browser works missions with Distress on
   * the screen [com.md §4]. It lived only in the site cache, which evicts its oldest entry first
   * and never re-inserts a hit, so after an evening of reading places, or after any deploy, `/`
   * was gone offline -- and Distress with it [audit 11.S].
   */
  `${base}/`,
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

/**
 * An area's records, which since 2026-09-19 are the data file rather than the page.
 *
 * The region screen renders its records on the client from the data SvelteKit writes beside
 * the page, so caching the document alone now saves a shell with nothing in it. Offline is the
 * pair or it is nothing.
 */
const isAreaData = (pathname: string) =>
  /\/terminal\/directory\/[^/]+\/__data\.json$/.test(pathname);

/** Both halves of one area: the page, and the records it renders from. */
const areaParts = (path: string) => [path, path.replace(/\/?$/, '/') + '__data.json'];

const sw = self as unknown as ServiceWorkerGlobalScope;

/**
 * No network and nothing cached. Fail visibly — degrade visibly, never fail silently.
 *
 * A page gets a page, with the way to Distress on it: the Distress screen is precached and works
 * with no signal, and a plain-text dead end was what an operator found at 2am on any page this
 * phone had not saved [audit 11.S].
 */
function offline(request?: Request): Response {
  if (request?.mode === 'navigate') {
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>Offline · NavCom</title>' +
        '<p>Offline, and this page was not saved on this phone.</p>' +
        `<p><a href="${base}/terminal/distress/">Distress</a> works with no signal. ` +
        `<a href="${base}/terminal/">The Field Terminal</a> does too.</p>`,
      { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } }
    );
  }
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
        const carried = new URL(request.url).pathname;
        if (!isAreaPage(carried) && !isAreaData(carried)) continue;
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
      // Both current caches survive; every older one is dropped whole. Dropping the previous
      // SITE cache IS the public site's invalidation — a new deploy means a new version string
      // means the next visit refills from the network, with nothing to reason about.
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE && k !== SITE).map((k) => caches.delete(k)))
      )
      .then(() => sw.clients.claim())
  );
});

/**
 * Stores one public document and evicts down to the cap.
 *
 * Only `ok`, `basic` responses are kept: a 404 cached as a document would survive until the
 * next deploy, and an opaque cross-origin response tells us nothing about what it contains.
 * Eviction is oldest-first and happens after the insert, so the page being read now is never
 * the one thrown away.
 */
async function keepSitePage(request: Request, response: Response): Promise<void> {
  if (!response.ok || response.type !== 'basic') return;
  try {
    const cache = await caches.open(SITE);
    await cache.put(request, response);
    const keys = await cache.keys();
    const over = keys.length - SITE_LIMIT;
    for (let i = 0; i < over; i += 1) await cache.delete(keys[i]!);
  } catch {
    // A full disk, a quota refusal, a private window: none of these may break the page. The
    // reader gets the network copy they already have.
  }
}

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

  // "Which build would a reload load?" -- this one's, since the shell is served from its cache. On
  // the port the page sent, so the answer reaches only whoever asked (`terminal/update.svelte.ts`).
  if (data?.ask === 'build') {
    event.ports[0]?.postMessage({ commit: BUILT_COMMIT, version });
    return;
  }

  const path = data?.cache;
  if (typeof path !== 'string' || !path.startsWith('/terminal/')) return;

  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) =>
        Promise.all(
          areaParts(path).map((part) => c.add(new Request(part, { credentials: 'same-origin' })))
        )
      )
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
 * somebody at their least critical moment. The text is fixed, in `page-notice.ts`.
 */
sw.addEventListener('push', (event) => {
  /*
   * A push with no data, or data this version does not understand, still wakes somebody. Failing
   * closed here would mean a silent page, which is the failure this exists to prevent -- so
   * anything unparseable is a page about a new Distress (`noticeFor`).
   *
   * What it says is one of three kinds -- a first page, a repeat to the person who acknowledged,
   * or a drill -- read from an allow-list, and each looks different in the words read first
   * [`escalation.spec.md`, *A page says what kind it is*]. The ids it carries are not rendered and
   * are not text: each is checked as hex and used only to build the address a tap opens -- a
   * first page's `?ack=` so a `distress-ack` can name the event it acknowledges, because `20911`
   * is ephemeral and a phone that slept through it finds it gone [2.5]; a repeat's attempt, for
   * the screen that wakes the others, and never `?ack=`. The rules, and why a page that must alert
   * again closes the card it replaces first, are in `page-notice.ts`.
   */
  let data: unknown = null;
  try {
    data = event.data?.json() ?? null;
  } catch {
    data = null;
  }
  event.waitUntil(showPage(sw.registration, noticeFor(data, base, Math.floor(Date.now() / 1000))));
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
  if (isNeverCached(url.pathname)) return;

  /*
   * A public document: served from cache if this build already fetched it, otherwise fetched
   * and kept.
   *
   * Cache-first with **no revalidation**, which is the part that does the work: a reader who
   * opens the site twice in a day makes zero requests the second time. It is only safe because
   * the cache name carries the build version, so the staleness window is "until the next
   * deploy" rather than "forever", and deploys happen on every push.
   *
   * Directory records are the one thing that could go stale dangerously, and they do not go
   * stale here: a prerendered record carries the `verified` date it was built with, so the
   * cached page shows exactly the age the live page would show. Rule 1 of the display rules
   * holds either way — a volatile field never appears without its age [directory-schema.md].
   */
  if (!isTerminalScope(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request)
            .then((response) => {
              void keepSitePage(request, response.clone());
              return response;
            })
            .catch(() => offline(request))
      )
    );
    return;
  }

  // The directory page is the one worth refreshing when there IS a network: a cached copy
  // that silently never updates is how a phone ends up confidently reciting a shelter that
  // closed in March. Cache remains the fallback, so being offline changes nothing.
  if (
    url.pathname.endsWith('/terminal/directory/') ||
    isAreaPage(url.pathname) ||
    isAreaData(url.pathname)
  ) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit ?? offline(request)))
    );
    return;
  }

  // A screen opened from a page carries a query (`?attempt=`, `?ack=`) and is saved without one:
  // found by its path, so a tap with no signal opens it (`offline-page.ts`).
  event.respondWith(
    savedPage((r, o) => caches.match(r, o), request).then(
      (hit) =>
        hit ??
        fetch(request).catch(() => {
          return offline(request);
        })
    )
  );
});
