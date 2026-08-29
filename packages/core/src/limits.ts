/**
 * How long anything is allowed to be, in one place.
 *
 * ## Why these live in core rather than on the inputs
 *
 * A `maxlength` on a textarea stops the operator who typed it and nobody else. Everything
 * here arrives from somewhere: a relay serving whatever it likes, a restored backup, a
 * hand-rolled client, a correction written by somebody running a fork. The cap has to be at
 * the boundary that every client shares, or it is decoration.
 *
 * Found by audit rather than by failure: `doing` and an invite `note` had caps because
 * somebody happened to put `maxlength` on those two textareas. **Signal text, correction
 * values and callsigns had none at all** — so a single crafted correction could carry a
 * megabyte onto every device that cached that area, and a callsign could be long enough to
 * make somebody else's screen unusable.
 *
 * ## What the numbers mean
 *
 * Generous for a person, hostile to a payload. None of these is a stylistic preference —
 * each one is the point past which a string stops being something somebody typed and starts
 * being something being done to a reader.
 */

/**
 * A callsign.
 *
 * It appears on other people's screens — a board, a peer list, a corrected field, a watch
 * state — so an unbounded one is a layout attack on somebody else's phone. Long enough for
 * any real handle in any script.
 */
export const CALLSIGN_MAX = 48;

/**
 * Anything an operator types into a signal: a query, an assist, a `Distress`, a resupply.
 *
 * Long enough to describe a situation, short enough that it cannot be used to flood a
 * watch's board or a relay. A `Distress` is included deliberately — somebody in trouble is
 * not writing an essay, and a cap that would ever truncate a real one would be far lower
 * than this.
 */
export const TEXT_MAX = 2000;

/**
 * A coarse area — *"North Riverfront"*, never an address.
 *
 * It rides on every signal an operator sends and lands on whoever holds the board, so it is
 * bounded for the same reason a callsign is. Missed in the first cap pass, which capped
 * `text` and walked past the field beside it: a `Distress` carries both, and only one of
 * them was checked.
 */
export const AREA_MAX = 120;

/**
 * One field's worth of a directory correction.
 *
 * Every device that carries that area caches every correction about it, so this is the one
 * that most directly costs somebody else's storage. Hours, a phone number and an intake rule
 * all fit several times over.
 */
export const VALUE_MAX = 200;

/**
 * The most fields one correction may assert at once.
 *
 * A correction is what somebody learned at a door, not a re-import of the record. Somebody
 * with more to say than this is doing the maintainer's job and should be, deliberately, in
 * the maintainer's path instead.
 */
export const FIELDS_MAX = 12;

/**
 * How many holders a sealed message can be wrapped for.
 *
 * A box has one; a squad with no box is described everywhere else in this project as a
 * handful of phones. Found missing by audit — every other list-shaped input here has a cap,
 * and the holder list, which rides on every signal a squad sends, did not. Generous over any
 * real squad, hostile to a relay learning group size from an unbounded wrap count.
 */
export const HOLDERS_MAX = 32;

/** Trimmed, and within its cap. The check every boundary makes. */
export const withinLimit = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
