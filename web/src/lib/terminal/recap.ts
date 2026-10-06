/**
 * The recap as an image, because Instagram will not take text.
 *
 * [`propagation.md`](../../../../docs/product/propagation.md) §2 sets this artifact's quality bar at
 * *"whoever has the most demanding feed"* and says plainly that visual design is the mechanism here
 * rather than decoration. The operator with that feed is the Public Face, and **Instagram's share
 * target is image-oriented: a text-only share never reaches it.** So the image is not a nicety on
 * top of `share.ts` — it is the only version of this that reaches the archetype §2 was written for.
 *
 * ## What it carries, and what it refuses
 *
 * Callsign, the nights, the areas if the operator left them on, and a quiet mark. That is §2's list
 * — *"time, place, activity, what was done, and nothing more"* — and C22's refusals hold: no team
 * size, no collective activity, no impact claim. **No total and no count**, because the text export
 * has never carried one either (C20), and no `url` drawn on it, for the reason `share.ts` gives.
 *
 * ## Drawn, not laid out in HTML
 *
 * Canvas 2D, no library, a few kilobytes of code against a budget already measured. The text export
 * travels *with* the image in the same share, so nothing here has to be truncated honestly: the
 * picture is what a feed shows and the text is the whole record.
 *
 * ## The font is a decision nobody has made
 *
 * P8 closed webfonts for the interface because a font that has not loaded is text that is not there,
 * and a reflow while somebody reaches for `Distress` moves the layout under their thumb. **Neither
 * argument reaches an image drawn after a deliberate tap** — nothing reflows and no text is missing,
 * and `FontFace` would load before the first `fillText`. Until somebody decides, this draws with the
 * system stack and the artifact looks slightly different on every phone. `FAMILY` is the one line
 * that changes.
 */

import { formatDuration, patrolLines, type ExportOptions, type Patrol } from './patrol';

/** 1080 square: what Instagram and Bluesky both take without cropping. */
export const RECAP_SIZE = 1080;

/** The one line to change if a canvas-only face is ever decided on. See the header. */
const FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const GROUND = '#141817';
const INK = '#E8EAE9';
const MUTED = '#8A9A95';
const RULE = '#2C3836';

/** How many nights fit before the card stops being readable at a thumbnail. */
export const RECAP_LINES = 7;

export interface RecapInput extends ExportOptions {
  patrols: readonly Patrol[];
}

/**
 * The lines the picture shows, newest first.
 *
 * Newest first is the opposite of the text export, deliberately: a reader scrolling past gives this
 * one second, and the most recent night is the one that answers *"is this current?"* — which is the
 * only question a stranger actually asks of a record like this.
 */
export function recapLines(input: RecapInput): string[] {
  /*
   * Notes are opt-in here, explicitly, because the default underneath is the other way.
   *
   * `patrolLines` treats `includeNotes` as on unless told otherwise, and the screen's switch is off
   * by default — so a caller that simply forwards its input puts the riskiest free text in the
   * system into an image bound for a public feed, silently. Caught by a test that counted lines,
   * which is the only reason it is not in the first build of this file.
   */
  const { lines } = patrolLines([...input.patrols], {
    ...input,
    includeNotes: input.includeNotes === true
  });
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .reverse()
    .slice(0, RECAP_LINES);
}

/**
 * One sentence describing the record. The caption, and the alt text.
 *
 * The share sheet carries no alt field, so this rides as the image share's `text` — which lands in
 * the caption box on every target worth naming, where the operator can paste it into the alt field
 * too. A multi-line record is not caption material; a sentence is, and the full record still travels
 * on the text share beside it. Worth knowing while writing it: Instagram shows alt only to a screen
 * reader, and Mastodon cannot edit alt once a post is up.
 */
export function recapAlt(input: RecapInput): string {
  const lines = recapLines(input);
  const who = input.callsign ? `${input.callsign}'s` : 'An operator\'s';
  if (lines.length === 0) return `${who} patrol record from NavCom. No nights recorded.`;
  return `${who} patrol record from NavCom, listing: ${lines.join('; ')}.`;
}

/** Wraps on measured width rather than character count, because the face is not fixed. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > max && line) {
      out.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) out.push(line);
  return out;
}

/**
 * Draws the card. Returns the context it drew on, so a caller can hand it straight to `toBlob`.
 *
 * Takes a context rather than making one: an offscreen canvas, a visible one and a test double are
 * all the same job, and a function that creates its own cannot be driven from a test.
 */
export function drawRecap(
  ctx: CanvasRenderingContext2D,
  input: RecapInput,
  size = RECAP_SIZE
): CanvasRenderingContext2D {
  const pad = Math.round(size * 0.083);
  const inner = size - pad * 2;

  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, size, size);
  ctx.textBaseline = 'top';

  // The callsign, which is the only name on it.
  ctx.fillStyle = INK;
  ctx.font = `600 ${Math.round(size * 0.058)}px ${FAMILY}`;
  ctx.fillText(input.callsign ?? 'An operator', pad, pad, inner);

  ctx.fillStyle = MUTED;
  ctx.font = `400 ${Math.round(size * 0.026)}px ${FAMILY}`;
  ctx.fillText('Patrol record', pad, pad + Math.round(size * 0.075), inner);

  ctx.strokeStyle = RULE;
  ctx.lineWidth = Math.max(1, Math.round(size * 0.002));
  const ruleY = pad + Math.round(size * 0.125);
  ctx.beginPath();
  ctx.moveTo(pad, ruleY);
  ctx.lineTo(size - pad, ruleY);
  ctx.stroke();

  // The nights. Understatement is the aesthetic, so this is a list and not a graphic.
  const body = Math.round(size * 0.031);
  ctx.font = `400 ${body}px ${FAMILY}`;
  let y = ruleY + Math.round(size * 0.045);
  const step = Math.round(body * 1.72);
  for (const line of recapLines(input)) {
    for (const part of wrap(ctx, line, inner)) {
      ctx.fillStyle = INK;
      ctx.fillText(part, pad, y, inner);
      y += step;
      if (y > size - pad - step * 2) break;
    }
    if (y > size - pad - step * 2) break;
  }

  // The quiet mark of provenance §2 asks for. Not a link, not an invitation.
  ctx.fillStyle = MUTED;
  ctx.font = `400 ${Math.round(size * 0.022)}px ${FAMILY}`;
  ctx.fillText('navcom.app', pad, size - pad - Math.round(size * 0.022), inner);

  return ctx;
}

/** Whether this phone can share a file at all. Checked with the real file, not a guess. */
export function canShareFile(file: File): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  if (typeof navigator.canShare !== 'function') return false;
  return navigator.canShare({ files: [file] });
}

/** A filename a person can find again. No callsign in it — this lands in shared folders. */
export const RECAP_FILENAME = 'patrol-record.png';

export { formatDuration };
