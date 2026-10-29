import { test, type ConsoleMessage, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * navcom.app, signed on, on a phone, with nothing published: the walk an operator takes in their
 * first evening. Reads go to the real relays; every `EVENT` this phone tries to send is answered
 * here with a refusal and never leaves, so no test card, presence or patrol reaches anybody.
 *
 * It asserts nothing. It screenshots each screen and records what each said, for a person to read.
 * Run by hand, once: `LIVE_SITE=1 WALK_OUT=dir npx playwright test live-walk.spec.ts --config playwright.relay.config.ts`.
 */

test.skip(!process.env['LIVE_SITE'], 'Visits navcom.app: run by hand with LIVE_SITE=1.');
test.use({ baseURL: 'https://navcom.app' });

const OUT = process.env['WALK_OUT'] ?? 'test-results/live-walk';
const problems: string[] = [];
const said: string[] = [];
const refused: string[] = [];
let n = 0;

function watch(page: Page) {
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message.slice(0, 200)}`));
  page.on('response', (r) => {
    if (r.status() >= 400 && new URL(r.url()).hostname.endsWith('navcom.app')) problems.push(`HTTP ${r.status()}: ${r.url().slice(0, 140)}`);
  });
}

async function shot(page: Page, name: string, full = false) {
  n += 1;
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}.png`, fullPage: full }).catch(() => {});
  const text = await page.locator('main, body').first().innerText().catch(() => '');
  said.push(`--- ${name}\n${text.replace(/\n{2,}/g, '\n').slice(0, 1500)}`);
}

async function go(page: Page, path: string) {
  await page.goto(path);
  await page.waitForSelector('html[data-hydrated="true"]', { timeout: 30_000 }).catch(() => problems.push(`not hydrated: ${path}`));
}

async function step(name: string, body: () => Promise<void>) {
  try {
    await body();
  } catch (e) {
    problems.push(`step "${name}" stopped: ${(e as Error).message.split('\n')[0]?.slice(0, 200)}`);
  }
}

test('navcom.app, signed on, an evening on a phone, with nothing published', async ({ page, context }) => {
  test.setTimeout(420_000);
  mkdirSync(OUT, { recursive: true });
  page.setDefaultTimeout(15_000);
  watch(page);
  await context.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => {
      const text = String(m);
      if (text.startsWith('["EVENT"')) {
        const event = JSON.parse(text)[1] as { id: string; kind: number };
        refused.push(`kind ${event.kind} to ${ws.url()}`);
        ws.send(JSON.stringify(['OK', event.id, false, 'blocked: read-only walk']));
        return;
      }
      server.send(m);
    });
  });

  await step('landing', async () => {
    await go(page, '/');
    await page.waitForSelector('[data-missions="open"], [data-missions="none"]', { timeout: 45_000 }).catch(() => {});
    said.push(`missions line: ${await page.locator('[data-missions]').innerText().catch(() => '?')}`);
    await shot(page, 'landing');
  });

  await step('terminal, first visit', async () => {
    await go(page, '/terminal/');
    await shot(page, 'terminal-first', true);
  });

  await step('callsign', async () => {
    await go(page, '/terminal/setup/');
    await shot(page, 'setup', true);
    await page.locator('#callsign').fill('Nightjar');
    await page.getByRole('button', { name: /make my callsign/i }).click();
    await page.waitForTimeout(1500);
    await shot(page, 'setup-done', true);
  });

  await step('status', async () => {
    await go(page, '/terminal/');
    await shot(page, 'status', true);
  });

  await step('sign on', async () => {
    await go(page, '/terminal/sign-on/');
    await shot(page, 'sign-on', true);
    await page.locator('#area').fill('Kensington');
    await page.getByRole('button', { name: /^sign on$/i }).click();
    await page.waitForURL('**/terminal/', { timeout: 15_000 });
    await page.waitForSelector('html[data-hydrated="true"]');
    await shot(page, 'out', true);
  });

  await step('log', async () => {
    await go(page, '/terminal/log/');
    await shot(page, 'log', true);
  });

  await step('sign off', async () => {
    await go(page, '/terminal/');
    await page.getByRole('button', { name: /stand down/i }).first().click();
    await page.getByRole('button', { name: /i.m home/i }).click();
    await page.waitForTimeout(1500);
    await shot(page, 'signed-off', true);
  });

  for (const path of ['patrols', 'peers', 'card', 'watch', 'standing', 'distress', 'query', 'resupply']) {
    await step(path, async () => {
      await go(page, `/terminal/${path}/`);
      await shot(page, path, true);
    });
  }

  await step('root, signed on', async () => {
    await go(page, '/');
    await page.waitForSelector('[data-missions="open"], [data-missions="none"]', { timeout: 45_000 }).catch(() => {});
    await shot(page, 'root-signed-on');
    await page.locator('[data-yours]').click();
    await shot(page, 'yours');
  });

  await step('find people', async () => {
    await page.locator('[data-open-find]').click();
    await page.locator('#find-region option', { hasText: /philadelphia/i }).first().waitFor({ state: 'attached', timeout: 20_000 });
    const city = await page.locator('#find-region option').evaluateAll((os) => (os as HTMLOptionElement[]).find((o) => /philadelphia/i.test(o.text))?.value ?? '');
    await page.locator('#find-region').selectOption(city);
    await page.locator('[data-load-board]').click();
    await page.waitForTimeout(8000);
    await shot(page, 'find-board');
    await page.locator('[data-load-roster]').click();
    await page.waitForTimeout(8000);
    await shot(page, 'find-roster');
    await page.locator('#people-q').fill('a');
    await shot(page, 'find-typed');
  });

  await step('missions', async () => {
    await go(page, '/');
    await page.waitForSelector('[data-missions="open"], [data-missions="none"]', { timeout: 45_000 });
    // With none open the line is a readout, not a door.
    if ((await page.locator('[data-missions="open"]').count()) === 0) return;
    await page.locator('[data-missions]').click();
    await shot(page, 'missions');
    const first = page.locator('[data-mission]').first();
    if ((await first.count()) > 0) {
      await first.click();
      await shot(page, 'mission');
    }
  });

  console.log('\n===== refused (never sent)\n' + (refused.length ? refused.join('\n') : 'none'));
  console.log('\n===== problems\n' + (problems.length ? problems.join('\n') : 'none'));
  console.log('\n===== what each screen said\n' + said.join('\n'));
});
