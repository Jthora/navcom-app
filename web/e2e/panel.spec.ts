import { expect, test, type Page } from '@playwright/test';
import { seedDevice, open } from './device';

/**
 * The panel, in a browser.
 *
 * `panel.test.ts` holds the rules; this holds the rules **as rendered**, which is the
 * distinction this project has paid for three times: a rule the logic honoured and the output
 * did not.
 *
 * The doctrine and its phases are in `docs/design/panel.md`.
 */

const NOW = () => Math.floor(Date.now() / 1000);

/** A device under a watch that is actually publishing `input`. */
async function under(page: Page, input: Record<string, unknown>, path = '/terminal/') {
  const { finalizeEvent, generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
  const { buildWatchStateEvent } = await import('@navcom/core');
  const secret = generateSecretKey();
  const now = NOW();
  const event = finalizeEvent(
    buildWatchStateEvent({ since: now - 600, agent_health: 'ok', last_drill: null, now, ...input } as never, now),
    secret
  );
  await seedDevice(page, {
    callsign: 'Wren',
    watchtower: { pubkey: getPublicKey(secret), relays: ['wss://fake.relay'] },
    relayEvents: [event]
  });
  await open(page, path);
  return page;
}

const oncall = (callsign: string) => ({
  author: { kind: 'node' as const, callsign },
  channel: 'sms' as const,
  expires: NOW() + 3600
});

test.describe('the capability receipt, as a panel', () => {
  test('states the watch in one word, where a sentence used to be', async ({ page }) => {
    await under(page, { state: 'dark', holder: null, holder_kind: null, oncall: [] });

    const watch = page.locator('[data-slot="watch"] [data-readout-value]');
    await expect(watch).toBeVisible({ timeout: 10_000 });
    await expect(watch).toHaveText(/^dark$/i);

    // And the consequence gets its own slot rather than being buried mid-paragraph.
    await expect(page.locator('[data-slot="distress"] [data-readout]')).toHaveText(/no addressee/i);
  });

  test('and the sentence is still there, word for word', async ({ page }) => {
    /*
     * Rule 3, and the whole reason terseness is safe here. `DARK` without *"it still works
     * offline"* reads as the app being broken — so the prose was relocated, not deleted.
     */
    await under(page, { state: 'dark', holder: null, holder_kind: null, oncall: [] });

    const why = page.locator('[data-capability] [data-why]');
    await expect(why).toHaveCount(1);
    await expect(why).toContainText(/page nobody/i);
    await expect(why).toContainText(/still works offline/i);

    // And a person can actually reach it — a disclosure nobody can open is not a disclosure.
    await expect(why.locator('.nc-why-body')).toBeHidden();
    await why.locator('summary').click();
    await expect(why.locator('.nc-why-body')).toBeVisible();
  });

  test('names who is on call, and says when that is one person', async ({ page }) => {
    // 9.3: tell operators what is thin. The thin part is the loudest thing in the slot.
    await under(page, {
      state: 'automated', holder: 'nightwatch', holder_kind: 'agent', oncall: [oncall('Raven')]
    });

    const slot = page.locator('[data-slot="on-call"]');
    await expect(slot).toContainText(/raven/i, { timeout: 10_000 });
    await expect(slot).toContainText(/sole — ladder ends here/i);
  });

  test('and an agent is still identified as an agent', async ({ page }) => {
    // Invariant 5. Terseness must not be where this quietly stops being true.
    await under(page, {
      state: 'automated', holder: 'nightwatch', holder_kind: 'agent', oncall: [oncall('Raven')]
    });

    const watch = page.locator('[data-slot="watch"]');
    await expect(watch).toContainText(/automated/i, { timeout: 10_000 });
    await expect(watch).toContainText(/agent · not a human/i);
  });

  test('and an empty slot still holds its place', async ({ page }) => {
    /*
     * Rule 4. A slot that disappears when it has nothing to say cannot be learned by position,
     * and it makes "nothing to report" indistinguishable from "never asked".
     */
    await under(page, { state: 'dark', holder: null, holder_kind: null, oncall: [] });

    const slot = page.locator('[data-slot="on-call"]');
    await expect(slot).toBeVisible({ timeout: 10_000 });
    await expect(slot.locator('[data-readout-value]')).toHaveText('—');
  });
});

test.describe('rule 2, against the built artifact', () => {
  test('no readout anywhere has become a sentence', async ({ page }) => {
    /*
     * The rule is enforced in the component, which marks itself rather than throwing — a copy
     * edit must never take a screen down at 2am. This is the half that makes the mark matter:
     * nothing marked may reach a screen.
     *
     * Checked across the states that render different readouts, because a limit that only
     * holds in the happy path is not a limit.
     */
    const states = [
      { state: 'dark', holder: null, holder_kind: null, oncall: [] },
      { state: 'station', holder: 'Owl', holder_kind: 'human', oncall: [] },
      { state: 'automated', holder: 'nightwatch', holder_kind: 'agent', oncall: [oncall('Raven')] },
      {
        state: 'automated', holder: 'nightwatch', holder_kind: 'agent',
        oncall: [oncall('Raven'), oncall('Owl'), oncall('Finch')]
      }
    ];

    for (const s of states) {
      await under(page, s);
      await expect(page.locator('[data-readout]').first()).toBeVisible({ timeout: 10_000 });
      const overlong = await page.locator('[data-readout][data-overlong="true"]').allTextContents();
      expect(overlong, `overlong readout in state ${s.state}`).toEqual([]);
    }
  });
});

test.describe('the tone mark, against the built artifact', () => {
  /*
   * `panel.test.ts` holds the shapes and their distinctness. This holds the three things only
   * a browser can answer: that the mark reached the screen, that it is actually drawn there,
   * and that it did not join the text of the page on its way.
   *
   * The third one is the reason the mark is an `<svg>` and not a CSS `content:`. Eight specs
   * in this directory assert on `body.innerText()` -- `funding`, `public-roster`,
   * `capabilities`, `story-alone`, `story-doorway`, `print` and `link-colour` among them --
   * and a generated glyph would have quietly prepended a character to every readout in all of
   * them. That is exactly the class of failure `panel.css` already carries a scar from, when
   * `text-transform: uppercase` reached a `<pre>` holding a watch key and nineteen tests fell
   * over at once.
   */
  const STATES = [
    { state: 'dark', holder: null, holder_kind: null, oncall: [] },
    { state: 'station', holder: 'Owl', holder_kind: 'human', oncall: [] },
    { state: 'automated', holder: 'nightwatch', holder_kind: 'agent', oncall: [oncall('Raven')] }
  ];

  test('every readout that claims a state carries its mark, and neutral carries none', async ({
    page
  }) => {
    for (const s of STATES) {
      await under(page, s);
      await expect(page.locator('[data-readout]').first()).toBeVisible({ timeout: 10_000 });

      const readouts = await page.locator('[data-readout]').all();
      expect(readouts.length, `no readouts at all in state ${s.state}`).toBeGreaterThan(3);

      for (const r of readouts) {
        const tone = (await r.getAttribute('data-tone')) ?? '(none)';
        const value = (await r.locator('[data-readout-value]').innerText()).trim();
        const marks = await r.locator('svg[data-glyph]').count();
        if (tone === 'neutral') {
          expect(marks, `"${value}" is neutral and should carry no mark`).toBe(0);
        } else {
          expect(marks, `"${value}" is ${tone} and is missing its mark`).toBe(1);
        }
      }
    }
  });

  test('and the mark is drawn, not merely present in the markup', async ({ page }) => {
    /*
     * A mechanism nobody can reach is not built. An `<svg>` with no intrinsic size renders at
     * nothing at all while still satisfying every assertion about its existence -- so the
     * question this asks is the one an operator would: is there a mark on the screen.
     */
    await under(page, STATES[0]);
    const mark = page.locator('[data-readout][data-tone="cold"] svg[data-glyph]').first();
    await expect(mark).toBeVisible({ timeout: 10_000 });

    const box = await mark.boundingBox();
    expect(box, 'the mark has no box at all').not.toBeNull();
    expect(box!.width, 'the mark is too small to see').toBeGreaterThan(6);
    expect(box!.height, 'the mark is too small to see').toBeGreaterThan(6);

    // Hidden from assistive technology on purpose: the word beside it is the accessible name,
    // and announcing both makes a screen reader say every state twice.
    await expect(mark).toHaveAttribute('aria-hidden', 'true');
  });

  test('at the size of the words it sits beside, and on their centre', async ({ page }) => {
    /*
     * Written after looking at a screenshot, because nothing else here could see it.
     *
     * The first version drew a mark about 0.73x the cap height beside it, and every assertion
     * passed: it existed, it was visible, its box was wider than six pixels. On the screen it
     * read as a small mark floating above the word rather than a peer of it. The diagnosis by
     * eye -- "it sits too high" -- was then wrong twice over: measuring put its centre 0.3px
     * from where it is now, so it was never misaligned, and a first attempt at this guard
     * measured a probe span's line height and called it cap height.
     *
     * Hence the two things it is careful about. Cap height comes from canvas `TextMetrics`,
     * which reports real ink. And the mark's extent adds the stroke back on, because
     * `getBoundingClientRect` on an SVG shape returns geometry only -- the number that made a
     * stroked circle and a stroked triangle look 20% apart while both measured "fine".
     */
    await under(page, STATES[0]);
    await expect(page.locator('[data-readout]').first()).toBeVisible({ timeout: 10_000 });

    const rows = await page.evaluate(() => {
      const out: { text: string; ratio: number; offBy: number }[] = [];
      for (const r of document.querySelectorAll('[data-readout]')) {
        const svg = r.querySelector('svg[data-glyph]');
        const shape = svg?.firstElementChild;
        const v = r.querySelector('[data-readout-value]');
        if (!svg || !shape || !v) continue;

        const cs = getComputedStyle(v as Element);
        const ctx = document.createElement('canvas').getContext('2d')!;
        ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const m = ctx.measureText('H');
        const cap = m.actualBoundingBoxAscent + Math.max(0, m.actualBoundingBoxDescent);

        // Geometry plus stroke: what an eye actually sees.
        const box = svg.getBoundingClientRect();
        const perUnit = box.height / 16;
        const stroke = parseFloat(shape.getAttribute('stroke-width') ?? '0') * perUnit;
        const sb = shape.getBoundingClientRect();
        const vb = (v as Element).getBoundingClientRect();

        out.push({
          text: (v.textContent || '').trim().slice(0, 20),
          ratio: (sb.height + stroke) / cap,
          offBy: sb.top + sb.height / 2 - (vb.top + vb.height / 2)
        });
      }
      return out;
    });

    expect(rows.length, 'no marked readouts to measure').toBeGreaterThan(0);
    for (const r of rows) {
      const how = `the mark beside "${r.text}" is ${r.ratio.toFixed(2)}x its cap height`;
      // Below 0.80 is the version that looked wrong. Above 1.15 the mark starts shouting over
      // the word, and rule 1 is that the word is the readout.
      expect(r.ratio, how).toBeGreaterThan(0.8);
      expect(r.ratio, how).toBeLessThan(1.15);
      expect(
        Math.abs(r.offBy),
        `the mark beside "${r.text}" is ${r.offBy.toFixed(2)}px off the line it sits on`
      ).toBeLessThan(2);
    }
  });
});
