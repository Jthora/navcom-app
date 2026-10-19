/**
 * What time it is somewhere, from this phone's own clock [D8; docs/design/map.md, Layers].
 *
 * Two different answers, and never one passed off as the other. A band of the time zones layer
 * knows only its standard offset, as Natural Earth drew it in 2012, so it gives standard time and
 * says so. A directory region knows its IANA zone, which the phone's `Intl` turns into the time its
 * clocks show, daylight saving included, the way the directory says "Times are local to …".
 *
 * Pure, and asks nobody: no time server, no lookup. Shared by the map, the place screen and the
 * layers' screens.
 */

/** `UTC+3`, `UTC+5:45`, `UTC−9:30`, `UTC±0`: an offset in hours, as a person reads one. */
export function labelOf(offset: number): string {
  if (offset === 0) return 'UTC±0';
  const sign = offset > 0 ? '+' : '−';
  const minutes = Math.round(Math.abs(offset) * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `UTC${sign}${h}${m === 0 ? '' : `:${String(m).padStart(2, '0')}`}`;
}

/** The time at a standard offset from UTC, `HH:MM`, at `now`: what a band's clock shows if it kept no daylight saving. */
export function clockAt(offset: number, now: number): string {
  const t = new Date(now + Math.round(offset * 60) * 60_000);
  return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * The time a place's own clocks show, from its IANA zone, with the zone's own short name for it
 * (`BST`, `GMT`, or `GMT+3` where the phone has no name). Null for a zone this phone does not know.
 */
export function localTime(zone: string, now: number): { time: string; abbr: string } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return { time: `${get('hour')}:${get('minute')}`, abbr: get('timeZoneName') };
  } catch {
    return null;
  }
}
