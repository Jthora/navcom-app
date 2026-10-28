import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { devices } from '@playwright/test';

/**
 * The watch and pairing, over the public relays NavCom ships with, from this build.
 *
 * Everything else runs against relays on this machine. `verification.md` keeps one gap open on
 * purpose: *"two phones, two networks, a relay somebody else runs"* — public relays differ in what
 * they accept, how they filter, how fast they answer and what they keep. This closes the half a
 * machine can: two phones' worth of browser, on the relays the app dials by default
 * (`relay.damus.io`, `nos.lol`), with nothing in between.
 *
 * **What it writes there, and nothing else**: a throwaway watch's state (replaceable, under a key
 * made for this run, and set to Dark when it stands down), and sealed, ephemeral traffic — a
 * sign-on, a question and its answer, a `Distress` and its answer, presence. No card, no mission, no
 * claim, no report: those are public or counted by somebody else's reader. The key bundle a new
 * callsign publishes goes too, as it does for anybody who opens the app.
 *
 * Never part of a run. `LIVE_RELAYS=1 npx playwright test live-relays.spec.ts --config
 * playwright.relay.config.ts`, by hand, and the results are a reading of tonight's relays, not a
 * property of the code.
 */

test.skip(!process.env['LIVE_RELAYS'], 'Writes to public relays: run by hand with LIVE_RELAYS=1.');

async function phone(browser: Browser) {
  const context = await browser.newContext({ ...devices['Pixel 5'], timezoneId: 'America/New_York' });
  const sockets = new Set<string>();
  context.on('page', (p) => p.on('websocket', (ws) => sockets.add(ws.url())));
  const page = await context.newPage();
  page.on('websocket', (ws) => sockets.add(ws.url()));
  return { context, page, sockets };
}

async function go(page: Page, path: string) {
  await page.goto(path);
  await page.waitForSelector('html[data-hydrated="true"]', { timeout: 20_000 });
}

async function follow(page: Page, link: Locator, path: string) {
  await link.click();
  await page.waitForURL(`**${path}`);
  await page.waitForSelector('html[data-hydrated="true"]');
}

async function newcomer(page: Page, callsign: string) {
  await go(page, '/terminal/setup/');
  await page.locator('#callsign').fill(callsign);
  await page.getByRole('button', { name: /make my callsign/i }).click();
  await expect(page.locator('#rename')).toBeVisible();
}

async function hold(page: Page, target: Locator, ms: number) {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

/** How long a step took, said, so a slow relay reads as slow rather than as broken. */
async function timed<T>(what: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const out = await fn();
  console.log(`${what}: ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return out;
}

const tag = Math.random().toString(36).slice(2, 6);

test('a watch held on one phone and joined from another, over the public relays', async ({ browser }) => {
  test.setTimeout(300_000);
  const a = await phone(browser);
  const b = await phone(browser);
  const A = a.page;
  const B = b.page;

  await newcomer(A, `Lighthouse-${tag}`);
  await go(A, '/terminal/watch/');
  await A.locator('[data-start-watch]').click();
  await hold(A, A.getByRole('button', { name: /hold to take the watch/i }), 1500);
  await expect(A.getByRole('button', { name: /^stand down$/i })).toBeVisible();

  await a.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await A.getByRole('button', { name: /copy the code/i }).click();
  const code = await A.evaluate(() => navigator.clipboard.readText());
  console.log('relays in the code: ' + new URL(code).hash.split('&').filter((p) => p.startsWith('r=')).map((p) => decodeURIComponent(p.slice(2))).join(', '));

  await newcomer(B, `Kestrel-${tag}`);
  await B.locator('#code').fill(code);
  await B.getByRole('button', { name: /fill in from the code/i }).click();
  await B.getByRole('button', { name: /^connect$/i }).click();

  await go(B, '/terminal/');
  await timed('operator reads the watch on station', () =>
    expect(B.locator('[data-capability]')).toContainText(/on station/i, { timeout: 60_000 })
  );
  console.log('heard on: ' + (await B.locator('[data-capability]').innerText()).match(/\d+ of \d+ relays/i)?.[0]);

  await follow(B, B.getByRole('link', { name: /^sign on$/i }), '/terminal/sign-on/');
  await B.locator('#area').fill('north riverfront');
  await B.getByRole('button', { name: /^sign on$/i }).click();
  await B.waitForURL('**/terminal/');
  await timed('the board has the operator', () => expect(A.locator('.nc-floor-row')).toContainText(`Kestrel-${tag}`, { timeout: 60_000 }));
  await expect(B.getByText(/no response from watchtower/i)).toHaveCount(0);
  console.log('operator status after sign-on: ' + (await B.locator('body').innerText()).match(/Last action[\s\S]{0,80}/)?.[0]?.replace(/\s+/g, ' '));

  await follow(B, B.getByRole('link', { name: /^query$/i }), '/terminal/query/');
  await B.locator('#q').fill('Is the shelter on 5th taking people tonight? (a test from NavCom’s own checks)');
  await B.getByRole('button', { name: /^ask$/i }).click();
  await timed('the question reaches the board', () => A.getByRole('button', { name: /^answer$/i }).first().waitFor({ timeout: 60_000 }));
  await A.getByRole('button', { name: /^answer$/i }).first().click();
  await A.locator('textarea[id^="a-"]').first().fill('Test answer — nobody needs to act on this.');
  await A.getByRole('button', { name: /^send$/i }).first().click();
  await timed('the answer reaches the operator', () => expect(B.locator('[data-answer]')).toContainText('Test answer', { timeout: 60_000 }));

  await go(B, '/terminal/distress/');
  await hold(B, B.locator('button.raise'), 1500);
  await timed('the Distress reaches the board', () =>
    A.getByRole('button', { name: /tell them you are awake/i }).first().waitFor({ timeout: 60_000 })
  );
  await A.getByRole('button', { name: /tell them you are awake/i }).first().click();
  const send = A.getByRole('button', { name: /^send$/i }).first();
  if (await send.isVisible()) await send.click();
  await timed('the operator hears a person has it', () => expect(B.locator('body')).toContainText(/has it/i, { timeout: 60_000 }));

  // Her phone reloads. The relays keep what was sent for a while and hand it to the new board.
  await A.reload();
  await A.waitForSelector('html[data-hydrated="true"]');
  await timed('the reloaded board knows the Distress was answered', () => expect(A.locator('[data-distress-answered]')).toBeVisible({ timeout: 60_000 }));
  await expect(A.getByRole('button', { name: /^answer$/i })).toHaveCount(0);
  await expect(A.locator('[data-earlier]').first()).toBeVisible();
  await timed('the holder is told the relays still name her', () => expect(A.locator('[data-orphaned]')).toBeVisible({ timeout: 60_000 }));

  // Leave nothing claiming a watch: the operator stands down, and so does the watch, from there.
  await go(B, '/terminal/');
  await B.getByRole('button', { name: /^stand down$/i }).click({ timeout: 5_000 }).catch(() => {});
  await A.locator('[data-orphaned] button').click();
  await go(B, '/terminal/');
  await timed('the operator reads Dark', () => expect(B.locator('[data-capability]')).toContainText(/dark/i, { timeout: 60_000 }));
  console.log('sockets the watch phone opened: ' + [...a.sockets].join(', '));
  await a.context.close();
  await b.context.close();
});

test('two phones paired in person see each other go out, over the public relays', async ({ browser }) => {
  test.setTimeout(240_000);
  const w = await phone(browser);
  const r = await phone(browser);
  await newcomer(w.page, `Wren-${tag}`);
  await newcomer(r.page, `Raven-${tag}`);

  // In person: each holds up their code, and each pairs the other's. Nothing is sent for this.
  for (const [me, them, name] of [[w, r, 'Raven'], [r, w, 'Wren']] as const) {
    await them.context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await go(them.page, '/terminal/peers/');
    await them.page.getByRole('button', { name: /copy your link/i }).click();
    const link = await them.page.evaluate(() => navigator.clipboard.readText());
    await go(me.page, '/terminal/peers/');
    await me.page.locator('#code').fill(link);
    await me.page.locator('#name').fill(name);
    await me.page.getByRole('button', { name: /^pair$/i }).click();
    await expect(me.page.locator('ul.paired')).toContainText(name, { timeout: 15_000 });
  }

  // Raven goes out; Wren sees it.
  await go(w.page, '/terminal/');
  await go(r.page, '/terminal/sign-on/');
  await r.page.locator('#area').fill('Fairmount');
  await r.page.getByRole('button', { name: /^sign on$/i }).click();
  await r.page.waitForURL('**/terminal/');
  await timed('presence reaches the peer', () => expect(w.page.locator('[data-peers]')).toContainText(/fairmount/i, { timeout: 90_000 }));
  await r.page.getByRole('button', { name: /^stand down$/i }).click({ timeout: 5_000 }).catch(() => {});
  await r.page.waitForTimeout(2000);
  await w.context.close();
  await r.context.close();
});
