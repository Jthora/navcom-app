/**
 * The status page says how old the directory is, asserted against the directory.
 *
 * For twenty days every record on the site read *"call first"* for opening hours and intake —
 * correctly, because the newest check anywhere was thirty-three days old against a fourteen-day
 * window — and the one page whose job is saying what is true about this deployment did not mention
 * it. `check:data` had been printing it into a build log the whole time.
 *
 * So the page is derived from the same function the data check uses, and this is the test that keeps
 * the two from disagreeing. Against the built HTML rather than the component, for the reason this
 * project keeps relearning: a rule the logic honours and the output does not.
 *
 * Requires `npm run build` first; `npm run verify` sequences that.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { freshness } from '@navcom/core/directory';
import { loadDirectory } from './load';

const PAGE = fileURLToPath(new URL('../../../build/status/index.html', import.meta.url));

/** The page as a reader sees it: tags and Svelte's own markers out, whitespace collapsed. */
function text(): string | null {
  if (!existsSync(PAGE)) return null;
  return readFileSync(PAGE, 'utf8')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const measured = () =>
  freshness(
    loadDirectory()
      .map((r) => r.last_verified ?? '')
      .filter(Boolean),
    new Date().toISOString().slice(0, 10)
  );

describe('the status page and the directory agree about its age', () => {
  it('names the directory as something the page reports on at all', () => {
    const page = text();
    if (page === null) return; // build-dependent
    expect(page).toMatch(/Hours and intake/);
  });

  it('prints the age the data itself carries, rather than a number somebody typed', () => {
    const page = text();
    if (page === null) return;
    const f = measured();
    expect(f.newestAgeDays, 'no record carries a check date').not.toBeNull();
    expect(page).toContain(`${f.newestAgeDays} days old`);
  });

  it('prints the window from the schema rather than a literal', () => {
    const page = text();
    if (page === null) return;
    const volatile = measured().tiers.find((t) => t.cls === 'volatile')!;
    expect(page).toContain(`after ${volatile.windowDays} days`);
  });

  it('says hours are unknown exactly while they are, and never the other way round', () => {
    /*
     * The failure this exists for runs in both directions. A page claiming hours are shown while
     * every record says "call first" sends a reader to look for something that is not there; a page
     * claiming they are dark once somebody has re-checked understates work a volunteer did.
     */
    const page = text();
    if (page === null) return;
    const dark = measured().volatileDark;
    expect(page.includes('Unknown across the whole directory right now')).toBe(dark);
    expect(page.includes('Shown, where somebody has checked recently enough')).toBe(!dark);
  });

  it('keeps saying that addresses are unaffected, because that is what is still usable', () => {
    const page = text();
    if (page === null) return;
    if (!measured().volatileDark) return;
    expect(page).toMatch(/Addresses, phone numbers and what a place is remain shown/);
  });
});
