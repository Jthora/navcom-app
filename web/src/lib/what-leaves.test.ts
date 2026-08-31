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
