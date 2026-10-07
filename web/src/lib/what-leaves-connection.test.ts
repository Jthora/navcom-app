/**
 * What a relay carrying a phone's one connection can see, said the way the code behaves.
 *
 * `what-leaves.md` corrected itself to say a relay sees one phone's traffic arrive together, and
 * kept, under what a relay *cannot* see, the peers that traffic names; it called the presence
 * sender unlinkable without saying to whom; it said a squad looks like a single holder on the wire
 * while the key-bundle request named every holder; and it pointed at keeping a correction and a
 * `Distress` on different relays, which no setting does [audit: relay paths, review]. Corrected,
 * it still said nobody reading a relay could link two of your messages, a paragraph above the line
 * saying they can group one heartbeat's wraps by their shared timestamp; and it put "everything
 * else this phone sends" on a watch's relays, where a claim sealed to a mission's poster never goes
 * [audit: relay paths, review of the fix]. A security page that contradicts itself is the
 * overclaim this project has been caught by before.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DOC = fileURLToPath(new URL('../../../docs/product/what-leaves.md', import.meta.url));
const page = () => readFileSync(DOC, 'utf8');
const canSee = () => page().split('**They can see:**')[1]!.split('**They cannot see:**')[0]!;
const cannotSee = () => page().split('**They cannot see:**')[1]!.split('\n## ')[0]!;
const throwawayRow = () => page().split('\n').find((l) => l.startsWith('| **Throwaway**')) ?? '';
const separation = () => page().split('**What the separation does not hide**')[1]?.split('\n## ')[0] ?? '';

describe('what a relay operator can see over one connection per phone', () => {
  it('finds both lists, so the checks below are not passing on nothing', () => {
    expect(canSee().length).toBeGreaterThan(200);
    expect(cannotSee().length).toBeGreaterThan(20);
    expect(throwawayRow().length).toBeGreaterThan(50);
    expect(separation().length).toBeGreaterThan(200);
  });

  it('counts your peers among what a relay can see, not what it cannot', () => {
    expect(cannotSee()).not.toMatch(/peers/i);
    expect(canSee()).toMatch(/which peers you have/i);
  });

  it('says whom the throwaway key hides you from, and whom it does not', () => {
    expect(page()).not.toMatch(/The sender is unlinkable;/);
    expect(page()).not.toMatch(/unlinkable to anyone but their recipients/);
    expect(canSee()).toMatch(/not from the relay carrying/i);
  });

  it('says the watch’s own relays can see who holds it, and that no other relay is asked', () => {
    // pq.svelte.ts asks for the watch's and its holders' key bundles on the watch's relays only.
    expect(page()).not.toMatch(/same shape\s+on the wire/i);
    expect(canSee()).toMatch(/goes only to the watch's own\s+relays/i);
    expect(cannotSee()).toMatch(/unless they are one of its relays/i);
  });

  it('offers no way of keeping the two keys apart that the app does not have', () => {
    expect(page()).not.toMatch(/keep them on different relays/i);
    expect(page()).toMatch(/No setting keeps them apart/);
  });

  it('claims nothing for the throwaway key that the list of what a relay can see takes back', () => {
    // core presence.ts stamps every wrap of one beat with the same created_at.
    expect(canSee()).toMatch(/same\s+timestamp/i);
    expect(throwawayRow()).not.toMatch(/can link two|cannot link|unlinkable/i);
    expect(throwawayRow()).toMatch(/same timestamp/i);
  });

  it('does not put on a watch’s relays what is sealed to a mission’s poster', () => {
    // missions/claims.ts and reports.ts send a sealed claim or report to the poster's inbox only.
    expect(separation()).not.toMatch(/everything else this phone\s+sends/i);
    expect(separation()).toMatch(/except\s+what\s+you\s+seal\s+to\s+a\s+mission's\s+poster/i);
  });
});
