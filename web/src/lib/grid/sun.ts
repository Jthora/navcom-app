/**
 * Where the sun is overhead, and where on Earth it is night, from this phone's clock alone
 * [docs/design/map.md, Day and night].
 *
 * Nothing is fetched and nobody is asked: the position comes from the almanac's low-precision formulas
 * (the US Naval Observatory's: the sun's mean longitude and anomaly, the obliquity, and Greenwich mean
 * sidereal time), within a hundredth of a degree of Meeus's higher-accuracy method, about a kilometre.
 * The line is drawn from points 2° of bearing apart, so between them it is a chord, off by up to about
 * 15 km at the equator: still finer than the line's own width on a phone at any zoom that shows a whole
 * country; refraction near the horizon, which the standard −0.833° only averages, moves the line further,
 * so the line is good to within tens of kilometres. What it cannot know is a wrong clock: the page says
 * when this phone's clock is behind what the relays report, and nothing can say when it is ahead.
 *
 * Pure: no DOM, no canvas. Tested against Meeus, and against Spencer's series, which shares no formula
 * with either.
 */

const RAD = Math.PI / 180;

/** Where the sun is straight overhead, in degrees: its declination, and the longitude of local noon. */
export interface SunPoint {
  lat: number;
  lon: number;
}

/**
 * The night's four edges, by how far below the horizon the sun is: sunrise and sunset (its upper limb
 * on the horizon, with refraction), then civil, nautical and astronomical twilight. Each is a cap round
 * the point opposite the sun, smaller the deeper the night.
 */
export const TWILIGHT = [-0.833, -6, -12, -18] as const;

const wrap = (deg: number) => deg - 360 * Math.round(deg / 360);

/** The point under the sun at `ms`, milliseconds since 1970 UTC. */
export function subsolar(ms: number): SunPoint {
  // Days since J2000.0, from the Unix epoch's Julian date.
  const n = ms / 86_400_000 + 2440587.5 - 2451545.0;
  const mean = 280.46 + 0.9856474 * n;
  const anomaly = (357.528 + 0.9856003 * n) * RAD;
  const ecliptic = (mean + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * RAD;
  const obliquity = (23.439 - 0.0000004 * n) * RAD;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(ecliptic));
  const ascension = Math.atan2(Math.cos(obliquity) * Math.sin(ecliptic), Math.cos(ecliptic));
  const sidereal = 280.46061837 + 360.98564736629 * n;
  return { lat: declination / RAD, lon: wrap(ascension / RAD - sidereal) };
}

/** How high the sun stands over (lon, lat), in degrees: negative below the horizon. */
export function altitude(sun: SunPoint, lon: number, lat: number): number {
  const p = lat * RAD;
  const d = sun.lat * RAD;
  return Math.asin(Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos((lon - sun.lon) * RAD)) / RAD;
}

/**
 * Where the sun is lower than `below` degrees, as one ring of longitude and latitude, packed lon0, lat0,
 * lon1, lat1, …: the cap round the point opposite the sun whose radius is 90° plus `below`.
 *
 * Its edge is walked every `step` degrees of bearing from that point, with the longitude kept
 * continuous rather than wrapped, so the ring may run past ±180° and the map draws it three times, a
 * world's width apart, clipped to the Earth's edge. A cap that holds a pole comes round with its
 * longitude 360° from where it started, and is closed along that pole, which Equal Earth draws as a
 * line. So polar day, polar night and the equinox, when the edge runs past both poles, take no special
 * case; one that would run exactly through a pole is drawn 0.02° (2 km) smaller, so it never has to be
 * decided which side of the pole a point on it is.
 */
export function nightRing(sun: SunPoint, below: number, step = 2): number[] {
  const lat0 = -sun.lat;
  const lon0 = wrap(sun.lon + 180);
  let r = 90 + below;
  for (const toPole of [90 - lat0, 90 + lat0]) if (Math.abs(toPole - r) < 0.01) r -= 0.02;
  const p0 = lat0 * RAD;
  const sinR = Math.sin(r * RAD);
  const cosR = Math.cos(r * RAD);
  const out: number[] = [];
  let last = NaN;
  for (let bearing = 0; bearing <= 360; bearing += step) {
    const b = bearing * RAD;
    const sinLat = Math.min(1, Math.max(-1, Math.sin(p0) * cosR + Math.cos(p0) * sinR * Math.cos(b)));
    let lon = lon0 + Math.atan2(Math.sin(b) * sinR * Math.cos(p0), cosR - Math.sin(p0) * sinLat) / RAD;
    if (!Number.isNaN(last)) lon = last + wrap(lon - last);
    out.push(lon, Math.asin(sinLat) / RAD);
    last = lon;
  }
  if (Math.abs(out[out.length - 2]! - out[0]!) <= 180) return out;
  /*
   * Round once in longitude: the cap holds the pole on the side the point opposite the sun is. Every
   * meridian leaves such a cap exactly once, so its edge is a latitude for each longitude: laid out
   * from −180° to 180° and closed along the pole, it is one ring whose only seam is the Earth's own
   * edge. Drawn as copies instead, two fills would meet at the sun's own meridian, and a translucent
   * fill shows where two meet.
   */
  const pole = lat0 > 0 ? 90 : -90;
  const points: [number, number][] = [];
  for (let i = 0; i < out.length - 2; i += 2) points.push([wrap(out[i]!), out[i + 1]!]);
  points.sort((a, b) => a[0] - b[0]);
  const [west, east] = [points[0]!, points[points.length - 1]!];
  const across = west[0] + 360 - east[0];
  const seam = across > 0 ? east[1] + ((west[1] - east[1]) * (180 - east[0])) / across : east[1];
  return [-180, seam, ...points.flat(), 180, seam, 180, pole, -180, pole];
}

/** The sunrise and sunset line alone, as `nightRing` walks it: the night's edge without the pole that closes it. */
export function terminator(sun: SunPoint, step = 2): number[] {
  const ring = nightRing(sun, TWILIGHT[0], step);
  const n = ring.length;
  return Math.abs(ring[n - 1]!) === 90 && Math.abs(ring[n - 3]!) === 90 ? ring.slice(0, n - 4) : ring;
}
