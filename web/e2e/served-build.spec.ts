import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { rootFor, VERCEL_JSON } from '../scripts/serve-build.mjs';
import { blankDevice, open } from './device';

/**
 * That this suite is served `build/`, as the host serves it.
 *
 * Every other spec here assumes it. Under `vite preview` the suite was served
 * `.svelte-kit/output` with an SSR fallback behind it, so the post-build steps never reached a
 * browser and a path the host 404s could still render. Nothing failed, because nothing checked.
 * See `scripts/serve-build.mjs`.
 */

const ROOT = rootFor();
const HOST: {
  headers?: { source: string; headers: { key: string; value: string }[] }[];
  redirects?: { source: string; destination: string; permanent?: boolean; statusCode?: number }[];
} = JSON.parse(readFileSync(VERCEL_JSON, 'utf8'));

/** A source with no pattern in it names one path, which can be asked for directly. */
const literal = (source: string) => !/[(:*]/.test(source);

test.describe('the suite is served build/, as the host serves it', () => {
  test('a file that exists only in build/ is served, read when it is asked for', async ({ request }) => {
    // Written now, so it is in no earlier output and in no file list taken when the server started.
    const name = `.e2e-served-${randomUUID()}.json`;
    const file = join(ROOT, name);
    const body = JSON.stringify({ written: name });
    writeFileSync(file, body);
    try {
      const res = await request.get(`/${name}`);
      expect(res.status()).toBe(200);
      expect(await res.text()).toBe(body);
    } finally {
      rmSync(file, { force: true });
    }
    expect((await request.get(`/${name}`)).status()).toBe(404);
  });

  test("vercel.json's redirects and headers are what the suite meets", async ({ request }) => {
    const redirects = (HOST.redirects ?? []).filter((r) => literal(r.source));
    const headers = (HOST.headers ?? []).filter((r) => literal(r.source));
    // Read from the file, so a rule added there is checked here without anybody copying it.
    expect(redirects.length + headers.length).toBeGreaterThan(0);

    for (const r of redirects) {
      const res = await request.get(r.source, { maxRedirects: 0 });
      expect(res.status(), r.source).toBe(r.statusCode ?? (r.permanent === false ? 307 : 308));
      expect(res.headers()['location'], r.source).toBe(r.destination);
    }
    for (const rule of headers) {
      const res = await request.get(rule.source, { maxRedirects: 0 });
      expect(res.status(), rule.source).toBe(200);
      for (const { key, value } of rule.headers) expect(res.headers()[key.toLowerCase()], `${rule.source} ${key}`).toBe(value);
    }
  });

  test("a path the build does not have is the build's own 404 page, with a 404", async ({ request }) => {
    const res = await request.get('/terminal/no-such-screen/');
    expect(res.status()).toBe(404);
    expect(await res.text()).toBe(readFileSync(join(ROOT, '404.html'), 'utf8'));
  });

  test("the root console reads this build's receipt, as it does in production", async ({ page, request }) => {
    /*
     * `scripts/well-known.mjs` writes `/.well-known/` into build/, and verify ran it only after this
     * suite. So the console's fetch of the health file 404'd in every verify run, and the state
     * production is always in, a receipt present, never reached a browser. `pretest:browser` now
     * writes the whole set first, with the receipt fields still unknown; verify writes the health
     * file again once the receipt and the budget exist.
     */
    const res = await request.get('/.well-known/navcom-health.json');
    expect(res.status(), 'build/ has no .well-known/. `npm run test:browser` writes it first; run `npm run wellknown` before a bare `playwright test`').toBe(200);
    const health = (await res.json()) as { commit: string | null };
    await blankDevice(page);
    await open(page, '/');
    await expect(page.locator('[data-slot="build"]')).toContainText(health.commit ? health.commit.slice(0, 7) : 'unknown');
    await expect(page.locator('[data-slot="build"]')).not.toContainText(/unreachable/i);
  });
});
