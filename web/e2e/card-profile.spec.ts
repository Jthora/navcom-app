import { expect, test } from '@playwright/test';
import { seedDevice, open } from './device';

/**
 * Managing a card: who can find it, what it says you do, and where else you are.
 *
 * These assert that a person can *operate* the controls, not that the markup contains them.
 * Three times this project has shipped a mechanism with no way to reach it — `panicWipe` had
 * no button for weeks and passed every unit test — so the tests here fill the form, press
 * the buttons, and check what the screen then says.
 *
 * The two that matter most are the wording ones. A visibility control that implies a
 * protection the architecture cannot provide is worse than no control, and a handle field
 * that does not say the join is permanent is a trap for exactly the people least able to
 * absorb it.
 */

const OUT = { callsign: 'Wren' };

test('offers only the two visibility tiers that are true, and says who can see each', async ({ page }) => {
  await seedDevice(page, OUT);
  await open(page, '/terminal/card/');

  await expect(page.getByRole('radio', { name: /on the board/i })).toBeVisible();
  await expect(page.getByRole('radio', { name: /address only/i })).toBeVisible();
  // There is no server and no account, so there is no tier between these two.
  await expect(page.getByRole('radio', { name: /internal|members|registered/i })).toHaveCount(0);

  await expect(page.getByText(/anyone browsing your area can find you/i)).toBeVisible();
});

test('never implies address-only is private, and says outright that it is not', async ({ page }) => {
  await seedDevice(page, OUT);
  await open(page, '/terminal/card/');

  const address = page.locator('label.opt', { hasText: /address only/i });
  await expect(address).toContainText(/still published/i);
  await expect(address).toContainText(/does not make it secret/i);
});

test('the visibility choice is operable and holds', async ({ page }) => {
  await seedDevice(page, OUT);
  await open(page, '/terminal/card/');

  const addressOnly = page.getByRole('radio', { name: /address only/i });
  await expect(page.getByRole('radio', { name: /on the board/i })).toBeChecked();
  await addressOnly.check();
  await expect(addressOnly).toBeChecked();
});

test('caps what you do at three, by disabling the rest rather than refusing a click', async ({ page }) => {
  await seedDevice(page, OUT);
  await open(page, '/terminal/card/');

  const boxes = page.locator('fieldset.pick', { hasText: /what you do/i }).getByRole('checkbox');
  await expect(boxes.first()).toBeVisible();

  for (const name of [/Patrol/, /Supplies/, /Transport/]) {
    await page.locator('label.opt', { hasText: name }).getByRole('checkbox').check();
  }
  await expect(page.getByText(/0 left/i)).toBeVisible();

  // A fourth is unreachable rather than silently ignored.
  const fourth = page.locator('label.opt', { hasText: /Comms/ }).getByRole('checkbox');
  await expect(fourth).toBeDisabled();
});

test('says the handle join is permanent, before the field rather than after it', async ({ page }) => {
  await seedDevice(page, OUT);
  await open(page, '/terminal/card/');

  const links = page.locator('fieldset.pick', { hasText: /where else to find you/i });
  await expect(links).toContainText(/permanent/i);
  await expect(links).toContainText(/after you remove it here/i);
});

test('a handle can be added, and the screen says what its position means', async ({ page }) => {
  await seedDevice(page, OUT);
  await open(page, '/terminal/card/');

  await page.locator('#platform').selectOption('tiktok');
  await page.locator('#handle').fill('wren');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  const row = page.locator('.link', { hasText: /tiktok/i });
  await expect(row).toBeVisible();
  await expect(row).toContainText('wren');
  // The first one is the featured one, and the screen says so rather than explaining it.
  await expect(row).toContainText(/featured/i);
});

test('a platform that can only ever be a link is never called featured', async ({ page }) => {
  await seedDevice(page, OUT);
  await open(page, '/terminal/card/');

  // Reddit refuses framing and refuses unauthenticated reads. Leading with it must not
  // promise a panel that can never be filled.
  await page.locator('#platform').selectOption('reddit');
  await page.locator('#handle').fill('wren');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await expect(page.locator('.link', { hasText: /reddit/i })).toContainText(/listed/i);

  await page.locator('#platform').selectOption('bluesky');
  await page.locator('#handle').fill('wren.bsky.social');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  // Added second, featured first -- capability beats the operator's ordering.
  await expect(page.locator('.link', { hasText: /bluesky/i })).toContainText(/featured/i);
  await expect(page.locator('.link', { hasText: /reddit/i })).toContainText(/listed/i);
});

test('the same platform cannot be added twice', async ({ page }) => {
  await seedDevice(page, OUT);
  await open(page, '/terminal/card/');

  await page.locator('#platform').selectOption('tiktok');
  await page.locator('#handle').fill('wren');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await expect(page.locator('#platform').locator('option[value="tiktok"]')).toBeDisabled();
  await expect(page.locator('.link', { hasText: /tiktok/i })).toHaveCount(1);
});

test('a choice shows its own label — the box is a box, not a text field', async ({ page }) => {
  /*
   * Found by looking at a screenshot, not by an assertion. `.terminal input` sets
   * `width: 100%` and a 3.2rem min-height so a thumb can hit a text field; applied to a
   * radio it produced a control the width of the screen with no room for its label, so the
   * screen rendered two enormous circles and no readable words.
   *
   * Every test still passed: the text was in the DOM, so `toContainText` was satisfied, and
   * the control was technically visible, so `toBeVisible` was too. This asserts the shape
   * instead -- a small box, and a label wide enough to read.
   */
  await seedDevice(page, OUT);
  await open(page, '/terminal/card/');
  await page.setViewportSize({ width: 390, height: 800 });

  for (const which of [/on the board/i, /address only/i]) {
    const label = page.locator('label.opt', { hasText: which });
    const box = await label.getByRole('radio').boundingBox();
    const text = await label.locator('span').first().boundingBox();
    expect(box, 'radio has no box').not.toBeNull();
    expect(text, 'label text has no box').not.toBeNull();
    expect(box!.width, `radio is ${box!.width}px wide — it is being styled as a text field`).toBeLessThan(40);
    expect(text!.width, `label text is only ${text!.width}px wide`).toBeGreaterThan(150);
  }

  // Same rule, same stylesheet, the other control type.
  const check = page.locator('label.opt', { hasText: /Patrol/ });
  const cbox = await check.getByRole('checkbox').boundingBox();
  expect(cbox!.width, `checkbox is ${cbox!.width}px wide`).toBeLessThan(40);
});

test('a link row never wraps its controls onto a line of their own', async ({ page }) => {
  /*
   * Found by looking at a screenshot rather than by a failing assertion. On a 390px screen
   * the one-line row wrapped the remove button underneath, where it read as belonging to the
   * *next* link -- a control that is the right size, in the wrong place, saying the wrong
   * thing. Every button in a row must sit on one horizontal line with its siblings.
   */
  await seedDevice(page, OUT);
  await open(page, '/terminal/card/');

  // Added at the project's own phone viewport, then narrowed to measure. Resizing first
  // left the Add button unactionable and the rows were never created at all.
  for (const [id, h] of [['reddit', 'wren'], ['tiktok', 'wren'], ['bluesky', 'wren.bsky.social']]) {
    await page.locator('#platform').selectOption(id!);
    await page.locator('#handle').fill(h!);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.locator('.link', { hasText: new RegExp(id!, 'i') })).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 800 });

  for (const name of ['Reddit', 'TikTok', 'Bluesky']) {
    const row = page.locator('.link', { hasText: new RegExp(name, 'i') });
    const tops: number[] = [];
    for (const b of await row.locator('button.tiny').all()) {
      const box = await b.boundingBox();
      expect(box, `${name} button has no box`).not.toBeNull();
      tops.push(box!.y);
    }
    expect(tops.length, `${name} should have three controls`).toBe(3);
    expect(Math.max(...tops) - Math.min(...tops), `${name}'s controls are on different lines`).toBeLessThan(4);
  }
});

test('Add is not under the fixed signature toggle', async ({ page }) => {
  /*
   * The toggle is `position: fixed` in the bottom-right corner with `z-index: 5`. A compact
   * Add button at the end of the handle field landed under it -- measured overlapping by
   * 60 x 44px. The suite did not notice, because Playwright re-scrolls before it clicks and
   * a person does not: they aim at what they can see and hit the toggle.
   *
   * Asserts the centre, because that is where a thumb goes.
   */
  await seedDevice(page, OUT);
  await open(page, '/terminal/card/');
  await page.setViewportSize({ width: 390, height: 700 });

  const add = page.getByRole('button', { name: 'Add', exact: true });
  await add.scrollIntoViewIfNeeded();
  const a = await add.boundingBox();
  const sig = await page.locator('.signature').boundingBox();
  expect(a, 'Add has no box').not.toBeNull();
  expect(sig, 'the signature toggle has no box').not.toBeNull();

  const cx = a!.x + a!.width / 2;
  const cy = a!.y + a!.height / 2;
  const inside =
    cx >= sig!.x && cx <= sig!.x + sig!.width && cy >= sig!.y && cy <= sig!.y + sig!.height;
  expect(inside, `Add's centre (${Math.round(cx)}, ${Math.round(cy)}) is under the toggle`).toBe(false);
});

test('every control on this screen is reachable by thumb', async ({ page }) => {
  await seedDevice(page, OUT);
  await open(page, '/terminal/card/');
  await page.setViewportSize({ width: 375, height: 667 });

  await page.locator('#platform').selectOption('tiktok');
  await page.locator('#handle').fill('wren');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  // The reorder and remove glyphs are small; their targets must not be.
  for (const label of [/move tiktok up/i, /move tiktok down/i, /remove tiktok/i]) {
    const box = await page.getByRole('button', { name: label }).boundingBox();
    expect(box, `${label} has no box`).not.toBeNull();
    expect(box!.height, `${label} is ${box!.height}px tall`).toBeGreaterThanOrEqual(40);
    expect(box!.width, `${label} is ${box!.width}px wide`).toBeGreaterThanOrEqual(40);
  }
});
