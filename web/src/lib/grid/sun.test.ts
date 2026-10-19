/**
 * Where the sun is overhead, and where it is night, worked out on the phone from its own clock
 * [docs/design/map.md, Day and night].
 *
 * Checked against two other methods rather than against itself. Meeus's higher-accuracy one
 * (*Astronomical Algorithms*, ch. 25: the equation of centre to its third term, nutation and the
 * aberration), which `sun.ts` must agree with to 0.02°, about 2 km. And Spencer's Fourier series (1971)
 * for the declination and the equation of time, which shares no formula with either and is coarser,
 * fitted to one epoch: held to 0.5°, it catches a sign or a unit gone wrong, which a second method
 * built the same way could share.
 */

import { describe, expect, it } from 'vitest';
import { TWILIGHT, altitude, nightRing, subsolar, terminator, type SunPoint } from './sun';

const RAD = Math.PI / 180;

/** Spencer (1971): declination in degrees and the equation of time in minutes, from the day of the year. */
function spencer(ms: number): SunPoint {
  const d = new Date(ms);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const hours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const day = Math.floor((ms - start) / 86_400_000) + 1;
  const g = ((2 * Math.PI) / 365) * (day - 1 + (hours - 12) / 24);
  const decl =
    0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  let lon = -15 * (hours - 12 + eot / 60);
  lon -= 360 * Math.round(lon / 360);
  return { lat: decl / RAD, lon };
}

/** Whether (lon, lat) is inside a ring, at any of the three copies the map draws it at. */
function holds(ring: number[], lon: number, lat: number): boolean {
  return [-360, 0, 360].some((k) => {
    let c = false;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const xi = ring[i]! + k, yi = ring[i + 1]!, xj = ring[j]! + k, yj = ring[j + 1]!;
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  });
}

/** Meeus, ch. 25, from the Julian centuries since J2000.0. */
function meeus(ms: number): SunPoint {
  const jd = ms / 86_400_000 + 2440587.5;
  const t = (jd - 2451545.0) / 36525;
  const l0 = 280.46646 + 36000.76983 * t + 0.0003032 * t * t;
  const m = (357.52911 + 35999.05029 * t - 0.0001537 * t * t) * RAD;
  const c = (1.914602 - 0.004817 * t - 0.000014 * t * t) * Math.sin(m) + (0.019993 - 0.000101 * t) * Math.sin(2 * m) + 0.000289 * Math.sin(3 * m);
  const omega = (125.04 - 1934.136 * t) * RAD;
  const lambda = (l0 + c - 0.00569 - 0.00478 * Math.sin(omega)) * RAD;
  const eps = (23 + (26 + (21.448 - 46.815 * t - 0.00059 * t * t + 0.001813 * t * t * t) / 60) / 60 + 0.00256 * Math.cos(omega)) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / RAD;
  const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * t * t;
  let lon = ra - gmst;
  lon -= 360 * Math.round(lon / 360);
  return { lat: Math.asin(Math.sin(eps) * Math.sin(lambda)) / RAD, lon };
}

const near = (a: number, b: number, within: number) => {
  let d = a - b;
  d -= 360 * Math.round(d / 360);
  return Math.abs(d) <= within;
};

describe('the sun, from the phone’s clock alone', () => {
  it('is overhead at the tropics at the 2026 solstices and over the equator at its equinox', () => {
    // The instants as published for 2026, to the minute.
    expect(subsolar(Date.UTC(2026, 2, 20, 14, 46)).lat).toBeCloseTo(0, 0);
    expect(Math.abs(subsolar(Date.UTC(2026, 2, 20, 14, 46)).lat)).toBeLessThan(0.3);
    expect(subsolar(Date.UTC(2026, 5, 21, 8, 24)).lat).toBeGreaterThan(23.44 - 0.3);
    expect(subsolar(Date.UTC(2026, 5, 21, 8, 24)).lat).toBeLessThan(23.44 + 0.3);
    expect(subsolar(Date.UTC(2026, 11, 21, 20, 50)).lat).toBeLessThan(-23.44 + 0.3);
    expect(subsolar(Date.UTC(2026, 11, 21, 20, 50)).lat).toBeGreaterThan(-23.44 - 0.3);
  });

  it('agrees with Meeus to 0.02°, and with Spencer’s series to 0.5°, all year and all day, three years running', () => {
    for (let day = 0; day < 3 * 365; day += 5) {
      for (const hour of [0, 5.5, 12, 14.0833, 23.75]) {
        const ms = Date.UTC(2026, 0, 1) + day * 86_400_000 + hour * 3_600_000;
        const a = subsolar(ms);
        const at = new Date(ms).toISOString();
        const fine = meeus(ms);
        expect(Math.abs(a.lat - fine.lat), `${at} latitude, against Meeus`).toBeLessThan(0.02);
        expect(near(a.lon, fine.lon, 0.02), `${at} longitude ${a.lon} against Meeus’s ${fine.lon}`).toBe(true);
        const coarse = spencer(ms);
        expect(Math.abs(a.lat - coarse.lat), `${at} latitude, against Spencer`).toBeLessThan(0.5);
        expect(near(a.lon, coarse.lon, 0.5), `${at} longitude ${a.lon} against Spencer’s ${coarse.lon}`).toBe(true);
      }
    }
  });

  it('keeps the midnight sun over Tromsø and polar night over McMurdo at 22:00 UTC on 21 June', () => {
    const sun = subsolar(Date.UTC(2026, 5, 21, 22, 0));
    expect(altitude(sun, 18.96, 69.65), 'Tromsø').toBeGreaterThan(0);
    expect(altitude(sun, 166.67, -77.85), 'McMurdo').toBeLessThan(-6);
    // And in December the other way round.
    const dec = subsolar(Date.UTC(2026, 11, 21, 22, 0));
    expect(altitude(dec, 18.96, 69.65), 'Tromsø in December').toBeLessThan(-0.833);
    expect(altitude(dec, 166.67, -77.85), 'McMurdo in December').toBeGreaterThan(0);
  });
});

describe('where it is night', () => {
  const finiteAndClosed = (ring: number[]) => {
    expect(ring.length).toBeGreaterThan(100);
    expect(ring.every(Number.isFinite)).toBe(true);
  };

  it('is a cap round the point opposite the sun, holding the pole in its winter and not the other', () => {
    for (const [ms, dark, lit] of [
      [Date.UTC(2026, 5, 21, 22, 0), -89.5, 89.5],
      [Date.UTC(2026, 11, 21, 22, 0), 89.5, -89.5]
    ] as const) {
      const sun = subsolar(ms);
      for (const h of TWILIGHT) {
        const ring = nightRing(sun, h);
        finiteAndClosed(ring);
        expect(holds(ring, 0, dark), `the dark pole, sun below ${h}°`).toBe(true);
        expect(holds(ring, 0, lit), `the lit pole, sun below ${h}°`).toBe(false);
        expect(holds(ring, sun.lon + 180, -sun.lat), 'the point opposite the sun').toBe(true);
        expect(holds(ring, sun.lon, sun.lat), 'the point under the sun').toBe(false);
      }
    }
    const june = subsolar(Date.UTC(2026, 5, 21, 22, 0));
    expect(holds(nightRing(june, -0.833), 18.96, 69.65), 'Tromsø, under the midnight sun').toBe(false);
    expect(holds(nightRing(june, -0.833), 166.67, -77.85), 'McMurdo, in polar night').toBe(true);
  });

  it('holds at the equinox, when its edge runs past both poles, and when it runs exactly through one', () => {
    for (const lat of [0, 0.2, -0.2, 0.833, -0.833, 6, -12]) {
      for (const h of TWILIGHT) {
        const sun = { lat, lon: 15 };
        const ring = nightRing(sun, h);
        finiteAndClosed(ring);
        expect(holds(ring, -165, -lat), `opposite the sun at ${lat}°, below ${h}°`).toBe(true);
        expect(holds(ring, 15, lat), `under the sun at ${lat}°, below ${h}°`).toBe(false);
        // Near both poles, where the edge passes closest: each side as the sun's altitude says.
        for (const [lon, pole] of [[15, 89.6], [-165, 89.6], [15, -89.6], [-165, -89.6]] as const) {
          const alt = altitude(sun, lon, pole);
          if (Math.abs(alt - h) > 0.05) expect(holds(ring, lon, pole), `${lon},${pole} at ${alt.toFixed(2)}°, sun at ${lat}°, below ${h}°`).toBe(alt < h);
        }
      }
    }
  });

  it('agrees with the sun’s own altitude everywhere on a 5° grid, a degree from its edge either way', () => {
    for (const ms of [Date.UTC(2026, 2, 20, 14, 46), Date.UTC(2026, 5, 21, 8, 24), Date.UTC(2026, 9, 19, 14, 5)]) {
      const sun = subsolar(ms);
      for (const h of TWILIGHT) {
        const ring = nightRing(sun, h);
        for (let lat = -87.5; lat <= 87.5; lat += 5) {
          for (let lon = -177.5; lon <= 177.5; lon += 5) {
            const alt = altitude(sun, lon, lat);
            if (Math.abs(alt - h) < 1) continue;
            expect(holds(ring, lon, lat), `${lon},${lat} at ${alt.toFixed(1)}° against ${h}°`).toBe(alt < h);
          }
        }
      }
    }
  });
});

describe('the line where the sun rises and sets', () => {
  it('is where the sun stands at −0.833°, open, and never runs along a pole', () => {
    for (const ms of [Date.UTC(2026, 2, 20, 14, 46), Date.UTC(2026, 5, 21, 22, 0), Date.UTC(2026, 9, 19, 14, 5), Date.UTC(2026, 11, 21, 20, 50)]) {
      const sun = subsolar(ms);
      const line = terminator(sun);
      expect(line.length).toBeGreaterThan(300);
      for (let i = 0; i < line.length; i += 2) {
        expect(Math.abs(line[i + 1]!), 'a point of the line on a pole').toBeLessThan(90);
        // Its sampled points exactly; the two it adds where it meets the Earth's edge, to a chord's error.
        const off = Math.abs(altitude(sun, line[i]!, line[i + 1]!) - TWILIGHT[0]);
        expect(off, `${line[i]},${line[i + 1]}`).toBeLessThan(Math.abs(line[i]!) === 180 ? 0.5 : 1e-6);
      }
    }
  });
});
