/**
 * How precisely a position may be published: the precision its method earned, and no more
 * [docs/design/map.md §0].
 *
 * Overture hands over coordinates as 32-bit floats printed at 64-bit length —
 * `33.95924377441406` — which claims a few nanometres for a place read off a website. That is
 * false precision, and it ships in every file anyone can download: the directory, and the archive
 * pinned to IPFS. So it is refused where the data is read, rather than trimmed by a renderer on
 * the way out that would leave the files saying it.
 */

/** About a metre: what a geocoded street address earns. Every coordinate in the directory today. */
export const ADDRESS_DECIMALS = 5;

/** About a kilometre: what a position placed by region earns, such as a region's centre. */
export const REGION_DECIMALS = 2;

/** `n` rounded to `decimals` places. */
export function atPrecision(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/**
 * How many decimals a coordinate written as text carries, or `null` when it is not written as a
 * plain decimal. `1e-5` is a number, but how precise it claims to be is not legible.
 */
export function decimalsOf(raw: string): number | null {
  const t = raw.trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const dot = t.indexOf('.');
  return dot === -1 ? 0 : t.length - dot - 1;
}
