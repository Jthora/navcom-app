/**
 * One metro's directory, prerendered.
 *
 * **Split by region because the whole thing does not fit.** Prerendering every record into
 * one page put the terminal at 79% of its page budget with 33 metros seeded, and the budget
 * is a hard gate for a reason -- the device floor is a prepaid Android 8 with 400MB free.
 *
 * It is also the right shape regardless of size: an operator is in one place, and a St.
 * Louis patrol has no use for Sydney's shelters taking up their offline cache.
 *
 * ## Why this is `+page.server.ts` and not `+page.ts`
 *
 * The split above was real for the *prerendered HTML* and a lie about the *bundle*. A
 * universal loader runs in the browser too, so importing `loadDirectory` here put every
 * region's records into the client graph -- and the St. Louis page shipped Sydney's shelters
 * after all, 33 kB gzipped of them, on all 67 region pages.
 *
 * A server loader runs only at build time. Its return value is serialised beside the page, so
 * a client navigation fetches one region's data instead of executing a loader that can reach
 * all of them. Nothing about the page changes; the CSV glob simply stops being reachable from
 * the browser.
 */

import { error } from '@sveltejs/kit';
import { loadDirectory, loadRegions } from '$lib/directory/load';
import { BUILT_AT } from '$lib/built';

export const prerender = true;

/**
 * Every region, including the ones that ship empty.
 *
 * This used to be every region *with records*, on the reasoning that a region with none has
 * nothing to show offline. That was right until an operator could add a place: thirty-five of
 * sixty-eight regions hold zero rows, and filtering them out meant the page did not exist, so
 * the operator with the local knowledge got a 404 instead of somewhere to put it.
 *
 * An empty region's page is a few hundred bytes and it is the only place the cold start can
 * begin. The budget gate still applies per page, and an empty one is the cheapest here.
 */
export function entries() {
  return loadRegions().map((region) => ({ region: region.slug }));
}

export function load({ params }: { params: { region: string } }) {
  const region = loadRegions().find((r) => r.slug === params.region);
  if (!region) error(404, 'No such region');

  return {
    built: BUILT_AT,
    region,
    records: loadDirectory().filter((r) => r.region === params.region)
  };
}
