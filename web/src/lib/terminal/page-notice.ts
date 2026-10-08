/**
 * What a pushed page shows, and how it is put on the screen.
 *
 * The service worker's half of *A page says what kind it is* [`escalation.spec.md`, *Paging
 * channels*], kept here so it can be tested without a browser: the worker reads the push, asks
 * {@link noticeFor} what to show, and hands it to {@link showPage}.
 *
 * ## Three kinds, and they must not look alike
 *
 * - **first**: a ladder's page about a new `Distress`. Each ladder gets a card of its own, tagged by
 *   its id, with its own one-tap acknowledgement — so a second operator's page never erases the
 *   first one's card and link, and an exact duplicate of the same ladder replaces itself quietly
 * - **repeat**: the person who acknowledged an operator, paged again because that operator is still
 *   sending. Its own title, so the word read first at 3am is not "Distress"; its own card, so it
 *   never replaces a first page; and **never the `?ack=` link** — that attempt has no ladder to
 *   acknowledge, and a one-tap acknowledgement here would tell the person tapping the operator had
 *   heard them. It opens the screen whose one action is to wake the others
 * - **drill**: unchanged, and never mistaken for a real one
 *
 * ## Failing toward alarm
 *
 * A push with no data, data this version cannot read, or a kind it does not know is a first page:
 * never a repeat, never a drill, never nothing. Of the wrong readings, a real page shown as a drill
 * is the one somebody sleeps through.
 *
 * ## Close, then show
 *
 * A card that replaces another with the same tag makes **no sound** unless `renotify` is set, and
 * `renotify` works only in Chromium. So a page that has to alert every time — a first page with no id
 * to tell ladders apart, and every repeat — closes whatever card holds its tag, and then shows a new
 * one, which every platform alerts for. A failure to close never stops the new one being shown.
 *
 * ## No words from the wire
 *
 * Every title and body is fixed here. The ids and times a push carries are checked for shape and
 * used only to build the address a tap opens — never shown as text.
 */

/** What a page is. The same three as `@navcom/core`'s `PageKind`. */
export type PageKind = 'first' | 'repeat' | 'drill';

/**
 * The kind a page says it is, by core's rule (`pageKindOf` in `escalation.ts`): an exact kind wins;
 * otherwise `drill: true`, the older flag, means a drill; anything else is a first page.
 *
 * **A copy, on purpose, and a test holds it to core's.** The worker is fetched on a phone's first
 * visit, before anything is cached, and core's index would bring the curve and hashing libraries with
 * it for three string comparisons.
 */
export function pageKindOf(kind: unknown, drill?: unknown): PageKind {
  if (kind === 'first' || kind === 'repeat' || kind === 'drill') return kind;
  return drill === true ? 'drill' : 'first';
}

export interface PageNotice {
  kind: PageKind;
  title: string;
  body: string;
  /** Cards with the same tag replace each other. */
  tag: string;
  requireInteraction: boolean;
  /** Where a tap goes. */
  url: string;
  /** Close any card holding this tag before showing, so the new one alerts on every platform. */
  replace: boolean;
}

export const FIRST_TITLE = 'NavCom — Distress';
export const REPEAT_TITLE = 'NavCom — Someone you answered sent again';
export const DRILL_TITLE = 'NavCom drill — not an emergency';

/**
 * The repeat's words: true whatever happens next, and saying nothing about who else was woken. A tap
 * opens a screen and wakes nobody — that takes a second, deliberate press there — so the words say
 * "open this to ask", never "tap to wake" [review: live hole, phone].
 */
export const REPEAT_BODY =
  'A Distress came again from an operator you acknowledged. If you are not with them, reach them another way, or open this to ask the watch to wake the others.';

const ID = /^[0-9a-f]{64}$/;

/** A time a push carries, in seconds, if it is a whole number within two days of now. */
function stamp(value: unknown, nowS: number): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value - nowS) <= 172_800
    ? value
    : null;
}

/**
 * What to show for a push, from its data as parsed — `null` for a push that had none or none that
 * parsed. `base` is the app's base path, `nowS` this phone's clock, in seconds.
 */
export function noticeFor(data: unknown, base: string, nowS: number): PageNotice {
  const d = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const kind = pageKindOf(d['kind'], d['drill']);

  if (kind === 'repeat') {
    // Its own field, and only that. A `distress` beside it is never read: that is the id a page
    // offers to acknowledge, and this attempt has no ladder to acknowledge.
    const attempt = typeof d['attempt'] === 'string' && ID.test(d['attempt']) ? d['attempt'] : null;
    const query = new URLSearchParams();
    if (attempt) query.set('attempt', attempt);
    // When it arrived, by this phone's clock, so the screen can say how long the watch waits.
    query.set('paged', String(nowS));
    const acked = stamp(d['acked'], nowS);
    const widens = stamp(d['widens'], nowS);
    if (acked !== null) query.set('acked', String(acked));
    if (widens !== null) query.set('widens', String(widens));
    return {
      kind,
      title: REPEAT_TITLE,
      body: REPEAT_BODY,
      tag: 'navcom-repeat',
      requireInteraction: true,
      url: `${base}/terminal/wake/?${query.toString()}`,
      replace: true
    };
  }

  const distress = typeof d['distress'] === 'string' && ID.test(d['distress']) ? d['distress'] : null;
  const url = distress ? `${base}/terminal/?ack=${distress}` : `${base}/terminal/`;

  if (kind === 'drill') {
    return {
      kind,
      title: DRILL_TITLE,
      body: distress
        ? 'A drill, not an emergency. Tap to acknowledge it, so the roster can be proven.'
        : 'A drill, not an emergency. Acknowledge it in the console so the roster can be proven.',
      tag: 'navcom-drill',
      requireInteraction: false,
      url,
      replace: false
    };
  }

  return {
    kind,
    title: FIRST_TITLE,
    body: distress
      ? 'An operator is waiting for a human. Tap to say you have it.'
      : 'An operator is waiting for a human. Open the board and tell them you are awake.',
    // One card per ladder. Without an id there is no telling ladders apart, so the one tag is kept
    // and the card is closed and shown again, so each page still alerts.
    tag: distress ? `navcom-distress-${distress.slice(0, 16)}` : 'navcom-distress',
    requireInteraction: true,
    url,
    replace: distress === null
  };
}

/** The part of a service worker registration this needs. */
export interface NotificationHost {
  getNotifications(filter?: { tag?: string }): Promise<readonly { close(): void }[]>;
  showNotification(title: string, options: NotificationOptions): Promise<void>;
}

/**
 * Puts a page on the screen: closes whatever holds its tag where it must alert again, then shows it.
 * Inside the push's `waitUntil`, so the worker is kept alive for all of it. Never stops short of
 * showing: a close that fails is passed over.
 */
export async function showPage(host: NotificationHost, notice: PageNotice): Promise<void> {
  if (notice.replace) {
    try {
      for (const card of await host.getNotifications({ tag: notice.tag })) {
        try {
          card.close();
        } catch {
          /* the new card goes up regardless */
        }
      }
    } catch {
      /* the new card goes up regardless */
    }
  }
  await host.showNotification(notice.title, {
    body: notice.body,
    tag: notice.tag,
    requireInteraction: notice.requireInteraction,
    data: { url: notice.url }
  });
}
