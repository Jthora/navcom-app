/**
 * The saved copy of a terminal screen, for an address that carries a query.
 *
 * The service worker's half of opening a screen with no signal, kept here so it can be tested
 * without a browser. Every terminal screen is precached under its bare address, and reads its query
 * on the phone. A lookup that matches the query too found nothing for the addresses a page opens —
 * `/terminal/wake/?attempt=…` from a repeat page, `/terminal/?ack=…` from a first one — so a person
 * tapping a page with no signal got "Offline, and this page was not saved on this phone" in place of
 * a screen that was saved [review: live hole, phone].
 *
 * So a navigation whose exact address is not saved is looked up once more without its query. Only a
 * navigation: a fetch for data with a query means that query.
 *
 * No imports, so the worker stays as small as it is.
 */

/** The part of a request this reads. */
export interface PageRequest {
  url: string;
  mode: string;
}

/** `caches.match`, or anything shaped like it. */
export type Match<R extends PageRequest> = (
  request: R,
  options?: { ignoreSearch?: boolean }
) => Promise<Response | undefined>;

/** The saved response for this request, by its exact address, else by its path for a page; or none. */
export async function savedPage<R extends PageRequest>(match: Match<R>, request: R): Promise<Response | undefined> {
  const hit = await match(request);
  if (hit || request.mode !== 'navigate') return hit;
  let search = '';
  try {
    search = new URL(request.url).search;
  } catch {
    return undefined;
  }
  return search ? match(request, { ignoreSearch: true }) : undefined;
}
