import { expect, test, type Page } from '@playwright/test';
import { seedDevice, open } from './device';

/**
 * Low signature: brightness as a tactical property.
 *
 * A phone at full brightness on a dark street destroys the dark adaptation you need for the
 * next ten minutes and makes you the brightest object for a hundred metres. Every operator
 * using this is outdoors at night and none of them had a control for it.
 *
 * The P5 gate: contrast checked in both modes, document mode reachable from every screen, and
 * the choice persisting in the accruing tier.
 */

/** Relative luminance, WCAG. */
function luminance(rgb: string): number {
  const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0']).slice(0, 3).map(Number);
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

async function tones(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector('.terminal') as HTMLElement;
    const s = getComputedStyle(el);
    const read = (n: string) => {
      const probe = document.createElement('span');
      probe.style.color = `var(${n})`;
      el.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    };
    return {
      ground: s.backgroundColor,
      ink: read('--t-ink'),
      muted: read('--t-muted'),
      faint: read('--t-faint'),
      alarm: read('--t-alarm')
    };
  });
}

test.describe('low signature', () => {
  test('is reachable from every screen, not just one', async ({ page }) => {
    // A mode you can only reach from one page is a mode nobody finds at 2am.
    await seedDevice(page, { callsign: 'Wren' });
    for (const path of ['/terminal/', '/terminal/watch/', '/terminal/directory/', '/terminal/distress/']) {
      await open(page, path);
      await expect(page.locator('[data-signature-toggle]'), path).toBeVisible();
    }
  });

  test('removes white, and keeps every tone readable', async ({ page }) => {
    /*
     * The gate. Dropping luminance is only worth doing if what is left can still be read — a
     * screen that preserves your night vision and cannot be read has solved nothing.
     */
    await seedDevice(page, { callsign: 'Wren' });
    await open(page, '/terminal/');

    // An operator starts here, so this is the mode under test without touching anything.
    const after = await tones(page);
    await page.locator('[data-signature-toggle]').click();
    const document_ = await tones(page);

    expect(after.ground).not.toBe(document_.ground);
    // No white anywhere: the brightest tone on the screen is amber, not a neutral.
    const [r, g, b] = (after.ink.match(/\d+/g) ?? []).map(Number);
    expect(r).toBeGreaterThan(b + 60);
    expect(g).toBeGreaterThan(b);

    // Body text and readouts.
    expect(ratio(after.ink, after.ground)).toBeGreaterThan(4.5);
    expect(ratio(after.muted, after.ground)).toBeGreaterThan(4.5);
    // Uppercase labels only, so the large-text threshold applies.
    expect(ratio(after.faint, after.ground)).toBeGreaterThan(3);
    // The alarm channel has to survive the dimming, or it is not an alarm channel.
    expect(ratio(after.alarm, after.ground)).toBeGreaterThan(3);
  });

  test('and document mode is one tap back', async ({ page }) => {
    // Reading a directory record properly is a different job from watching a board.
    await seedDevice(page, { callsign: 'Wren' });
    await open(page, '/terminal/');

    // The control names where it takes you, not where you are.
    const toggle = page.locator('[data-signature-toggle]');
    await expect(toggle).toHaveText(/document/i);
    await toggle.click();
    await expect(toggle).toHaveText(/low signature/i);
    await toggle.click();
    await expect(toggle).toHaveText(/document/i);
  });

  test('survives being put away and taken out again', async ({ page }) => {
    // Accruing tier: it is a preference about how somebody works, not something about tonight.
    await seedDevice(page, { callsign: 'Wren' });
    await open(page, '/terminal/');
    // Away from the default, so this proves the choice is stored rather than recomputed.
    await page.locator('[data-signature-toggle]').click();

    await open(page, '/terminal/watch/');
    await expect(page.locator('html')).toHaveAttribute('data-signature', 'document');
  });

  test('and a panic wipe does not take it', async ({ page }) => {
    /*
     * A wipe destroys tonight. How somebody reads their phone outdoors is not tonight, and an
     * operator who wipes on a bad night must not be handed a screen at full brightness while
     * they are still standing in the dark.
     */
    await seedDevice(page, { callsign: 'Wren' });
    await open(page, '/terminal/');
    await page.locator('[data-signature-toggle]').click();
    await expect(page.locator('html')).toHaveAttribute('data-signature', 'document');

    await page.evaluate(() => localStorage.removeItem('navcom.wipeable'));
    await open(page, '/terminal/');
    // The wipe took tonight. It did not take how this operator reads their phone.
    await expect(page.locator('html')).toHaveAttribute('data-signature', 'document');
  });
});

test.describe('what it does before anybody has chosen', () => {
  /*
   * P9, decided. Neither "always on" nor "always off" survives contact with who opens this,
   * and a timer is ruled out by the terminal's own commitment to being learnable by muscle
   * memory. The default follows the one thing the operator has actually declared.
   */

  test('a newcomer is not handed a dim screen', async ({ page }) => {
    // A first impression that reads as degraded is the failure the Alone position exists to
    // avoid, and somebody who only wants the directory never needs a callsign at all.
    await seedDevice(page);
    await open(page, '/terminal/');
    await expect(page.locator('html')).toHaveAttribute('data-signature', 'document');
  });

  test('and an operator is, because operators work outdoors at night', async ({ page }) => {
    /*
     * The asymmetry that decides it: defaulting off and being wrong costs night vision and
     * makes somebody the brightest object on a dark street — invisibly, and possibly forever,
     * because they never find a control they were never shown. Defaulting on and being wrong
     * costs a moment of confusion, one tap from fixed.
     */
    await seedDevice(page, { callsign: 'Wren' });
    await open(page, '/terminal/');
    await expect(page.locator('html')).toHaveAttribute('data-signature', 'low');
  });

  test('and it is explained where it happens, not discovered', async ({ page }) => {
    await seedDevice(page);
    await open(page, '/terminal/setup/');
    await page.locator('#callsign').fill('Newcomer');
    await page.getByRole('button', { name: /generate keypair/i }).click();

    const said = page.locator('[data-signature-explained]');
    await expect(said).toBeVisible();
    await expect(said).toContainText(/keeps your\s+night vision/i);
    await expect(said).toContainText(/document mode is one tap\s+away/i);
  });

  test('and somebody who asked their device for more contrast is left alone', async ({ page }) => {
    /*
     * The one signal here that is neither inference nor proxy: a person who has asked their
     * whole device for more contrast has already answered this question, and dimming them
     * would be overriding a stated need with a default.
     */
    await seedDevice(page, { callsign: 'Wren' });
    await page.emulateMedia({ contrast: 'more' });
    await open(page, '/terminal/');
    await expect(page.locator('html')).toHaveAttribute('data-signature', 'document');
  });

  test('and an explicit choice outranks the default either way', async ({ page }) => {
    await seedDevice(page, { callsign: 'Wren' });
    await open(page, '/terminal/');
    await expect(page.locator('html')).toHaveAttribute('data-signature', 'low');

    await page.locator('[data-signature-toggle]').click();
    await open(page, '/terminal/watch/');
    await expect(page.locator('html')).toHaveAttribute('data-signature', 'document');
  });
});
