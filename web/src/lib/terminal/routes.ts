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
  'wipe/'
] as const;
