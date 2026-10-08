/**
 * From raw signed events to the missions a screen should show. Pure: no socket, no clock.
 *
 * Separate from the subscription so it can be tested on real packages without a network, and so
 * the same rule — newest version of each package, active only, every refusal named — applies
 * whether the events arrived live or from this device's own copy.
 *
 * **The newest version of a package wins even when NavCom cannot read it** [11.E]. A version the
 * publisher genuinely signed but NavCom refuses still supersedes the older one, so a package the
 * publisher changed into something unreadable leaves the map rather than staying on it as it was.
 * A forged version cannot do this: it carries no proof of whose it is, so it supersedes nothing.
 *
 * **Nothing in here throws** [11.R]. One malformed event used to stop the whole feed.
 */
import { getEventHash } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import {
  FUTURE_TOLERANCE_DAYS,
  MISSION_PUBLISHERS,
  missionActive,
  readMissionPackage,
  type Mission,
  type MissionReading
} from '@navcom/core';

export interface Refusal {
  /** The package's address: only a version genuinely its publisher's is listed, since only that one is worth telling them about. */
  address: string;
  d: string;
  because: string;
}

export interface Collected {
  /** Active at `now`, newest version of each package, most pressing first. */
  missions: Mission[];
  /**
   * Current packages NavCom will not show, and which line each crossed — said, never silent: a
   * feed where every package was refused must not read as a quiet night. A refused version that is
   * closed or past its end is left out, since it would not have been shown anyway.
   */
  refused: Refusal[];
  /**
   * A package signed more than a day after this device's clock says it is: the clock is behind, so
   * whether a mission has ended, and the dates a claim or report carries, are this device's to doubt.
   */
  clockBehind: boolean;
}

/**
 * Readings already made, so a package's signature is checked once, not on every update — keyed by
 * the event's id **and** its signature, and only for an event whose id is honestly its own.
 *
 * Keyed by the id alone, the memo trusted whatever arrived first under an id [audit 11, second
 * grid]. Any relay could send a genuine version's id over junk content: its failed reading was kept
 * under that id, and the genuine version, arriving next, read as the forgery — hidden, or a
 * mission its poster had closed kept open and takeable for the whole session. An id that is the
 * hash of the event's own fields names that content and nothing else; the signature beside it
 * tells a genuine copy from one carrying the same content under a signature that does not verify.
 */
export type Readings = Map<string, MissionReading>;
/** The most readings remembered: enough for every version a night has, bounded for a relay sending junk. */
export const READINGS_MAX = 1_000;

/**
 * Each event's memo key, worked out once per object: hashing a package costs about a tenth of a
 * millisecond here, and the feed reads every package again on every update.
 */
const keys = new WeakMap<object, string | null>();
function keyOf(event: unknown): string | null {
  if (!event || typeof event !== 'object') return null;
  const cached = keys.get(event);
  if (cached !== undefined) return cached;
  const e = event as { id?: unknown; sig?: unknown };
  let key: string | null = null;
  if (typeof e.id === 'string' && typeof e.sig === 'string') {
    try {
      if (getEventHash(event as Event) === e.id) key = `${e.id}:${e.sig}`;
    } catch {
      key = null;
    }
  }
  keys.set(event, key);
  return key;
}

export function readingOf(event: unknown, publishers: Parameters<typeof readMissionPackage>[1], memo?: Readings): MissionReading {
  const key = memo ? keyOf(event) : null;
  const known = key ? memo!.get(key) : undefined;
  if (known) return known;
  let reading: MissionReading;
  try {
    reading = readMissionPackage(event, publishers);
  } catch {
    reading = { ok: false, kind: 'not-a-package', because: 'It could not be read.' };
  }
  if (key) {
    if (memo!.size >= READINGS_MAX) memo!.delete(memo!.keys().next().value!);
    memo!.set(key, reading);
  }
  return reading;
}

const tagOf = (event: unknown, name: string): string | undefined => {
  const tags = (event as { tags?: unknown } | null)?.tags;
  if (!Array.isArray(tags)) return undefined;
  const t = tags.find((x) => Array.isArray(x) && x[0] === name);
  return typeof t?.[1] === 'string' ? t[1] : undefined;
};

export function collect(
  events: readonly unknown[],
  now: Date,
  publishers: Parameters<typeof readMissionPackage>[1] = MISSION_PUBLISHERS,
  memo?: Readings
): Collected {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  type Version = { at: number; id: string; reading: MissionReading; event: unknown };
  const newest = new Map<string, Version>();
  let clockBehind = false;

  for (const event of events) {
    const reading = readingOf(event, publishers, memo);
    const from = reading.ok
      ? { address: reading.mission.address, at: reading.mission.publishedAt, id: (event as { id: string }).id }
      : reading.from;
    // Proves nothing about whose it is — forged, or a copy changed on this device — so it is dropped, never listed.
    if (!from) continue;
    if (from.at > nowSeconds + FUTURE_TOLERANCE_DAYS * 86_400) clockBehind = true;
    const held = newest.get(from.address);
    // Newer wins; at the same second, the lower id does [NIP-01], so every device agrees.
    if (held && (held.at > from.at || (held.at === from.at && held.id <= from.id))) continue;
    newest.set(from.address, { at: from.at, id: from.id, reading, event });
  }

  const missions: Mission[] = [];
  const refused: Refusal[] = [];
  for (const [address, v] of newest) {
    if (v.reading.ok) {
      if (missionActive(v.reading.mission, now)) missions.push(v.reading.mission);
    } else if (v.reading.kind === 'refused') {
      const until = Number(tagOf(v.event, 'valid_until'));
      const over = tagOf(v.event, 'mission_state') === 'closed' || (Number.isFinite(until) && until > 0 && until < nowSeconds);
      if (!over) refused.push({ address, d: tagOf(v.event, 'd') ?? '', because: v.reading.because });
    }
  }
  missions.sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.validUntil - b.validUntil || a.address.localeCompare(b.address)
  );
  return { missions, refused, clockBehind };
}
