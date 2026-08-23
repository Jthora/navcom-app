/**
 * The panel's rules, held down.
 *
 * Two of these are safety-critical rather than stylistic: a countdown that is wrong when
 * animation is off, and a Distress bar that ever completes.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  READOUT_WORD_LIMIT,
  elapsedLabel,
  elapsedState,
  isOverlong,
  wordCount,
  windowState
} from './panel';

describe('rule 2 — a readout fits in five words', () => {
  it('counts words the way a person would', () => {
    expect(wordCount('Dark')).toBe(1);
    expect(wordCount('No addressee')).toBe(2);
    expect(wordCount('  Raven   ·  sole  ')).toBe(2); // the separator is not a word
    expect(wordCount('')).toBe(0);
  });

  it('passes the real readouts the doctrine drafted', () => {
    for (const v of [
      'Dark',
      'No addressee',
      'No contact',
      'Not sent',
      'Not vouched',
      'Still advertised',
      'Automated',
      'Passed 6d',
      'Ready · offline'
    ]) {
      expect(isOverlong(v), v).toBe(false);
    }
  });

  it('catches a sentence that has wandered into a slot', () => {
    // This is what it is for. The failure mode is not a long word, it is prose creeping back
    // into a readout one edit at a time.
    expect(isOverlong('No watch is on station right now')).toBe(true);
    expect(READOUT_WORD_LIMIT).toBe(5);
  });
});

describe('a response window', () => {
  const SENT = 1_800_000_000;

  it('is correct at the moment it was sent', () => {
    const w = windowState(SENT, 120, SENT);
    expect(w.fraction).toBe(0);
    expect(w.remaining).toBe(120);
    expect(w.expired).toBe(false);
  });

  it('carries the right fraction part-way through, with no animation running', () => {
    /*
     * The important one. Under `prefers-reduced-motion` this project disables every animation
     * outright, so a bar that only became correct once its keyframe ran would show **zero
     * elapsed** to exactly the people who turned motion off.
     *
     * The fraction is rendered as a static transform first; the animation, when it runs, only
     * continues from there.
     */
    const w = windowState(SENT, 120, SENT + 30);
    expect(w.fraction).toBeCloseTo(0.25);
    expect(w.remaining).toBe(90);
  });

  it('seeds a CSS animation to resume where it actually is', () => {
    // A negative delay starts a keyframe part-way through, which is what makes this one
    // declaration rather than a timer repainting all night.
    expect(windowState(SENT, 120, SENT + 30).delay).toBe(-30);
    expect(windowState(SENT, 120, SENT).delay).toBe(-0);
  });

  it('clamps rather than running past the end', () => {
    const w = windowState(SENT, 60, SENT + 600);
    expect(w.fraction).toBe(1);
    expect(w.remaining).toBe(0);
    expect(w.expired).toBe(true);
    expect(w.delay).toBe(-60);
  });

  it('survives a clock that has gone backwards', () => {
    // Phones correct their clocks. A negative elapsed must not render a bar running the wrong
    // way, and it must not report more time than the window holds.
    const w = windowState(SENT, 120, SENT - 500);
    expect(w.fraction).toBe(0);
    expect(w.remaining).toBe(120);
    expect(w.expired).toBe(false);
  });
});

describe('a Distress, which has no window', () => {
  const RAISED = 1_800_000_000;

  it('never completes, however long nobody answers', () => {
    /*
     * `RESPONSE_WINDOW` has one null in it and this is why it matters visually. A bar that
     * fills and stops says the signal resolved itself. Nothing resolves a Distress except a
     * human ending it, so the bar has to keep climbing and never arrive.
     */
    for (const minutes of [1, 5, 30, 120, 60 * 24]) {
      const { fraction } = elapsedState(RAISED, RAISED + minutes * 60);
      expect(fraction, `${minutes}m`).toBeLessThan(1);
      expect(fraction, `${minutes}m`).toBeGreaterThan(0);
    }
  });

  it('always rises — later is never smaller than earlier', () => {
    let last = -1;
    for (let s = 0; s < 7200; s += 37) {
      const { fraction } = elapsedState(RAISED, RAISED + s);
      expect(fraction).toBeGreaterThanOrEqual(last);
      last = fraction;
    }
  });

  it('labels the time in something a person can read at a glance', () => {
    expect(elapsedLabel(0)).toBe('0s');
    expect(elapsedLabel(41)).toBe('41s');
    expect(elapsedLabel(161)).toBe('2m 41s');
    expect(elapsedLabel(3840)).toBe('1h 04m');
    // Padded so a column of them lines up, which is rule 8.
    expect(elapsedLabel(3601)).toBe('1h 00m');
  });

  it('reads zero rather than negative when the clock is behind', () => {
    expect(elapsedState(RAISED, RAISED - 90).seconds).toBe(0);
    expect(elapsedLabel(-5)).toBe('0s');
  });
});

describe('the panel stylesheet cannot collide with a screen', () => {
  /*
   * Written after it happened.
   *
   * The first draft used `.panel`, `.slot`, `.act`, `.bar`. **`.act` already exists on ten
   * screens** — `<section class="act">` is the standard section wrapper — so a stylesheet for
   * one converted block restyled a third of the application. `text-transform: uppercase`
   * reached a `<pre>` holding a watch key, `innerText` respects text-transform, and nineteen
   * browser tests failed at once on a hex string coming back in capitals.
   *
   * The rule is now cheap to hold, so it is held here rather than remembered.
   */
  const raw = readFileSync(new URL('./panel.css', import.meta.url), 'utf8');
  // Comments name the very classes this file exists to forbid, plus file extensions like
  // `.css` and `.md`. Scanning them found nine offenders that do not exist.
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

  it('prefixes every class it defines', () => {
    const classes = [...css.matchAll(/\.([a-zA-Z][\w-]*)/g)]
      .map((m) => m[1])
      .filter((c) => c !== 'terminal');
    const bare = [...new Set(classes)].filter((c) => !c.startsWith('nc-'));
    expect(bare, `unprefixed selectors in panel.css: ${bare.join(', ')}`).toEqual([]);
  });

  it('names its keyframes so they cannot be overwritten either', () => {
    const frames = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) expect(f, f).toMatch(/^nc-/);
  });
});
