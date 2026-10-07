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

/** Readings already made, by event id: a package's signature is checked once, not on every update. */
export type Readings = Map<string, MissionReading>;

export function readingOf(event: unknown, publishers: Parameters<typeof readMissionPackage>[1], memo?: Readings): MissionReading {
  const id = (event as { id?: unknown } | null)?.id;
  const known = typeof id === 'string' ? memo?.get(id) : undefined;
  if (known) return known;
  let reading: MissionReading;
  try {
    reading = readMissionPackage(event, publishers);
  } catch {
    reading = { ok: false, kind: 'not-a-package', because: 'It could not be read.' };
  }
  if (typeof id === 'string') memo?.set(id, reading);
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
