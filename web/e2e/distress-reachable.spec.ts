import { test, expect } from '@playwright/test';
import { seedDevice, open } from './device';

/**
 * The alarm has to be on the screen, not merely on the page.
 *
 * This regressed silently and nothing noticed. Measured on the built site, the Distress
 * control sat at **831–887px on a 375×667 phone** — 220px below the fold, reachable only by
 * scrolling for it — and was clipped on a Pixel 5. It was fully visible only at 6.7", while
 * the stated device floor is a prepaid Android 8, which is a small phone.
 *
 * Reach was never the problem: 28–44mm from the thumb pivot, comfortably easy either-handed
 * on all three. **A control placed perfectly inside the thumb arc is worth nothing when it is
 * not on the screen**, and a tap-target audit scores that interface full marks.
 *
 * So this asserts presence in the viewport rather than existence in the DOM, at the smallest
 * size the project claims to support, because that is the size where it failed.
 */
const PHONES = [
  { name: 'iPhone SE 4.7"', w: 375, h: 667 },
  { name: 'Pixel 5 6.0"', w: 393, h: 851 },
  { name: 'iPhone 14 Pro Max 6.7"', w: 430, h: 932 }
];

for (const p of PHONES) {
  test.describe(`Distress is reachable — ${p.name}`, () => {
    test.use({ viewport: { width: p.w, height: p.h } });

    test('is fully visible on Status without scrolling', async ({ page }) => {
      await seedDevice(page, { callsign: 'Wren' });
      await open(page, '/terminal/');
      const el = page.getByRole('link', { name: /^distress$/i }).first();
      await expect(el).toBeVisible();

      const box = await el.evaluate((n) => {
        const r = n.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, viewport: window.innerHeight };
      });

      expect(
        box.top,
        `Distress starts ${Math.round(box.top)}px down — above the viewport`
      ).toBeGreaterThanOrEqual(0);
      expect(
        box.bottom,
        `Distress ends ${Math.round(box.bottom)}px down on a ${box.viewport}px screen — ` +
          `${Math.round(box.bottom - box.viewport)}px of scrolling to reach the alarm`
      ).toBeLessThanOrEqual(box.viewport);
    });
  });
}
