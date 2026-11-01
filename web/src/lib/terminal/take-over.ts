/**
 * Moving this page to the deployed build: asking the browser for its service worker, and waiting for
 * that worker to take the page over before anything reloads. Reloaded before, the old worker would
 * serve the same old build again.
 *
 * Kept apart from `update.svelte.ts`, which watches for a newer build on the Watch screen and guards a
 * `Distress` being sent, so the landing page can load this alone: that guard pulls in the session code,
 * thirty chunks the landing page's first paint would otherwise have to name.
 */

/**
 * How long a page waits for the deployed build's worker to take over before saying it could not.
 * Generous: it fetches the whole shell, on the phones and the signal this is for.
 */
export const TAKE_OVER_MS = 90_000;

/**
 * Asks the browser for the deployed build's worker and waits for it to take over this page. True once a
 * different worker controls it; false where none arrives in {@link TAKE_OVER_MS}, the browser found
 * nothing new, or it could not ask.
 */
export function takeOver(sw: ServiceWorkerContainer, before: ServiceWorker): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sw.removeEventListener('controllerchange', onChange);
      resolve(ok);
    };
    const onChange = () => {
      const now = sw.controller;
      if (now && now !== before) finish(true);
    };
    const timer = setTimeout(() => finish(false), TAKE_OVER_MS);
    sw.addEventListener('controllerchange', onChange);
    void (async () => {
      try {
        const registration = await sw.getRegistration();
        if (!registration) return finish(false);
        await registration.update();
        // The same worker script: nothing is coming.
        if (!registration.installing && !registration.waiting && sw.controller === before) finish(false);
      } catch {
        finish(false);
      }
    })();
  });
}

/**
 * The landing page's way to the newest build, when its Build line says this page is older than what
 * is deployed. There is no board there to lose, so it is a tap, not a hold; and no `Distress` can be
 * sending from that page, whose Distress is a link that loads the terminal [routes/+page.svelte].
 *
 * Where no newer worker comes, the one in charge already has the newest build, and a reload loads it.
 * Where one starts and does not finish, nothing is reloaded and the answer is `failed`, for the page
 * to say so.
 */
export async function loadNewest(): Promise<'failed'> {
  const sw = typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : null;
  const before = sw?.controller ?? null;
  if (sw && before && !(await takeOver(sw, before))) {
    const registration = await sw.getRegistration().catch(() => undefined);
    if (registration?.installing || registration?.waiting) return 'failed';
  }
  location.reload();
  return new Promise(() => {});
}
