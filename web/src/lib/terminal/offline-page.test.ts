/**
 * A screen a page opens, with no signal [review: live hole, phone].
 *
 * Every terminal screen is saved under its bare address and reads its query on the phone. A repeat
 * page opens `/terminal/wake/?attempt=…`, a first page `/terminal/?ack=…`, and a lookup that matched
 * the query too found nothing: tapped with no signal, the person got "Offline, and this page was not
 * saved on this phone" in place of a screen that was saved.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { savedPage, type PageRequest } from './offline-page';

/** A cache holding these bare addresses, matched the way `caches.match` does. */
function cache(saved: string[]) {
  const asked: { url: string; ignoreSearch: boolean }[] = [];
  const match = async (request: PageRequest, options?: { ignoreSearch?: boolean }) => {
    const ignoreSearch = options?.ignoreSearch === true;
    asked.push({ url: request.url, ignoreSearch });
    const want = new URL(request.url);
    const key = ignoreSearch ? `${want.origin}${want.pathname}` : want.href;
    return saved.includes(key) ? new Response(key) : undefined;
  };
  return { match, asked };
}

const WAKE = 'https://navcom.app/terminal/wake/';
const page = (url: string, mode = 'navigate'): PageRequest => ({ url, mode });

describe('the saved copy of a terminal screen', () => {
  it('is found for the address a repeat page opens, query and all', async () => {
    const { match } = cache([WAKE]);
    const hit = await savedPage(match, page(`${WAKE}?attempt=${'a'.repeat(64)}&paged=1800000000`));
    expect(await hit?.text(), 'a saved screen read as not saved, with no signal, at 3am').toBe(WAKE);
  });

  it('is found for the address a first page opens', async () => {
    const { match } = cache(['https://navcom.app/terminal/']);
    expect(await savedPage(match, page(`https://navcom.app/terminal/?ack=${'b'.repeat(64)}`))).toBeDefined();
  });

  it('is looked up by its exact address first, and by its path only when that is not saved', async () => {
    const { match, asked } = cache([WAKE]);
    await savedPage(match, page(WAKE));
    expect(asked).toEqual([{ url: WAKE, ignoreSearch: false }]);
  });

  it('is never found by path for a fetch that is not a page: a query on data means that query', async () => {
    const { match, asked } = cache(['https://navcom.app/terminal/directory/area.json']);
    expect(await savedPage(match, page('https://navcom.app/terminal/directory/area.json?v=2', 'cors'))).toBeUndefined();
    expect(asked.every((a) => !a.ignoreSearch)).toBe(true);
  });

  it('is none for a screen that was never saved', async () => {
    const { match } = cache([]);
    expect(await savedPage(match, page(`${WAKE}?attempt=x`))).toBeUndefined();
  });
});

describe('the worker that ships', () => {
  it('looks terminal screens up this way', () => {
    // A rule nobody can reach is not built: the worker is what a tapped page meets.
    const src = readFileSync(fileURLToPath(new URL('../../service-worker.ts', import.meta.url)), 'utf8');
    expect(src).toMatch(/from '\$lib\/terminal\/offline-page'/);
    expect(src).toMatch(/savedPage\(\(r, o\) => caches\.match\(r, o\), request\)/);
  });
});
