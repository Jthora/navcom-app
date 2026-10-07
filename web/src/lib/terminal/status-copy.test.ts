/**
 * What the Status screen says about a stale reading and about a watch it cannot reach, checked in
 * its source.
 *
 * A reading is aged on screen now, so a Status left open turns a held "On station" Dark once it is
 * old — including when the reason it is old is that this phone lost every relay. The panel then
 * said the relay "is still serving its last message" and "the daemon may be gone", sending
 * somebody with no signal to the watch's holder instead of to their own signal, and the paragraph
 * above it said Dark was "not a failure to connect". A phone whose clock runs fast reads a live
 * watch as old as well, so naming only the watch and the signal sent somebody looking for a fault
 * the phone's own setting would fix [audit: relay paths, review]. The phone cannot tell the causes
 * apart, so the panel names all three.
 *
 * Source rather than the built page for the reason `prose.ts` gives: the terminal is
 * client-rendered, and these panels each exist in one state. The browser tests drive those states:
 * `reachable.spec.ts` holds the stale panel's heading and its "old is treated as Dark", and
 * `unreachable-watch.spec.ts` holds that a watch on refused relays is never called none.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const STATUS = fileURLToPath(new URL('../../routes/terminal/+page.svelte', import.meta.url));
const markup = () => readFileSync(STATUS, 'utf8').replace(/<!--[\s\S]*?-->/g, '');

/** The words of one branch of the capability explanation, up to the next branch. */
function branch(condition: string): string {
  const src = markup();
  const at = src.indexOf(condition);
  expect(at, `no branch for ${condition}`).toBeGreaterThan(-1);
  const rest = src.slice(at + condition.length);
  return rest.slice(0, rest.search(/\{:else|\{\/if\}/)).replace(/\s+/g, ' ');
}

describe('a reading gone stale', () => {
  it('names the signal as a cause, and does not say the relay is still serving', () => {
    const stale = branch("watch.read.reason === 'stale'}");
    expect(stale).toMatch(/lost its relays/i);
    expect(stale).toMatch(/signal/i);
    expect(stale).not.toMatch(/still serving/i);
    expect(stale).not.toMatch(/daemon may be gone/i);
    expect(stale, 'the heading and the rule the browser test holds').toMatch(/Last word was/);
    expect(stale).toMatch(/Old is treated as Dark/);
  });

  it('names a clock set fast as a cause too, and what fixes it', () => {
    const stale = branch("watch.read.reason === 'stale'}");
    expect(stale).toMatch(/clock/i);
    expect(stale).toMatch(/automatic date and time/i);
    expect(stale, 'no closed either/or that leaves the clock out').not.toMatch(/\bEither the watch\b/);
  });

  it('is not told, above it, that Dark is never a failure to connect', () => {
    expect(markup()).not.toMatch(/not a\s+failure to connect/i);
  });
});

describe('a watch saved on relays this page will not open', () => {
  it('is not explained as no watch', () => {
    // Core's receipt for Dark opens "No watch.", so the stranded watch gets a sentence of its own.
    const src = markup();
    const receipt = src.indexOf('{capabilitySentence(s, nowS)}');
    expect(receipt, 'the receipt is still shown for every other watch').toBeGreaterThan(-1);
    const above = src.slice(0, receipt);
    const gate = above.slice(above.lastIndexOf('{#if '));
    expect(gate).toMatch(/^\{#if stranded\}/);
    expect(gate).toMatch(/cannot be reached/);
    expect(gate).not.toMatch(/\bno watch\b/i);
    expect(gate, 'it still works offline').toMatch(/works offline/);
    expect(gate).toMatch(/\{:else\}\s*<p>$/);
  });
});
