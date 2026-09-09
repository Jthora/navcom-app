/**
 * Geohash, encoding only.
 *
 * `observation.ts` has always been able to *check* that a coarse area is exactly four
 * characters. Nothing could produce one, so an observation could be validated and never
 * built — the shape of gap this project keeps finding, one layer down from a control nobody
 * can reach.
 *
 * ## Why encode and never decode
 *
 * Decoding turns a geohash back into a box on the earth, which is the operation an analysis
 * layer wants and NavCom does not. Publishing a coarse cell is a deliberate loss of precision;
 * a decoder beside it invites somebody to reverse it into a centre point and treat that as a
 * position. Starcom may decode. We produce.
 *
 * ## The precision claim lives in the character count
 *
 * Four characters is ±20 km, and `AREA_GEOHASH_CHARS` is normative for exactly that reason —
 * an earlier draft of the spec disagreed with its own example by a factor of eight. This
 * module takes the count as an argument rather than assuming it, so the one place that
 * decides precision stays the one place that decides precision.
 */

/** The geohash alphabet: base-32 with `a`, `i`, `l` and `o` removed. */
const ALPHABET = '0123456789bcdefghjkmnpqrstuvwxyz';

export class GeohashError extends Error {}

/**
 * A geohash of exactly `chars` characters.
 *
 * Throws on a coordinate that is not one, rather than returning a hash of nonsense — a
 * silently wrong cell is a position claim about somewhere nobody is, and this runs on values
 * that came from a CSV somebody typed.
 */
export function geohash(lat: number, lon: number, chars: number): string {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new GeohashError('Latitude is not a latitude.');
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new GeohashError('Longitude is not a longitude.');
  }
  if (!Number.isInteger(chars) || chars < 1 || chars > 12) {
    throw new GeohashError('A geohash is between 1 and 12 characters.');
  }

  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;

  let out = '';
  let bit = 0;
  let value = 0;
  // Longitude first, then alternating -- the interleave is the whole encoding.
  let even = true;

  while (out.length < chars) {
    if (even) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) {
        value = (value << 1) + 1;
        lonMin = mid;
      } else {
        value = value << 1;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        value = (value << 1) + 1;
        latMin = mid;
      } else {
        value = value << 1;
        latMax = mid;
      }
    }
    even = !even;

    if (++bit === 5) {
      out += ALPHABET[value];
      bit = 0;
      value = 0;
    }
  }
  return out;
}
