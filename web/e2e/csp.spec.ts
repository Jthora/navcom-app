import { expect, test, type Page } from '@playwright/test';

/**
 * The landing page's Content-Security-Policy, as the host serves it and the browser enforces it
 * (`vercel.json`, applied here by `scripts/serve-build.mjs`) [docs/product/what-leaves.md, What it asks
 * anyone else, only when you choose].
 *
 * `connect-src` only: the root may connect to itself, to relays by scheme, since operators choose
 * them, and to exactly the four hosts Hazards and the weather warnings ask. Anything else is refused by
 * the browser before it is a request. The policy is the root's alone: /terminal/who checks a proof
 * wherever a card says it is, so it carries none.
 *
 * No test touches the public internet: every socket and every allowed host is answered by route here.
 */

test.use({ serviceWorkers: 'block' });

const POLICY = "connect-src 'self' wss: ws: https://earthquake.usgs.gov https://eonet.gsfc.nasa.gov https://www.gdacs.org https://api.weather.gov";
const ALLOWED = ['earthquake.usgs.gov', 'eonet.gsfc.nasa.gov', 'www.gdacs.org', 'api.weather.gov'];

/** Every socket answered here, so nothing reaches a real relay; and every violation recorded. */
async function guarded(page: Page) {
  await page.routeWebSocket(/.*/, (ws) => ws.close());
  for (const host of ALLOWED) {
    await page.route(`https://${host}/**`, (r) => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
  }
  await page.route('https://example.org/**', (r) => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: 'reached' }));
  await page.addInitScript(() => {
    const g = globalThis as unknown as { __violations: string[] };
    g.__violations = [];
    document.addEventListener('securitypolicyviolation', (e) => g.__violations.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
}
const violations = (page: Page) => page.evaluate(() => (globalThis as unknown as { __violations: string[] }).__violations);
const reach = (page: Page, url: string) =>
  page.evaluate((u) => fetch(u, { credentials: 'omit' }).then((r) => (r.ok ? 'reached' : 'refused'), () => 'refused'), url);

test('the root carries a policy that connects to itself, to relays, and to the four hosts by name', async ({ page }) => {
  await guarded(page);
  const response = await page.goto('/');
  expect(response!.headers()['content-security-policy']).toBe(POLICY);
  await page.waitForSelector('html[data-hydrated="true"]');
  for (const host of ALLOWED) expect(await reach(page, `https://${host}/x`), host).toBe('reached');
  expect(await reach(page, '/version.json')).toBe('reached');
  // A relay an operator chose is any host, by scheme: the page's own socket to one raises nothing.
  await page.evaluate(() => new WebSocket('wss://relay.example.net/'));
  await page.evaluate(() => new WebSocket('ws://127.0.0.1:7777/'));
  expect(await violations(page)).toEqual([]);
});

test('anybody else is refused by the browser before it is a request, and says so', async ({ page }) => {
  await guarded(page);
  const asked: string[] = [];
  page.on('request', (r) => void (r.url().includes('example.org') && asked.push(r.url())));
  await page.goto('/');
  await page.waitForSelector('html[data-hydrated="true"]');
  expect(await reach(page, 'https://example.org/track')).toBe('refused');
  expect(asked, 'the refused request still left the page').toEqual([]);
  await expect.poll(() => violations(page)).toEqual(['connect-src https://example.org/track']);
});

test('is the root’s alone: a terminal page that checks proofs anywhere carries none', async ({ page }) => {
  await guarded(page);
  const response = await page.goto('/terminal/who/');
  expect(response!.headers()['content-security-policy']).toBeUndefined();
});
