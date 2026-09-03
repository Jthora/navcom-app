import { error } from '@sveltejs/kit';
import { loadDirectory, loadRegions } from '$lib/directory/load';
import type { ConsoleRecordEntry } from '$lib/console/types';

export const prerender = true;

/**
 * One region's records, small enough to fetch while somebody is typing.
 *
 * ## Why this exists
 *
 * The console used to inline **every** record into `index.html` so its search worked with no
 * fetch at all. That was right at 507 records and impossible at national scale: measured at
 * 1,405 records the index was 27.9 kB gzipped and the page 94 kB of a 120 kB budget, and
 * trimming was tried three ways — dropping the repeated region names, stripping the region
 * prefix from ids, a one-character source flag — each buying about 7%. Gzip had already
 * collapsed the repetition; what was left was the eight-character hash in each id, which is
 * irreducible. Even removing ids outright only reached ~4,600 records. See `delivery.md`.
 *
 * So the index stops being *the directory* and becomes *one region's*. The console always
 * carries every **region** — 68 today, a few hundred eventually, and a few kilobytes either
 * way — and loads exactly one region's records beside them. **The page no longer grows as the
 * directory does.**
 *
 * ## Why one region is the right one
 *
 * The console's own header says what its search is for: *"this is for someone deciding whether
 * this is worth their trust at all"* — not an operator mid-shift, who has the field terminal
 * and its offline copy. Somebody testing a directory types a place in **their own city**. That
 * is the region `locateOnce()` already resolves, from a one-shot fix rounded to ~500m before
 * it is held in memory and never sent anywhere.
 *
 * Prerendered like everything else here, so this is a static file on a CDN rather than a
 * lookup — no server, and cacheable by the service worker once fetched.
 */
export function GET({ params }: { params: { region: string } }) {
  const region = loadRegions().find((r) => r.slug === params.region);
  if (!region) error(404, 'No such region');

  const entries: ConsoleRecordEntry[] = loadDirectory()
    .filter((r) => r.region === params.region)
    .map((r) => ({ id: r.id, name: r.name, type: r.type }));

  return new Response(JSON.stringify(entries), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600'
    }
  });
}

/** Every region, including the empty ones — an empty list is a real answer, not a 404. */
export function entries() {
  return loadRegions().map((r) => ({ region: r.slug }));
}
