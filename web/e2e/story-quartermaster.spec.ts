import { readdirSync, readFileSync } from 'node:fs';
import { expect, test, devices, type Browser, type BrowserContext, type Page } from '@playwright/test';
import WebSocket from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { open } from './device';
import { startRelay, type LocalRelay } from './relay-server';

/**
 * **The Quartermaster's week.**
 *
 * She runs supply. She takes a mission, does the work, reports it the next day, and wants to know
 * two things afterwards: whether it counted, and who decided — and, about the colleague she worked
 * beside, whether she can say she was there after the mission has left the map.
 *
 * ## The one thing changed about the world, and why
 *
 * Every mission NavCom shows comes from a registered poster, and the registry holds one key, Mecha
 * Jono's, whose secret no test has. So no browser test could ever see a poster *answer*: settle a
 * report, or keep an inbox for a sealed one [audit 11.S]. Here a stand-in poster is added to that
 * registry in the code the preview serves — as an agent, the way Mecha Jono is listed — and every
 * socket goes to a relay on this machine. That changes who posts, not what the phones do: the
 * Quartermaster and Wren act only through their screens. What the poster says, and the colleague
 * this story does not follow, are published to the relay as the world would publish them.
 *
 * Signing on happens on the terminal's own screens, and she then opens navcom.app, as she would.
 */

const MECHA = '6301c4d09a014909e5a48b7d0c9aa859eec18804c2fc87eab4e414aa5a319692';
const posterSecret = generateSecretKey();
const poster = getPublicKey(posterSecret);
const POSTER_NAME = 'Supply Desk';

/** America/Los_Angeles, where these missions are: PDT, seven hours behind UTC. */
const PDT = (iso: string) => new Date(`${iso}-07:00`);
const secs = (d: Date) => Math.floor(d.getTime() / 1000);
const settle = (page: Page) => page.waitForTimeout(450);

const LINE = 'Pairs of socks handed out: a count';

/** A mission from the stand-in poster: open, field work, in one state, ending when given. */
function mission(d: string, title: string, jurisdiction: string, ends: Date, ask: { id: string; text: string }, effect: string[] = []) {
  return finalizeEvent(
    {
      kind: 30079,
      created_at: secs(PDT('2026-10-05T09:00:00')),
      content: JSON.stringify({ name: title, objectives: [{ id: ask.id, ask: ask.text }], metadata: { mechaJono: { format: { effect } } } }),
      tags: [
        ['d', d], ['t', 'starcom_mission_package'], ['t', 'navcom_handoff'], ['t', 'navcom_mission'],
        ['mission_state', 'open'], ['valid_until', String(secs(ends))], ['jurisdiction', jurisdiction], ['agent', 'supply_desk']
      ]
    },
    posterSecret
  );
}

/** The poster's word on a report, or anybody's: a NIP-32 label naming the report and its mission. */
function label(secret: Uint8Array, word: string, report: string, address: string, at: Date) {
  return finalizeEvent(
    { kind: 1985, created_at: secs(at), content: '', tags: [['L', 'navcom.mission'], ['l', word, 'navcom.mission'], ['e', report], ['a', address]] },
    secret
  );
}

async function publish(url: string, event: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => ws.send(JSON.stringify(['EVENT', event])));
    ws.on('message', (raw) => {
      if ((JSON.parse(String(raw)) as unknown[])[0] === 'OK') {
        ws.close();
        resolve();
      }
    });
    ws.on('error', reject);
  });
}

/** The registry as the build writes it, and as this story extends it. */
const REGISTRY = `"${MECHA}":{name:"Mecha Jono",agent:!0}`;
const EXTENDED = `${REGISTRY},"${poster}":{name:"${POSTER_NAME}",agent:!0}`;

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
});

/** A blank phone, in Los Angeles, whose sockets all reach the relay on this machine. */
async function phone(browser: Browser, relay: LocalRelay): Promise<Page> {
  // The worker would serve the build's own code from its cache, past the splice below.
  const context = await browser.newContext({ ...devices['Pixel 5'], timezoneId: 'America/Los_Angeles', serviceWorkers: 'block' });
  contexts.push(context);
  const page = await context.newPage();
  await page.addInitScript((to: string) => {
    const Native = globalThis.WebSocket;
    class Here extends Native {
      constructor(_u: string | URL, p?: string | string[]) {
        super(to, p);
      }
    }
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = Here;
  }, relay.url);
  await page.route('**/_app/immutable/**/*.js', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({ response, body: body.includes(REGISTRY) ? body.replace(REGISTRY, EXTENDED) : body });
  });
  return page;
}

/** A callsign, on the terminal's own setup screen — the only step. */
async function signOn(page: Page, callsign: string) {
  await open(page, '/terminal/');
  await page.getByRole('link', { name: /choose a callsign/i }).click();
  await page.locator('#callsign').fill(callsign);
  await page.getByRole('button', { name: /generate keypair/i }).click();
  await expect(page.locator('#rename')).toBeVisible();
}

async function home(page: Page) {
  await open(page, '/');
  await expect(page.locator('[data-missions]')).not.toHaveAttribute('data-missions', 'connecting', { timeout: 15_000 });
}

async function toMission(page: Page, d: string) {
  await home(page);
  await expect(page.locator('[data-missions="open"]')).toContainText('Open missions · live');
  await page.locator('[data-missions="open"]').click();
  await page.locator(`[data-screen="missions"] [data-mission="${d}"]`).click();
  await expect(page.locator(`[data-screen="mission"][data-mission="${d}"]`)).toBeVisible();
}

async function takePart(page: Page) {
  await page.getByRole('button', { name: 'Take part' }).click();
  await settle(page);
  await page.locator('[data-visibility="open"]').click();
  await expect(page.locator('[data-slot="you"]')).toContainText('Taking part');
}

let relay: LocalRelay;
test.beforeEach(async () => {
  relay = await startRelay();
});
test.afterEach(async () => relay?.close());

test.describe('the Quartermaster’s week', () => {
  test('her report settles on the poster’s word, and her own record says who decided, and that it was an agent', async ({ browser }) => {
    // Two phones, sign-on on each, and a reload per day: a story, not a unit.
    test.setTimeout(180_000);
    const SOCKS = 'qm-socks-or';
    const ADDRESS = `30079:${poster}:${SOCKS}`;
    await publish(relay.url, mission(SOCKS, 'Socks for the cold snap', 'us-or', PDT('2026-10-10T22:00:00'), { id: 'handout:socks', text: 'Hand out socks.' }, [LINE]));

    // Tuesday afternoon: she takes it, in the open.
    const qm = await phone(browser, relay);
    await qm.clock.setFixedTime(PDT('2026-10-06T13:00:00'));
    await signOn(qm, 'Quartermaster');
    await toMission(qm, SOCKS);
    // The poster is shown as what it is before anybody takes part [invariant 4].
    await expect(qm.locator('[data-slot="posted-by"]')).toContainText('an agent, not a person');
    await takePart(qm);

    // Wednesday: she reports Tuesday's work, from her own missions.
    await qm.clock.setFixedTime(PDT('2026-10-07T11:00:00'));
    await home(qm);
    await qm.locator('[data-yours]').click();
    await qm.locator(`[data-report-mission="${SOCKS}"]`).click();
    const form = qm.locator('[data-screen="report"]');
    await form.locator('[data-day]').selectOption({ index: 1 });
    await form.locator('[data-ask]').first().check();
    await form.locator(`[data-count="${LINE}"]`).fill('40');
    await form.getByRole('button', { name: 'Send report' }).click();
    await settle(qm);
    await form.locator('[data-visibility="open"]').click();
    await expect(qm.locator('[data-screen="yours"] [data-sent]')).toContainText('Waiting', { timeout: 15_000 });
    const report = relay.received.find((e) => e.kind === 1912);
    expect(report, 'her report reached the relay').toBeTruthy();

    // Wren, on her own phone, disputes it. She has published no card, and the screen says so
    // before she signs: her challenge carries a key, not her callsign [audit 11.S].
    const wren = await phone(browser, relay);
    await wren.clock.setFixedTime(PDT('2026-10-07T12:00:00'));
    await signOn(wren, 'Wren');
    await toMission(wren, SOCKS);
    await wren.locator('[data-reports]').click();
    const theirs = wren.locator(`[data-screen="reports"] [data-report="${report!.id}"]`);
    await expect(theirs).toContainText('Quartermaster', { timeout: 15_000 });
    await theirs.locator('[data-challenge]').click();
    await expect(theirs.locator('[data-signed-as]')).toContainText('no card of yours is published');
    await theirs.locator('[data-confirm="challenged"]').click();
    await expect(theirs).toContainText('challenged by');
    const challenge = relay.received.find((e) => e.kind === 1985 && e.tags.some((t) => t[1] === 'challenged'));
    expect(challenge).toBeTruthy();
    const wren8 = challenge!.pubkey.slice(0, 8);
    // What Wren's own screen shows her challenge under is what everybody else reads it under.
    await expect(theirs).toContainText(`challenged by ${wren8}`);
    await expect(theirs).not.toContainText('Wren');

    // The poster settles it, in its own word, on its own relays.
    await publish(relay.url, label(posterSecret, 'settled', report!.id, ADDRESS, PDT('2026-10-07T13:00:00')));

    // Back on her phone that afternoon: who decided, by name, and that it was a machine.
    await qm.clock.setFixedTime(PDT('2026-10-07T15:00:00'));
    await home(qm);
    await qm.locator('[data-yours]').click();
    const mine = qm.locator(`[data-screen="yours"] [data-sent="${report!.id}"]`);
    await expect(mine).toContainText('Settled', { timeout: 15_000 });
    // It read "by the poster, <eight characters>": no name, and nothing to say a machine decided [audit 11.I].
    await expect(mine).toContainText(`by the poster, ${POSTER_NAME} (${poster.slice(0, 8)}, an agent)`);
    await expect(mine).toContainText(`challenged by ${wren8}`);

    // And the mission's reports say it in the same words: one naming rule, on both screens.
    await qm.locator('[data-back]').click();
    await expect(qm.locator('[data-yours]')).toBeVisible();
    await qm.locator('[data-missions="open"]').click();
    await qm.locator(`[data-screen="missions"] [data-mission="${SOCKS}"]`).click();
    await qm.locator('[data-reports]').click();
    const there = qm.locator(`[data-screen="reports"] [data-report="${report!.id}"]`);
    await expect(there).toContainText(`by the poster, ${POSTER_NAME} (${poster.slice(0, 8)}, an agent) · challenged by ${wren8}`, { timeout: 15_000 });
  });

  test('after the mission has left the map, she can still say she was there — and after its week, it is still on her phone', async ({ browser }) => {
    test.setTimeout(150_000);
    const WATER = 'qm-water-wa';
    const ADDRESS = `30079:${poster}:${WATER}`;
    const OBJECTIVE = 'handout:water';
    // Its last evening is Wednesday's: it ends at ten.
    await publish(relay.url, mission(WATER, 'Water at the overpass', 'us-wa', PDT('2026-10-07T22:00:00'), { id: OBJECTIVE, text: 'Hand out water.' }));

    const qm = await phone(browser, relay);
    await qm.clock.setFixedTime(PDT('2026-10-07T17:00:00'));
    await signOn(qm, 'Quartermaster');
    await toMission(qm, WATER);
    await takePart(qm);

    // Eleven that night, an hour after it ended. Tomorrow is the first day she can report tonight's
    // work; until midnight her missions said she had nothing to report [audit 11.S, review].
    await qm.clock.setFixedTime(PDT('2026-10-07T23:00:00'));
    await home(qm);
    await qm.locator('[data-yours]').click();
    await expect(qm.locator(`[data-report-mission="${WATER}"]`)).toContainText('reports open tomorrow');
    await expect(qm.locator('[data-screen="yours"]')).not.toContainText('Nothing to report');

    // Wren worked beside her and, as the rules ask, reports the next morning — after the mission
    // ended, as every report on a mission's last day does. Wren's phone is not this story's.
    const wrenReport = finalizeEvent(
      {
        kind: 1912,
        created_at: secs(PDT('2026-10-08T09:00:00')),
        content: JSON.stringify({ callsign: 'Wren', date: '2026-10-07' }),
        tags: [['a', ADDRESS], ['ask', OBJECTIVE]]
      },
      generateSecretKey()
    );
    await publish(relay.url, wrenReport);

    // Thursday noon. The map is dark: the mission is over. Her own missions still lead to it.
    await qm.clock.setFixedTime(PDT('2026-10-08T12:00:00'));
    await home(qm);
    await expect(qm.locator('[data-missions="none"]')).toBeVisible();
    await qm.locator('[data-yours]').click();
    // Nothing else reached the reports screen once the mission was off the map [audit 11.S].
    await qm.locator(`[data-their-reports="${WATER}"]`).click({ timeout: 10_000 });
    const item = qm.locator(`[data-screen="reports"] [data-report="${wrenReport.id}"]`);
    await expect(item).toContainText('Wren', { timeout: 15_000 });
    await expect(item).toContainText('Waiting');
    await item.locator('[data-witness]').click();
    await expect(item.locator('[data-signed-as]')).toContainText('no card of yours is published');
    await item.locator('[data-confirm="witnessed"]').click();
    const witnessed = relay.received.find((e) => e.kind === 1985 && e.tags.some((t) => t[1] === 'witnessed'));
    expect(witnessed, 'the witness reached the relay').toBeTruthy();
    expect(witnessed!.tags).toEqual([['L', 'navcom.mission'], ['l', 'witnessed', 'navcom.mission'], ['e', wrenReport.id], ['a', ADDRESS]]);
    await expect(item).toContainText(`by a witness, ${witnessed!.pubkey.slice(0, 8)}`);

    // Nine days on, the week a report can tell of is over. She is told so, and the mission she
    // did is still where she left it, rather than gone with "none yet" in its place [audit 11.S].
    await qm.clock.setFixedTime(PDT('2026-10-17T12:00:00'));
    await home(qm);
    await qm.locator('[data-yours]').click();
    const yours = qm.locator('[data-screen="yours"]');
    await expect(yours).not.toContainText('a mission you take part in waits here');
    const toReport = yours.locator('section.nc-panel').filter({ has: qm.getByRole('heading', { name: 'To report', exact: true }) });
    await expect(toReport).toContainText('Nothing to report');
    await expect(qm.locator(`[data-their-reports="${WATER}"]`)).toContainText('Water at the overpass');
    // What the row holds, not an offer it cannot keep: two weeks after the end, nothing NavCom files can be witnessed or challenged [review].
    await expect(qm.locator(`[data-their-reports="${WATER}"]`)).toContainText('reports on it');
    await expect(qm.locator(`[data-their-reports="${WATER}"]`)).not.toContainText('witness or challenge');
  });

  test('when the poster rewrites a mission into one NavCom cannot read, her claim says so rather than that it is over', async ({ browser }) => {
    test.setTimeout(120_000);
    const KITS = 'qm-kits-or';
    const ends = PDT('2026-10-10T22:00:00');
    await publish(relay.url, mission(KITS, 'Hygiene kits', 'us-or', ends, { id: 'handout:kits', text: 'Hand out kits.' }));

    const qm = await phone(browser, relay);
    await qm.clock.setFixedTime(PDT('2026-10-06T13:00:00'));
    await signOn(qm, 'Quartermaster');
    await toMission(qm, KITS);
    await takePart(qm);

    // An hour later the poster publishes a newer version with nothing to do in it. NavCom will not
    // show a field mission with no objective, and counts it in the key as not read [11.E].
    const rewritten = finalizeEvent(
      {
        kind: 30079,
        created_at: secs(PDT('2026-10-06T14:00:00')),
        content: JSON.stringify({ name: 'Hygiene kits', objectives: [] }),
        tags: [
          ['d', KITS], ['t', 'starcom_mission_package'], ['t', 'navcom_handoff'], ['t', 'navcom_mission'],
          ['mission_state', 'open'], ['valid_until', String(secs(ends))], ['jurisdiction', 'us-or'], ['agent', 'supply_desk']
        ]
      },
      posterSecret
    );
    await publish(relay.url, rewritten);

    await qm.clock.setFixedTime(PDT('2026-10-06T15:00:00'));
    await home(qm);
    await expect(qm.locator('[data-refused-count]')).toContainText('1 not read');
    await qm.locator('[data-yours]').click();
    const held = qm.locator(`[data-held$=":${KITS}"]`);
    // It is not over: it ends on the 10th. What is true is that this phone cannot read it [invariant 7].
    await expect(held).toContainText(/could not be read/i);
    await expect(held).not.toContainText(/over/i);
    await held.click();
    await expect(qm.locator('[data-slot="open"]')).toContainText('Could not be read');
    await expect(qm.locator('[data-slot="open"]')).toContainText('needs at least one objective');
  });
});

// Read once so a build with no registry fails here, loudly, rather than as a mission that never shows.
test.beforeAll(() => {
  const dir = new URL('../build/_app/immutable/chunks/', import.meta.url);
  const found = readdirSync(dir).some((f) => readFileSync(new URL(f, dir), 'utf8').includes(REGISTRY));
  if (!found) throw new Error(`no chunk in web/build holds the publisher registry as ${REGISTRY}`);
});
