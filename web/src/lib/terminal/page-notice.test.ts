/**
 * What a pushed page shows [`escalation.spec.md`, *A page says what kind it is*].
 *
 * The worker used one tag and no `renotify` for every page. On Chromium and Firefox a card that
 * replaces another with the same tag makes no sound, so a repeat to the person who acknowledged was
 * heard only if they had cleared the first card — and an acknowledgement from the board or console
 * never clears it. It also read as a new `Distress`, erased another operator's unanswered card with
 * its one-tap link, and drills arrived as "NavCom — Distress" because the kind was never read.
 *
 * `e2e/push-kinds.spec.ts` drives the built worker with real pushes; this holds the rules.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pageKindOf as corePageKindOf } from '@navcom/core';
import {
  DRILL_TITLE,
  FIRST_TITLE,
  REPEAT_TITLE,
  noticeFor,
  pageKindOf,
  showPage,
  type NotificationHost,
  type PageNotice
} from './page-notice';

const NOW = 1_800_000_000;
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const notice = (data: unknown) => noticeFor(data, '', NOW);

/** A registration's notifications, as the WHATWG show steps keep them: a tag replaces in place. */
function tray() {
  const cards: { title: string; tag: string; url: string; closed: boolean; alerted: boolean }[] = [];
  const host: NotificationHost = {
    getNotifications: async (filter) =>
      cards
        .filter((c) => !c.closed && (!filter?.tag || c.tag === filter.tag))
        .map((c) => ({ close: () => void (c.closed = true) })),
    showNotification: async (title, options) => {
      const tag = options.tag ?? '';
      const url = (options.data as { url: string }).url;
      const open = cards.find((c) => !c.closed && c.tag === tag && tag !== '');
      if (open) {
        // Replaced in place: no sound, without `renotify`, which is Chromium's alone.
        Object.assign(open, { title, url, alerted: false });
      } else {
        cards.push({ title, tag, url, closed: false, alerted: true });
      }
    }
  };
  const showing = () => cards.filter((c) => !c.closed);
  return { host, showing, cards };
}

describe('the kind a page says it is', () => {
  const cases: [unknown, unknown][] = [
    ['first', undefined], ['repeat', undefined], ['drill', undefined],
    ['first', true], ['repeat', true], ['drill', false],
    [undefined, true], [undefined, false], [undefined, undefined], [null, 'true'],
    ['REPEAT', undefined], ['repeat ', undefined], ['{{kind}}', undefined], ['', true],
    [1, undefined], [{}, true], [['repeat'], undefined]
  ];

  it.each(cases)('is read as core reads it: kind %j, drill %j', (kind, drill) => {
    // A copy, kept out of core's index for the worker's size; it must never disagree with core.
    expect(pageKindOf(kind, drill)).toBe(corePageKindOf(kind, drill));
  });
});

describe('a first page', () => {
  it('gets a card per ladder, tagged by its id, with that ladder’s one-tap link', () => {
    const n = notice({ kind: 'first', drill: false, distress: A });
    expect(n).toMatchObject({ title: FIRST_TITLE, tag: `navcom-distress-${A.slice(0, 16)}`, url: `/terminal/?ack=${A}`, replace: false });
    expect(n.requireInteraction).toBe(true);
  });

  it('keeps the one shared tag without an id, and closes the old card first so it alerts', () => {
    expect(notice({ kind: 'first' })).toMatchObject({ tag: 'navcom-distress', url: '/terminal/', replace: true });
  });

  it('is what anything unreadable is: no data, an unknown kind, a template left unfilled', () => {
    for (const data of [null, undefined, 'garbage', 42, {}, { kind: 'nope' }, { kind: '{{kind}}', distress: A }]) {
      expect(notice(data).title, JSON.stringify(data)).toBe(FIRST_TITLE);
    }
  });

  it('never carries an id that is not one into the link', () => {
    for (const distress of ['A'.repeat(64), 'a'.repeat(63), `${A}&x=1`, 'javascript:alert(1)']) {
      expect(notice({ kind: 'first', distress }).url).toBe('/terminal/');
    }
  });
});

describe('a repeat page, to the person who acknowledged', () => {
  it('says what it is in the words read first, never "Distress" first', () => {
    const n = notice({ kind: 'repeat', drill: false, attempt: A });
    expect(n.title).toBe(REPEAT_TITLE);
    expect(n.title).not.toMatch(/^NavCom — Distress/);
    expect(n.body).not.toMatch(/nobody else|no one else/i);
    expect(n.requireInteraction).toBe(true);
    expect(n).toMatchObject({ tag: 'navcom-repeat', replace: true });
  });

  it('never says a tap on it wakes anybody: the tap opens a screen, and the waking is a second press there', () => {
    const { body } = notice({ kind: 'repeat', attempt: A });
    expect(body, 'somebody at 3am taps, believes the roster is being woken, and puts the phone down').not.toMatch(
      /tap (here )?to wake|tapping wakes|tap and the/i
    );
    expect(body).toMatch(/open this to ask the watch to wake the others/);
  });

  it('opens the screen that wakes the others, with the attempt, and never the one-tap acknowledgement', () => {
    const n = notice({ kind: 'repeat', attempt: A, distress: B });
    const url = new URL(n.url, 'https://navcom.app');
    expect(url.pathname).toBe('/terminal/wake/');
    expect(url.searchParams.get('attempt')).toBe(A);
    expect(url.searchParams.get('paged')).toBe(String(NOW));
    expect(n.url).not.toContain('ack=');
    expect(n.url).not.toContain(B);
  });

  it('carries the times it was given for the screen’s words, and drops any that are not times', () => {
    const good = new URL(notice({ kind: 'repeat', attempt: A, acked: NOW - 720, widens: NOW + 240 }).url, 'https://x');
    expect(good.searchParams.get('acked')).toBe(String(NOW - 720));
    expect(good.searchParams.get('widens')).toBe(String(NOW + 240));
    const bad = new URL(notice({ kind: 'repeat', attempt: A, acked: 'soon', widens: NOW + 9e9 }).url, 'https://x');
    expect(bad.searchParams.has('acked')).toBe(false);
    expect(bad.searchParams.has('widens')).toBe(false);
  });

  it('still opens that screen without an attempt, and still never the acknowledgement', () => {
    const n = notice({ kind: 'repeat', distress: A });
    expect(n.url.startsWith('/terminal/wake/')).toBe(true);
    expect(n.url).not.toContain('ack=');
  });
});

describe('a drill', () => {
  it('reads as a drill, by kind or by the older flag, and is never mistaken for a real one', () => {
    for (const data of [{ kind: 'drill' }, { drill: true }, { kind: 'drill', drill: false, distress: A }]) {
      const n = notice(data);
      expect(n.title).toBe(DRILL_TITLE);
      expect(n.tag).toBe('navcom-drill');
      expect(n.requireInteraction).toBe(false);
    }
  });

  it('is not a drill when the kind says otherwise, whatever the older flag says', () => {
    expect(notice({ kind: 'first', drill: true }).title).toBe(FIRST_TITLE);
    expect(notice({ kind: 'repeat', drill: true }).title).toBe(REPEAT_TITLE);
  });
});

describe('putting pages on the screen', () => {
  const show = async (t: ReturnType<typeof tray>, data: unknown) => showPage(t.host, notice(data));

  it('never lets a repeat replace a first page', async () => {
    const t = tray();
    await show(t, { kind: 'first', distress: A });
    await show(t, { kind: 'repeat', attempt: B });
    expect(t.showing().map((c) => c.title).sort()).toEqual([FIRST_TITLE, REPEAT_TITLE].sort());
    expect(t.showing().find((c) => c.title === FIRST_TITLE)?.url).toBe(`/terminal/?ack=${A}`);
  });

  it('keeps two ladders as two cards, each with its own link', async () => {
    const t = tray();
    await show(t, { kind: 'first', distress: A });
    await show(t, { kind: 'first', distress: B });
    expect(t.showing().map((c) => c.url).sort()).toEqual([`/terminal/?ack=${A}`, `/terminal/?ack=${B}`]);
  });

  it('leaves one card for consecutive repeats, and each one alerts', async () => {
    const t = tray();
    await show(t, { kind: 'repeat', attempt: A });
    await show(t, { kind: 'repeat', attempt: B });
    expect(t.showing()).toHaveLength(1);
    expect(t.showing()[0]!.alerted, 'a repeat replaced in place, which makes no sound').toBe(true);
    expect(t.showing()[0]!.url).toContain(B);
  });

  it('alerts again for a first page with no id, rather than replacing the card in silence', async () => {
    const t = tray();
    await show(t, { kind: 'first' });
    await show(t, { kind: 'first' });
    expect(t.showing()).toHaveLength(1);
    expect(t.showing()[0]!.alerted).toBe(true);
  });

  it('still shows the page when the old card cannot be found or closed', async () => {
    let shown: string | null = null;
    const host: NotificationHost = {
      getNotifications: async () => {
        throw new Error('not allowed');
      },
      showNotification: async (title) => void (shown = title)
    };
    await showPage(host, notice({ kind: 'repeat', attempt: A }) as PageNotice);
    expect(shown).toBe(REPEAT_TITLE);
  });
});

describe('the worker that ships', () => {
  it('shows pushes by these rules, and has no wording of its own', () => {
    // A rule nobody can reach is not built: the worker is what a push meets.
    const src = readFileSync(fileURLToPath(new URL('../../service-worker.ts', import.meta.url)), 'utf8');
    expect(src).toMatch(/from '\$lib\/terminal\/page-notice'/);
    expect(src).toMatch(/showPage\(sw\.registration, noticeFor\(/);
    expect(src).not.toMatch(/showNotification\(/);
    expect(src).not.toMatch(/'navcom-distress'/);
  });
});
