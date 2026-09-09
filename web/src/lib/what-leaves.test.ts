/**
 * `docs/product/what-leaves.md` is a security claim, so it is checked rather than trusted.
 *
 * A document telling an operator what their phone emits is worth exactly as much as its
 * accuracy, and it is the kind of document that goes quietly wrong: a kind number changes, a
 * key is swapped, something starts being published that used to be handed over — and the page
 * still reads beautifully. `verification.md` calls that class **unmoored**: a sentence with
 * nothing behind it.
 *
 * Not every claim in the page is mechanically checkable. These are, and they are the two that
 * would rot first.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  KIND_CARD,
  KIND_CLAIM,
  KIND_CORRECTION,
  KIND_CREDENTIAL,
  KIND_DISTRESS,
  KIND_INVITE,
  KIND_OBSERVATION,
  KIND_KEY_BUNDLE,
  KIND_PEER_PRESENCE,
  KIND_PLACE,
  KIND_PUBLIC_PRESENCE,
  KIND_RESPONSE,
  KIND_REVOCATION,
  KIND_SIGNAL,
  KIND_WATCH_STATE
} from '@navcom/core';

const DOC = fileURLToPath(new URL('../../../docs/product/what-leaves.md', import.meta.url));
const page = () => readFileSync(DOC, 'utf8');

describe('what the page says leaves', () => {
  it('names every kind by the number the code actually uses', () => {
    // A table of wire kinds is the part most likely to drift, and the part a reader is least
    // able to check for themselves.
    const listed: [string, number][] = [
      ['Signal', KIND_SIGNAL],
      ['Distress', KIND_DISTRESS],
      ['Peer presence', KIND_PEER_PRESENCE],
      ['Invite', KIND_INVITE],
      ['Card', KIND_CARD],
      ['Observation', KIND_OBSERVATION],
      ['Public presence', KIND_PUBLIC_PRESENCE],
      ['Correction', KIND_CORRECTION],
      ['Place', KIND_PLACE],
      ['Revocation', KIND_REVOCATION],
      ['Watch state', KIND_WATCH_STATE],
      ['Response', KIND_RESPONSE]
    ];
    const text = page();
    for (const [name, kind] of listed) {
      expect(text, `${name} is listed with a kind the code does not use`).toContain(`${kind}`);
    }
  });

  it('names the two kinds it says are never published', () => {
    // The claim is load-bearing: it is why no graph of who vouched for whom exists.
    const text = page();
    expect(text).toContain(`${KIND_CREDENTIAL}`);
    expect(text).toContain(`${KIND_CLAIM}`);
    expect(text).toMatch(/never published/i);
  });

  it('lists the key bundle, which the first draft of the page left out', () => {
    /*
     * Found by writing this test rather than by reading the page.
     *
     * `pq.svelte.ts` publishes a `10912` signed with the **operational** key, so it is one of
     * only two routine things that put that key on a relay in the clear. The first draft of
     * the page had a table of everything that leaves and no row for it — an omission that
     * makes a security document read as more complete than it is, which is worse than a
     * document that admits a gap.
     */
    expect(KIND_KEY_BUNDLE).toBe(10912);
    expect(page(), 'the key bundle has no row in the table').toMatch(/key bundle/i);
    expect(page(), 'the page must say which key signs it').toMatch(
      /key bundle.*\|.*Operational/i
    );
  });
});

describe('credentials really are never published', () => {
  it('has no publish call for a credential or a claim anywhere in the client', () => {
    /*
     * A source-level check, in the shape `separation.test.ts` already uses for the executor.
     * The property is architectural rather than incidental: `endorsement.ts` says a credential
     * is *"handed to somebody however the two of them already talk"*, and the moment one is
     * published the bearer model becomes a queryable graph.
     */
    const modules = import.meta.glob('./terminal/*.ts', { eager: true, query: '?raw', import: 'default' });
    // Make silence fail. A glob that matches nothing passes this test beautifully, which is
    // the exact shape of guard `rendered.test.ts` counts its way out of.
    expect(Object.keys(modules).length, 'the glob matched no modules').toBeGreaterThan(20);
    const offenders: string[] = [];
    for (const [path, src] of Object.entries(modules as Record<string, string>)) {
      if (path.includes('.test.')) continue;
      // A publish call in the same module that names either kind. Deliberately blunt: this is
      // a smoke alarm, not a type system, and a false positive is a conversation worth having.
      if (/publish\(/.test(src) && /KIND_CREDENTIAL|KIND_CLAIM/.test(src)) offenders.push(path);
    }
    expect(offenders, 'a credential or claim is being published').toEqual([]);
  });
});

describe('the card row is derived from what a card actually emits', () => {
  /**
   * What every clear-text tag on a card means, in words the page has to contain.
   *
   * This is the guard that was missing. The page said a card's clear text was **Region**,
   * and stayed saying it while `buildCard` learned to publish activity terms and social
   * handles — the single most deanonymising thing in this system, undocumented on the page
   * that exists to document exactly this. The test above passed throughout, because it
   * checks the kind *numbers* in the table and not the column beside them.
   *
   * `declined.md` refuses to audit what is findable about a persona on the open internet,
   * and offers this page as the honest half it can do. A wrong page is worse than a missing
   * one: it is the overclaim shape this project has already been caught by once.
   */
  const TAG_MEANS: Record<string, string> = {
    d: 'Region',
    t: 'what you do',
    i: 'where else to find you'
  };

  const cardRow = () => page().split('\n').find((l) => l.startsWith('| Your card |'))!;

  it('emits only tags this page explains', async () => {
    const { generateSecretKey } = await import('nostr-tools/pure');
    const { buildCard, DOES, PLATFORMS } = await import('@navcom/core');

    // Everything a card can carry at once, so a new tag type cannot slip past unlisted.
    const event = buildCard(
      generateSecretKey(),
      { callsign: 'Wren', region: 'st-louis', doing: 'Water and socks.', lightning: 'w@getalby.com' },
      1_755_300_000,
      {
        visibility: 'board',
        does: DOES.map((d) => d.id),
        links: PLATFORMS.map((p) => ({
          platform: p.id,
          handle: p.at === 'instance' ? 'example.social/wren' : p.at === 'origin' ? 'wren.example' : 'wren'
        }))
      }
    );

    const names = [...new Set(event.tags.map((t) => t[0]!))].sort();
    expect(names.length, 'a card emitted no tags at all').toBeGreaterThan(0);

    const undocumented = names.filter((n) => !(n in TAG_MEANS));
    expect(
      undocumented,
      `a card emits ${undocumented.join(', ')} and this test has no phrase for it — ` +
        'decide what it means to a reader, put it on the page, and add it here'
    ).toEqual([]);

    const row = cardRow();
    for (const name of names) {
      expect(row, `the card row does not mention what the "${name}" tag carries`).toContain(
        TAG_MEANS[name]!
      );
    }
  });

  it('says a handle is the one thing that bridges a persona to a named account', async () => {
    // The capability, stated where a relay operator's capabilities are stated. Not buried in
    // the card row, because it is a different kind of claim from "region is visible".
    const text = page();
    expect(text).toMatch(/social handle on your card/i);
    expect(text).toMatch(/callsign-to-account map|bridges a persona/i);
    expect(text, 'the page must say it cannot be recalled').toMatch(/cannot be recalled|relays keep what they were given/i);
  });

  it('still says a card seals nothing, because that has not changed', () => {
    expect(cardRow()).toMatch(/a card is public by definition/i);
  });
});
