/**
 * The handle proof, which is the only thing on a card anybody can actually check.
 *
 * Everything else a card carries is its holder's word. This is the one claim that can be
 * disproven, so the tests that matter are the ones where it is false rather than absent.
 */

import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import {
  PROOF_PHRASE,
  canProve,
  checkProof,
  proofRequest,
  proofStatement,
  type CardLink
} from '../src/index.js';

const key = getPublicKey(generateSecretKey());
const other = getPublicKey(generateSecretKey());
const npub = npubEncode(key);

const gh = (over: Partial<CardLink> = {}): CardLink => ({
  platform: 'github',
  handle: 'raven',
  proof: 'a1b2c3d4e5f6',
  ...over
});
const masto = (over: Partial<CardLink> = {}): CardLink => ({
  platform: 'mastodon',
  handle: 'bitcoinhackers.org/raven',
  proof: '109775066355589974',
  ...over
});

const gist = (content: string, owner = 'raven') => ({
  owner: { login: owner },
  files: { 'nostr.md': { content } }
});
const post = (content: string, username = 'raven') => ({
  account: { username, acct: username },
  content
});

describe('the statement an operator publishes', () => {
  it('names the key in the form NIP-39 uses, not the hex a relay uses', () => {
    // A proof written with the hex key would not match what every other client looks for, and
    // the operator would have published something that proves nothing anywhere else.
    expect(proofStatement(key)).toContain(npub);
    expect(proofStatement(key)).not.toContain(key);
    expect(proofStatement(key).startsWith(PROOF_PHRASE)).toBe(true);
  });
});

describe('where a reader would look', () => {
  it("asks the platform's own JSON endpoint, and offers the page a person can read", () => {
    const r = proofRequest(gh());
    expect(r?.url).toBe('https://api.github.com/gists/a1b2c3d4e5f6');
    expect(r?.human).toBe('https://gist.github.com/raven/a1b2c3d4e5f6');
  });

  it('builds a Mastodon status URL from the instance half of the handle', () => {
    expect(proofRequest(masto())?.url).toBe(
      'https://bitcoinhackers.org/api/v1/statuses/109775066355589974'
    );
  });

  it('refuses an instance that is not a host, because it is spliced into the authority', () => {
    // The same failure `links.ts` found with a subdomain handle: anything admitted here that is
    // not a DNS label builds a URL pointing at a different origin.
    expect(proofRequest(masto({ handle: 'evil.com/path/@x/raven' }))).toBeNull();
    expect(proofRequest(masto({ handle: 'nostr.social:8080/raven' }))).toBeNull();
  });

  it('fetches nothing for a platform with no public check, or a malformed pointer', () => {
    expect(proofRequest({ platform: 'x', handle: 'raven', proof: '12345' })).toBeNull();
    expect(proofRequest(gh({ proof: 'not a gist id' }))).toBeNull();
    expect(proofRequest(gh({ proof: undefined }))).toBeNull();
    expect(canProve('x')).toBe(false);
    expect(canProve('github')).toBe(true);
  });
});

describe('a proof that holds', () => {
  it('reads as proven when the owner and the key both match', () => {
    const r = checkProof(gh(), key, gist(`${PROOF_PHRASE}: ${npub}`));
    expect(r.state).toBe('proven');
    expect(r.readout).toBe('Proven');
  });

  it('accepts the quoted form, since the specification uses both', () => {
    const r = checkProof(masto(), key, post(`<p>${PROOF_PHRASE}: &quot;${npub}&quot;</p>`));
    expect(r.state).toBe('proven');
  });

  it('reads through the HTML a Mastodon post is served as', () => {
    const r = checkProof(masto(), key, post(`<p>${PROOF_PHRASE}:</p><p><span>${npub}</span></p>`));
    expect(r.state).toBe('proven');
  });

  it('matches a local account whose acct carries no domain', () => {
    const r = checkProof(masto(), key, post(`${PROOF_PHRASE}: ${npub}`, 'raven'));
    expect(r.state).toBe('proven');
  });
});

describe('a proof that does not', () => {
  it('refutes a gist somebody else wrote, even when it names this key', () => {
    // The obvious forgery: point at a real proof belonging to another account.
    const r = checkProof(gh(), key, gist(`${PROOF_PHRASE}: ${npub}`, 'someone-else'));
    expect(r.state).toBe('refuted');
    expect(r.reason).toContain('someone-else');
  });

  it('refutes a real proof for a different key', () => {
    const r = checkProof(gh(), key, gist(`${PROOF_PHRASE}: ${npubEncode(other)}`));
    expect(r.state).toBe('refuted');
    expect(r.readout).toBe('Other key');
  });

  it('refutes a post written by another account on the right instance', () => {
    const r = checkProof(masto(), key, post(`${PROOF_PHRASE}: ${npub}`, 'somebodyelse'));
    expect(r.state).toBe('refuted');
  });

  it('is unproven, not refuted, when the document says nothing about a key', () => {
    const r = checkProof(gh(), key, gist('a gist about something else entirely'));
    expect(r.state).toBe('unproven');
  });
});

describe('what a failed fetch means', () => {
  it('says unknown rather than no, because invariant 9 governs a blank', () => {
    const r = checkProof(gh(), key, null);
    expect(r.state).toBe('unproven');
    expect(r.state).not.toBe('refuted');
    expect(r.reason).toContain('unknown is not no');
  });

  it('never throws on whatever came back from the network', () => {
    for (const body of [undefined, 42, 'nope', [], {}, { owner: 7 }, { files: null }]) {
      expect(() => checkProof(gh(), key, body)).not.toThrow();
      expect(() => checkProof(masto(), key, body)).not.toThrow();
    }
  });

  it('says a platform with no public check has none, rather than calling it unproven', () => {
    const r = checkProof({ platform: 'x', handle: 'raven', proof: 'abc' }, key, null);
    expect(r.state).toBe('unprovable');
  });

  it('calls a handle with no proof a claim', () => {
    const r = checkProof(gh({ proof: undefined }), key, null);
    expect(r.state).toBe('unproven');
    expect(r.readout).toBe('Claim');
  });
});

describe('every readout fits the panel', () => {
  it('is five words or fewer, because a readout is a name and not a sentence', () => {
    const bodies = [null, gist('nothing'), gist(`${PROOF_PHRASE}: ${npub}`), gist('x', 'other')];
    for (const b of bodies) {
      const r = checkProof(gh(), key, b);
      expect(r.readout.split(/\s+/).length).toBeLessThanOrEqual(5);
    }
  });
});
