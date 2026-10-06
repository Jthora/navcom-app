import { describe, expect, it } from 'vitest';
import { RECAP_LINES, RECAP_SIZE, drawRecap, recapAlt, recapLines } from './recap';
import type { Patrol } from './patrol';

/**
 * The picture, asserted through a context that records what was drawn.
 *
 * Canvas has no 2D context under the test runner, and the thing worth testing is not pixels
 * anyway: it is what the card says. A recorder answers that and answers it faster.
 */
function recorder() {
  const text: string[] = [];
  const rects: number[][] = [];
  const ctx = {
    canvas: { width: RECAP_SIZE, height: RECAP_SIZE },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textBaseline: '',
    fillRect: (...a: number[]) => void rects.push(a),
    fillText: (s: string) => void text.push(s),
    measureText: (s: string) => ({ width: s.length * 18 }),
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {}
  } as unknown as CanvasRenderingContext2D;
  return { ctx, text, rects };
}

const night = (started: number, area: string, note?: string): Patrol => ({
  started,
  ended: started + 7_200,
  area,
  ...(note ? { note } : {})
});

const WORK: Patrol[] = [
  night(1_800_000_000, 'Downtown'),
  night(1_800_100_000, 'Riverside'),
  night(1_800_200_000, 'Northside', 'two handouts at the underpass')
];

describe('which nights the picture shows', () => {
  it('puts the newest first, because a stranger is asking whether this is current', () => {
    const lines = recapLines({ callsign: 'Wren', patrols: WORK });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/Northside/);
    expect(lines[2]).toMatch(/Downtown/);
  });

  it('stops where the card stops being readable', () => {
    const many = Array.from({ length: 30 }, (_, i) => night(1_800_000_000 + i * 90_000, 'Downtown'));
    expect(recapLines({ callsign: 'Wren', patrols: many })).toHaveLength(RECAP_LINES);
  });

  it("honours the area switch, because the export's switches are the operator's answer already", () => {
    const off = recapLines({ callsign: 'Wren', patrols: WORK, includeAreas: false }).join(' ');
    expect(off).not.toMatch(/Downtown|Riverside|Northside/);
  });

  it('leaves notes out unless they were asked for, which is the opposite of the default below', () => {
    /*
     * `patrolLines` treats `includeNotes` as on unless told otherwise, and the screen's switch is
     * off by default. A caller forwarding its input unchanged puts the riskiest free text in the
     * system into an image bound for a feed — which is what the first version of this file did,
     * and what the line count in the test above caught.
     */
    const quiet = recapLines({ callsign: 'Wren', patrols: WORK }).join(' ');
    expect(quiet).not.toMatch(/underpass/);
    const asked = recapLines({ callsign: 'Wren', patrols: WORK, includeNotes: true }).join(' ');
    expect(asked).toMatch(/underpass/);
  });
});

describe('the sentence that rides with it', () => {
  it('names the callsign and the nights, and nothing else', () => {
    const alt = recapAlt({ callsign: 'Wren', patrols: WORK });
    expect(alt).toMatch(/^Wren's patrol record from NavCom/);
    expect(alt).toMatch(/Northside/);
    // No invitation, no link, no claim about impact. §2 and C22.
    expect(alt).not.toMatch(/navcom\.app\/|https?:|join|download|helped/i);
  });

  it('says there are none rather than producing an empty sentence', () => {
    expect(recapAlt({ callsign: 'Wren', patrols: [] })).toMatch(/No nights recorded/);
  });
});

describe('what the card draws', () => {
  it('carries the callsign and the quiet mark', () => {
    const { ctx, text } = recorder();
    drawRecap(ctx, { callsign: 'Wren', patrols: WORK });
    expect(text[0]).toBe('Wren');
    expect(text).toContain('navcom.app');
  });

  it('draws no total, no count and no link', () => {
    /*
     * The text export has never carried a total — `patrolLines` is "the nights, one line each, with
     * no header and no total" — and C20 is provenance by name, never a count. An image is exactly
     * where a tally would get added for looking good.
     */
    const { ctx, text } = recorder();
    drawRecap(ctx, { callsign: 'Wren', patrols: WORK });
    const all = text.join(' | ');
    expect(all).not.toMatch(/total|https?:|\b\d+\s*(nights|patrols|hours total)\b/i);
  });

  it('says somebody is there even with no callsign, rather than drawing a blank', () => {
    const { ctx, text } = recorder();
    drawRecap(ctx, { callsign: null, patrols: WORK });
    expect(text[0]).toBe('An operator');
  });

  it('fills the ground first, so a transparent PNG never reaches a feed', () => {
    const { ctx, rects } = recorder();
    drawRecap(ctx, { callsign: 'Wren', patrols: WORK });
    expect(rects[0]).toEqual([0, 0, RECAP_SIZE, RECAP_SIZE]);
  });
});
