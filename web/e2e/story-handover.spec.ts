import { expect, test, type Browser, type Page } from '@playwright/test';
import { seedDevice, open, deliver , holdUntil } from './device';

/**
 * **A squad hands the board over mid-shift.**
 *
 * A squad shares one watch key and holds the board on a phone — the arrangement this project
 * expects most. Handover is two people in a room agreeing, and the thing that must not happen
 * is anybody **out there** learning something false about who is watching.
 *
 * The board itself is deliberately not handed over: *"nobody hands a board over, because
 * nobody holds anybody else's picture. So the incoming watch starts empty, and the way it
 * fills is that operators say they are out again."* This is about the **watch state**, which
 * is the one thing that does cross.
 */

const WATCH = 'a'.repeat(63) + '3';

async function holder(browser: Browser, callsign: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await seedDevice(page, { callsign, watchSecret: WATCH, relayEvents: [] });
  return page;
}

/** Every watch state this phone published, newest last. */
const published = (page: Page) =>
  page.evaluate(() =>
    ((window as never as { __navcomPublished?: { kind: number; content: string }[] })
      .__navcomPublished ?? [])
      .filter((e) => e.kind === 10910)
      .map((e) => {
        try { return JSON.parse(e.content) as { state: string; holder: string | null }; }
        catch { return { state: 'unreadable', holder: null }; }
      })
  );

test.describe('handing the board over', () => {
  test.setTimeout(60_000);

  test('the outgoing holder does not publish Dark over the incoming one', async ({ browser }) => {
    // The hole this found: watch state is replaceable and any holder can overwrite it, so
    // Wren standing down after Raven took over replaced Raven's `station` with Dark. An
    // operator signing on was told nobody was watching while somebody was, and Raven's
    // heartbeat only corrected it up to two minutes later.
    const wren = await holder(browser, 'Wren');
    const raven = await holder(browser, 'Raven');

    await open(wren, '/terminal/watch/');
    await holdUntil(wren, 'button:has-text("take the watch")');
    await wren.waitForTimeout(400);

    await open(raven, '/terminal/watch/');
    await holdUntil(raven, 'button:has-text("take the watch")');
    await raven.waitForTimeout(400);

    // Wren learns, as her phone would from the relay, that Raven now holds it.
    await deliver(raven, wren);
    await wren.waitForTimeout(400);

    await wren.getByRole('button', { name: /stand down/i }).click();
    await wren.waitForTimeout(800);

    const states = await published(wren);
    expect(states.some((s) => s.state === 'station' && s.holder === 'Wren')).toBe(true);
    expect(
      states.some((s) => s.state === 'dark'),
      'Wren published Dark over a watch Raven is holding'
    ).toBe(false);

    await wren.context().close();
    await raven.context().close();
  });

  test('but standing down with nobody taking over still publishes Dark', async ({ browser }) => {
    // The other half, and the one that must not be broken by the fix: going quiet would leave
    // a stale claim that a human is here, which is what standDown exists to prevent.
    const wren = await holder(browser, 'Wren');

    await open(wren, '/terminal/watch/');
    await holdUntil(wren, 'button:has-text("take the watch")');
    await wren.waitForTimeout(400);
    await wren.getByRole('button', { name: /stand down/i }).click();
    await wren.waitForTimeout(800);

    const states = await published(wren);
    expect(states.some((s) => s.state === 'dark')).toBe(true);

    await wren.context().close();
  });

  test('and the incoming holder starts from an empty board', async ({ browser }) => {
    // Stated in the module and worth holding to: the incoming watch derives its own picture
    // rather than being handed one. Nothing about Wren's board reaches Raven.
    const wren = await holder(browser, 'Wren');
    const raven = await holder(browser, 'Raven');

    await open(wren, '/terminal/watch/');
    await holdUntil(wren, 'button:has-text("take the watch")');

    await open(raven, '/terminal/watch/');
    await holdUntil(raven, 'button:has-text("take the watch")');
    await raven.waitForTimeout(400);

    await expect(raven.getByText(/nothing waiting/i)).toBeVisible();

    await wren.context().close();
    await raven.context().close();
  });
});
