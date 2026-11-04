import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { blankDevice, open, seedDevice, TEST_SECRET } from './device';
import { cutHints, pastTheEdge } from './edge';
import { TERMINAL_ROUTES } from '../src/lib/terminal/routes';

/**
 * Every terminal screen, in the three states a person reaches it in, on the device floor's screen and with
 * the phone's text made large, read for the three things a screen-by-screen test never asked of all
 * of them at once: nothing scrolls sideways, nothing is pushed off the edge, and axe finds nothing.
 *
 * Only the landing page and the root console were ever scanned by axe; the screens an operator uses
 * in the dark were not. And no test put the longest name the app accepts on them: a callsign and a
 * team of 48 characters with nowhere to break, beside names in Hebrew and with emoji, which is what a
 * visitor from another city's team may well be called (the joint night, 2026-11-02).
 *
 * 360 CSS pixels is the device floor's width [map.md §8], the prepaid Android this project is built
 * for. Large text is the phone's own setting at 150%, stood in for by scaling the page's type, since
 * Playwright cannot set Android's.
 */

const WATCH = '4'.repeat(63) + '9';
const watchBytes = Uint8Array.from((WATCH.match(/../g) ?? []).map((b) => parseInt(b, 16)));
const me = getPublicKey(Uint8Array.from((TEST_SECRET.match(/../g) ?? []).map((b) => parseInt(b, 16))));
const WATCH_PUB = getPublicKey(watchBytes);

/** The longest a callsign or a team may be, with no space to wrap at. */
const LONG = 'Nightwatchguardianofthelowereastsideandbeyond48';
const LONG_TEAM = 'Lowermanhattanjointpatrolcoalitionnightshift2027';

const TOWER = { pubkey: WATCH_PUB, relays: ['wss://fake.relay'], holders: [me] };

/** People out on the board, as their phones would have sealed them to this holder. */
async function board() {
  const { buildDistress, buildSignal } = await import('@navcom/core');
  const now = Math.floor(Date.now() / 1000);
  const out = (callsign: string, team: string, at: [number, number] | null) => ({
    callsign, team, area: 'Penn Station, the west side of 8th Avenue', expected_duration: 7200, routine_interval: 1800,
    share_position: at !== null, position: at ? { lat: at[0], lon: at[1], precision_m: 10 } : null
  });
  const people: [string, string, [number, number] | null][] = [
    [LONG, LONG_TEAM, [40.7506, -73.9935]],
    ['צל הלילה', 'שומרי העיר', [40.7497, -73.9877]],
    ['Owl 🦉', 'Zone Guardians', [40.7527, -73.9772]],
    ['Owl 🦉', 'Visitors from Philadelphia', null],
    ['Kite', 'Rescue Rangers', [40.7484, -73.9857]]
  ];
  const events = [];
  for (const [callsign, team, at] of people) {
    const key = generateSecretKey();
    events.push(finalizeEvent(buildSignal(key, { pubkey: WATCH_PUB, holders: [me] }, 'on-station', out(callsign, team, at) as never, now - 600), key));
  }
  const raven = generateSecretKey();
  events.push(finalizeEvent(buildSignal(raven, { pubkey: WATCH_PUB, holders: [me] }, 'on-station', out('Raven', LONG_TEAM, [40.751, -73.99]) as never, now - 900), raven));
  events.push(finalizeEvent(buildDistress(raven, { pubkey: WATCH_PUB, holders: [me] }, { callsign: 'Raven', team: LONG_TEAM, area: 'Penn Station', position: { lat: 40.751, lon: -73.99, precision_m: 10 } } as never, now - 30), raven));
  return events;
}

/** Words that put a verdict on a person, which no screen may say of anybody. */
const VERDICT = /\b(suspected|infiltrat\w*|informants?|untrusted|unvetted|not vetted|fake operator)\b/i;

type State = 'first visit' | 'out under a watch' | 'holding a busy board';

async function enter(page: Page, state: State) {
  const now = Math.floor(Date.now() / 1000);
  if (state === 'first visit') return blankDevice(page);
  if (state === 'out under a watch') {
    return seedDevice(page, {
      callsign: LONG,
      watchtower: TOWER,
      contact: { label: 'Sam, who knows where I am tonight', number: '+1 212 555 0100' },
      relayEvents: [],
      wipeable: { signon: { at: now - 1800, area: 'Penn Station, the west side of 8th Avenue', team: LONG_TEAM, expectedUntil: now + 5400, toldAtSignOn: 'Lighthouse', routineInterval: 1800 } }
    });
  }
  return seedDevice(page, { callsign: LONG, watchSecret: WATCH, watchtower: TOWER, relayEvents: await board() });
}

/** The phone's text at 150%: its own setting, which scales type and not the screen. */
async function largeText(page: Page) {
  await page.addStyleTag({ content: 'html { font-size: 150% !important; } body { font-size: 25.5px !important; }' });
  await page.waitForTimeout(150);
}

test.use({ viewport: { width: 360, height: 640 } });

for (const state of ['first visit', 'out under a watch', 'holding a busy board'] as const) {
  test.describe(`every terminal screen, ${state}`, () => {
    for (const route of TERMINAL_ROUTES) {
      const path = `/terminal/${route}`;
      test(`${path}: nothing off the edge at 360px, nor with large text, and axe finds nothing`, async ({ page }) => {
        // Two axe passes over a long screen, such as a region's directory, is more than the default allows.
        test.setTimeout(60_000);
        await enter(page, state);
        await open(page, path);
        if (state === 'holding a busy board' && route === 'watch/') await expect(page.locator('.nc-floor-row')).toHaveCount(6, { timeout: 15_000 });
        await page.waitForTimeout(300);

        expect(await pastTheEdge(page), `${path}, ${state}, at 360px`).toEqual([]);
        expect(await cutHints(page), `${path}, ${state}: a field's hint is cut off`).toEqual([]);
        // Unknown is not suspect: no screen puts a verdict on a person [identity.md; units.md §14].
        expect(await page.locator('body').innerText(), `${path}, ${state}`).not.toMatch(VERDICT);
        // In both signatures, whichever this device would choose: low is every operator's default
        // once they have a callsign, and the document one is everybody else's [signature.ts].
        for (const signature of ['document', 'low'] as const) {
          await page.evaluate((s) => (document.documentElement.dataset.signature = s), signature);
          await page.waitForTimeout(50);
          // Every rule once; in the second signature only the one a palette can change. A long list
          // is one template, so the first forty of each are read and not 1,912 regions twice over,
          // which outran the timeout on a loaded machine.
          let builder = new AxeBuilder({ page }).exclude('ul > li:nth-child(n+41)');
          if (signature === 'low') builder = builder.withRules(['color-contrast']);
          const axe = await builder.analyze();
          const said = axe.violations.map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
          expect(said, `${path}, ${state}, ${signature} signature`).toEqual([]);
        }

        await largeText(page);
        expect(await pastTheEdge(page), `${path}, ${state}, with large text`).toEqual([]);
      });
    }
  });
}
