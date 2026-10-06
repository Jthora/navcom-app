/**
 * The missions on the map, fetched once per build rather than once per visitor.
 *
 * **Why at build time, when missions change by the hour.** The landing map makes no request to
 * any other origin — *looking at the map tells nobody anything* [docs/design/map.md]. A browser
 * that subscribed to The Record would tell Mecha Jono's relay which visitor was looking, from
 * which address, when. So the build asks instead, from Vercel, and every visitor reads the result
 * from navcom.app. The cost is freshness, and it is paid honestly: the file carries the moment it
 * was taken, every screen that shows it says how old it is [invariant 7], and the moment somebody
 * commits to a mission is the moment it is checked live (milestone 11.4).
 *
 * **A relay that is down must not fail the build.** The snapshot times out and says it could not
 * be taken; the site still ships, and the map says missions are unavailable rather than showing
 * none as though there were none.
 */

import {
  MISSION_PACKAGE_KIND,
  MISSION_PUBLISHERS,
  THE_RECORD,
  missionActive,
  readMissionPackage,
  type Mission
} from '@navcom/core';

export interface MissionSnapshot {
  version: 1;
  /** When the build asked. Everything below is as of this moment. */
  taken_at: string;
  source: string;
  status: 'ok' | 'unavailable';
  /** Active when taken. A screen re-checks `validUntil` against its own clock. */
  missions: Mission[];
  /** Packages NavCom will not show, and which line each crossed — so the publisher can be told. */
  refused: { d: string; because: string }[];
}

const TIMEOUT_MS = 12_000;

/** Every kind-30079 event the publishers have marked as field work, or null if the relay failed. */
async function fetchPackages(relay: string): Promise<unknown[] | null> {
  if (typeof WebSocket === 'undefined') return null;
  return new Promise((resolve) => {
    const events: unknown[] = [];
    let settled = false;
    const finish = (result: unknown[] | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* closing a socket that never opened */
      }
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);
    const ws = new WebSocket(relay);
    ws.onopen = () =>
      ws.send(
        JSON.stringify([
          'REQ',
          'missions',
          { kinds: [MISSION_PACKAGE_KIND], authors: Object.keys(MISSION_PUBLISHERS), '#t': ['navcom_mission'], limit: 500 }
        ])
      );
    ws.onmessage = (m) => {
      try {
        const frame = JSON.parse(String(m.data)) as unknown[];
        if (frame[0] === 'EVENT') events.push(frame[2]);
        else if (frame[0] === 'EOSE') finish(events);
        else if (frame[0] === 'CLOSED') finish(null);
      } catch {
        /* one unreadable frame is not the relay failing */
      }
    };
    ws.onerror = () => finish(null);
  });
}

/** Read, held to the lines, newest version of each kept, active ones only. */
export function snapshotOf(
  events: unknown[],
  now: Date,
  source = THE_RECORD,
  publishers: Parameters<typeof readMissionPackage>[1] = MISSION_PUBLISHERS
): MissionSnapshot {
  const newest = new Map<string, Mission>();
  const refused: { d: string; because: string }[] = [];
  for (const event of events) {
    const reading = readMissionPackage(event, publishers);
    if (reading.ok) {
      const held = newest.get(reading.mission.address);
      if (!held || held.publishedAt < reading.mission.publishedAt) newest.set(reading.mission.address, reading.mission);
    } else if (reading.kind === 'refused') {
      const d = (event as { tags?: string[][] })?.tags?.find((t) => t[0] === 'd')?.[1] ?? '';
      refused.push({ d, because: reading.because });
    }
  }
  const missions = [...newest.values()]
    .filter((m) => missionActive(m, now))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.validUntil - b.validUntil);
  return { version: 1, taken_at: now.toISOString(), source, status: 'ok', missions, refused };
}

export async function takeSnapshot(now = new Date()): Promise<MissionSnapshot> {
  const events = await fetchPackages(THE_RECORD);
  if (events === null) {
    return { version: 1, taken_at: now.toISOString(), source: THE_RECORD, status: 'unavailable', missions: [], refused: [] };
  }
  return snapshotOf(events, now);
}
