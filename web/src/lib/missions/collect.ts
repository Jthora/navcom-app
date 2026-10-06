/**
 * From raw signed events to the missions a screen should show. Pure: no socket, no clock.
 *
 * Separate from the subscription so it can be tested on real packages without a network, and so
 * the same rule — newest version of each package, active only, every refusal named — applies
 * whether the events arrived live or from this device's own copy.
 */
import { MISSION_PUBLISHERS, missionActive, readMissionPackage, type Mission } from '@navcom/core';

export interface Collected {
  /** Active at `now`, newest version of each package, most pressing first. */
  missions: Mission[];
  /** Packages NavCom will not show, and which line each crossed. */
  refused: { d: string; because: string }[];
}

export function collect(
  events: readonly unknown[],
  now: Date,
  publishers: Parameters<typeof readMissionPackage>[1] = MISSION_PUBLISHERS
): Collected {
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
  return { missions, refused };
}
