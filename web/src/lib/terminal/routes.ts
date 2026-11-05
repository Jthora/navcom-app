/**
 * Every terminal screen, in one place, so the offline cache cannot drift from the app.
 *
 * This list was inline in the service worker and two screens shipped without being added
 * to it — the patrol record, which says in as many words that it works with no signal, and
 * the peers screen, which exists for operators who may have neither a watch nor a signal.
 *
 * A hand-maintained list of routes drifts the way a hand-maintained list of anything does,
 * so `routes.test.ts` compares this against what actually got built.
 */
export const TERMINAL_ROUTES = [
  '',
  'setup/',
  'sign-on/',
  'query/',
  'assist/',
  'distress/',
  'directory/',
  'patrols/',
  'peers/',
  'card/',
  'find/',
  'who/',
  'watch/',
  'on-call/',
  'resupply/',
  'standing/',
  'backup/',
  'funding/',
  'log/',
  'wipe/',
  // The live map: its radar needs nothing from the network, so neither may the page it is on.
  'map/',
  // The playbook is for a night with no signal, in a stairwell or a subway, so it is carried.
  'playbook/',
  // Practice needs nothing from the network, so it works wherever somebody has a minute.
  'practice/',
  // Opened by a repeat page, which can arrive with no signal to fetch it. The page's address carries
  // a query, and the worker finds this saved copy by its path (`offline-page.ts`).
  'wake/'
] as const;
