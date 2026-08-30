/**
 * The community links, asserted against the data AND against the built HTML.
 *
 * This page's whole subject is that links rot and domains get taken over. A version of it
 * that rots is worse than none, and the first draft was exactly that: prose with hand-typed
 * dates, which shipped a live entry with no link (its obvious domain resolves nowhere), two
 * archive links on plaintext `http://`, and a liveness note that read as doubt when the
 * evidence was strong. None of those are findable by re-reading the sentence.
 *
 * So the rules are here rather than in a maintainer's memory, and the last few run against
 * `build/` rather than against `community.ts` — the failure this project keeps having is a
 * rule the logic honours and the output does not. See `docs/verification.md`.
 *
 * Requires `npm run build` first; `npm run verify` sequences that.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'node-html-parser';
import { beforeAll, describe, expect, it } from 'vitest';

import { GONE, LIVE, NEVER_LINK, STALE_AFTER_DAYS, daysSince } from './community';

const BUILD = fileURLToPath(new URL('../../build/', import.meta.url));

function htmlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? htmlFiles(p) : p.endsWith('.html') ? [p] : [];
  });
}

/** Every `href` on every built page, with the page it came from. */
let hrefs: { path: string; href: string }[] = [];

beforeAll(() => {
  const files = htmlFiles(BUILD);
  if (files.length === 0) {
    throw new Error('No build output. Run `npm run build` before these tests.');
  }
  hrefs = files.flatMap((path) =>
    parse(readFileSync(path, 'utf8'))
      .querySelectorAll('a[href]')
      .map((a) => ({ path, href: a.getAttribute('href') as string }))
  );
});

describe('the community list as data', () => {
  it('has entries in both halves', () => {
    // A guard that examines nothing passes. Same reason rendered.test.ts counts what it saw.
    expect(LIVE.length).toBeGreaterThan(0);
    expect(GONE.length).toBeGreaterThan(0);
  });

  it('links only over https', () => {
    // Both archive URLs shipped as plaintext `http://` in the first version, copied verbatim
    // out of an API response. On a page about not sending people somewhere unsafe.
    for (const s of LIVE) expect(s.url, s.name).toMatch(/^https:\/\//);
    for (const s of GONE) expect(s.archive, s.name).toMatch(/^https:\/\//);
  });

  it('never points a live entry at a domain on the blocklist', () => {
    for (const s of LIVE) {
      const host = new URL(s.url).hostname;
      for (const bad of NEVER_LINK) {
        expect(host === bad || host.endsWith(`.${bad}`), `${s.name} -> ${host}`).toBe(false);
      }
    }
  });

  it('names every dead domain on the blocklist, so nothing can quietly link one later', () => {
    // The `was` field is rendered as text. If a future edit turns one into a link, the
    // built-HTML rule below catches it — but only if the domain is actually listed here.
    for (const s of GONE) {
      expect(NEVER_LINK as readonly string[], `${s.name}: ${s.was}`).toContain(s.was);
    }
  });

  it('carries a real check date that is not in the future', () => {
    for (const s of [...LIVE, ...GONE]) {
      expect(s.checked, s.name).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(`${s.checked}T00:00:00Z`)), s.name).toBe(false);
      expect(daysSince(s.checked), `${s.name} is checked in the future`).toBeGreaterThanOrEqual(0);
    }
  });

  it('has not been left to go stale in silence', () => {
    // The one rule that fails on its own, with no code change, when nobody has looked in six
    // months. That is the intent: a squatted domain sitting here unnoticed for years is the
    // exact failure this page exists to prevent, and a comment asking someone to re-check
    // does not prevent it. Re-check the links, update `checked`, and this goes green.
    for (const s of [...LIVE, ...GONE]) {
      expect(
        daysSince(s.checked),
        `${s.name} was last checked ${daysSince(s.checked)} days ago — re-verify it and update \`checked\` in community.ts`
      ).toBeLessThanOrEqual(STALE_AFTER_DAYS);
    }
  });
});

describe('what actually ships', () => {
  it('links no domain on the blocklist, anywhere on the site', () => {
    for (const { path, href } of hrefs) {
      let host: string;
      try {
        host = new URL(href, 'https://navcom.app').hostname;
      } catch {
        continue;
      }
      for (const bad of NEVER_LINK) {
        expect(host === bad || host.endsWith(`.${bad}`), `${path} links ${href}`).toBe(false);
      }
    }
  });

  it('renders every live site as a real link a reader can follow', () => {
    // The mechanism-nobody-can-reach rule, applied to a link list: an entry that is in the
    // data and not in the page is not published. Superheroes Anonymous was in the first
    // version's table with no link at all, and nothing noticed.
    const shipped = new Set(hrefs.map((h) => h.href));
    for (const s of LIVE) {
      expect(shipped.has(s.url), `${s.name} (${s.url}) is in LIVE but linked from no page`).toBe(true);
    }
  });

  it('renders every archive link, so a gone site still has a destination', () => {
    const shipped = new Set(hrefs.map((h) => h.href));
    for (const s of GONE) {
      expect(shipped.has(s.archive), `${s.name}'s archive link is not on any page`).toBe(true);
    }
  });
});
