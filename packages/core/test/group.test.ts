/**
 * Sealing to several holders.
 *
 * The tests that matter here are not "does it decrypt" — they are the membership
 * properties, because those are what a squad relies on and what a later change would
 * silently break: who can read a message, who stops being able to, and what a relay learns
 * from watching.
 */

import { newSecretKey } from '../src/crypto/keys';
import { publicKeyOf } from '../src/crypto/keys';
import { describe, expect, it } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { GroupSealError, openFromGroup, sealToGroup } from '../src/index.js';

const wren = generateSecretKey();
const wrenPub = getPublicKey(wren);

/** A squad of four holding the watch in turn. */
const squad = Array.from({ length: 4 }, () => generateSecretKey());
const squadPubs = squad.map(getPublicKey);

const stranger = generateSecretKey();

const payload = { type: 'on-station', area: 'Downtown' };

describe('who can read it', () => {
  it('is readable by every holder, with their own key', () => {
    const sealed = sealToGroup(wren, squadPubs, payload);
    for (const member of squad) {
      expect(openFromGroup(member, wrenPub, sealed)).toEqual(payload);
    }
  });

  it('is not readable by anybody else', () => {
    const sealed = sealToGroup(wren, squadPubs, payload);
    expect(() => openFromGroup(stranger, wrenPub, sealed)).toThrow(GroupSealError);
  });

  it('is not readable with the wrong sender, since the wrap is a conversation', () => {
    const sealed = sealToGroup(wren, squadPubs, payload);
    const notWren = getPublicKey(generateSecretKey());
    expect(() => openFromGroup(squad[0]!, notWren, sealed)).toThrow(GroupSealError);
  });

  it('refuses to seal to nobody rather than producing an unreadable message', () => {
    // The silent version of this failure is an unanswered Distress.
    expect(() => sealToGroup(wren, [], payload)).toThrow(GroupSealError);
  });

  it('dedupes a repeated holder rather than refusing or double-wrapping (found in robustness audit)', () => {
    // A repeated entry is far more likely a pasted list with an accident in it than an
    // attack, and this must never refuse to send over something this cheap to fix. A
    // duplicate wrap would also inflate the relay-visible wrap count a hostile relay can
    // already use to guess how many people hold a watch.
    const sealed = sealToGroup(wren, [squadPubs[0]!, squadPubs[0]!, squadPubs[1]!], payload);
    expect(JSON.parse(sealed).k).toHaveLength(2);
    expect(openFromGroup(squad[0]!, wrenPub, sealed)).toEqual(payload);
    expect(openFromGroup(squad[1]!, wrenPub, sealed)).toEqual(payload);
  });

  it('refuses an unreasonably large holder list', () => {
    const many = Array.from({ length: 33 }, () => getPublicKey(generateSecretKey()));
    expect(() => sealToGroup(wren, many, payload)).toThrow(GroupSealError);
  });
});

describe('membership is not retroactive', () => {
  it('stops a removed holder reading the NEXT message', () => {
    const [leaving, ...staying] = squad;
    const after = sealToGroup(wren, staying.map(getPublicKey), payload);
    expect(() => openFromGroup(leaving!, wrenPub, after)).toThrow(GroupSealError);
  });

  it('cannot un-send what they could already read', () => {
    // The property no wording anywhere may contradict. Removing somebody is not a recall,
    // and a screen that implies it is has made a promise the cryptography cannot keep.
    const [leaving] = squad;
    const before = sealToGroup(wren, squadPubs, payload);
    const after = sealToGroup(wren, squad.slice(1).map(getPublicKey), payload);

    expect(openFromGroup(leaving!, wrenPub, before)).toEqual(payload);
    expect(() => openFromGroup(leaving!, wrenPub, after)).toThrow(GroupSealError);
  });

  it('lets a new holder read from when they were added, and no earlier', () => {
    const joining = generateSecretKey();
    const before = sealToGroup(wren, squadPubs, payload);
    const after = sealToGroup(wren, [...squadPubs, getPublicKey(joining)], payload);

    expect(() => openFromGroup(joining, wrenPub, before)).toThrow(GroupSealError);
    expect(openFromGroup(joining, wrenPub, after)).toEqual(payload);
  });
});

describe('what a relay sees', () => {
  it('carries no pubkey of any holder', () => {
    // Labelling the wraps by recipient would publish the squad roster to a public relay --
    // the same social-graph mistake peer presence spends a throwaway key per message to
    // avoid.
    const sealed = sealToGroup(wren, squadPubs, payload);
    for (const pub of squadPubs) expect(sealed).not.toContain(pub);
    expect(sealed).not.toContain(wrenPub);
  });

  it('leaks no plaintext', () => {
    const sealed = sealToGroup(wren, squadPubs, { type: 'query', text: 'Riverfront shelter' });
    expect(sealed).not.toContain('Riverfront');
    expect(sealed).not.toContain('query');
  });

  it('looks the same for one holder as for four, apart from the count', () => {
    // Two shapes would let anyone watching a relay sort Watchtowers into "box" and "squad"
    // without decrypting anything.
    const one = JSON.parse(sealToGroup(wren, [squadPubs[0]!], payload)) as Record<string, unknown>;
    const four = JSON.parse(sealToGroup(wren, squadPubs, payload)) as Record<string, unknown>;
    expect(Object.keys(one).sort()).toEqual(Object.keys(four).sort());
    expect((one.k as string[]).length).toBe(1);
    expect((four.k as string[]).length).toBe(4);
  });

  it('encrypts the payload once however many hold the watch', () => {
    // The efficiency claim, stated as a test: a squad of four costs four 32-byte wraps, not
    // four copies of the message. It is why a heartbeat on a cheap plan stays affordable.
    const long = { type: 'routine', text: 'x'.repeat(4000) };
    const one = sealToGroup(wren, [squadPubs[0]!], long).length;
    const four = sealToGroup(wren, squadPubs, long).length;
    // Three extra wraps, each far smaller than the payload they share.
    expect(four - one).toBeLessThan(600);
  });
});

describe('what it refuses', () => {
  it('refuses anything that is not an envelope', () => {
    for (const junk of ['', 'not json', '{}', '[]', '{"v":99,"c":"x","k":[]}']) {
      expect(() => openFromGroup(squad[0]!, wrenPub, junk), junk).toThrow(GroupSealError);
    }
  });

  it('refuses an envelope whose wraps have been tampered with', () => {
    const sealed = JSON.parse(sealToGroup(wren, squadPubs, payload)) as { k: string[] };
    sealed.k = sealed.k.map((w) => w.slice(0, -4) + 'AAAA');
    expect(() => openFromGroup(squad[0]!, wrenPub, JSON.stringify(sealed))).toThrow(GroupSealError);
  });

  it('refuses an envelope whose payload has been tampered with', () => {
    const sealed = JSON.parse(sealToGroup(wren, squadPubs, payload)) as { c: string };
    sealed.c = sealed.c.slice(0, -4) + 'AAAA';
    expect(() => openFromGroup(squad[0]!, wrenPub, JSON.stringify(sealed))).toThrow();
  });
});

describe('each message carries its own content key', () => {
  /**
   * The mechanism behind the one property a squad actually needs.
   *
   * `watch-key.ts` states it plainly: removing somebody from the holder list *"stops them
   * reading new signals"*. That only holds if every message has its own content key — reuse
   * one, and anybody who ever learned it reads everything sent afterwards, membership list or
   * not.
   *
   * Asserted by **mixing two envelopes**: one message's wrapped keys must not open another
   * message's content. Comparing ciphertexts would prove nothing, since NIP-44 uses a fresh
   * nonce either way.
   */
  const sender = newSecretKey();
  const holder = newSecretKey();
  const holderPub = publicKeyOf(holder);

  it("so one message's key cannot open another message", () => {
    const first = JSON.parse(sealToGroup(sender, [holderPub], { text: 'first' })) as Record<string, unknown>;
    const second = JSON.parse(sealToGroup(sender, [holderPub], { text: 'second' })) as Record<string, unknown>;

    // The second message's wraps over the first message's content.
    const mixed = JSON.stringify({ ...first, k: second['k'] });
    expect(() => openFromGroup(holder, publicKeyOf(sender), mixed)).toThrow();
  });

  it('and each envelope still opens on its own', () => {
    const a = sealToGroup(sender, [holderPub], { text: 'first' });
    const b = sealToGroup(sender, [holderPub], { text: 'second' });
    expect(openFromGroup(holder, publicKeyOf(sender), a)).toEqual({ text: 'first' });
    expect(openFromGroup(holder, publicKeyOf(sender), b)).toEqual({ text: 'second' });
  });

  it('and somebody dropped from the holders cannot read what comes next', () => {
    // The property in the form a squad experiences it.
    const removed = newSecretKey();
    const stillIn = newSecretKey();
    const before = sealToGroup(sender, [publicKeyOf(removed), publicKeyOf(stillIn)], { text: 'before' });
    expect(openFromGroup(removed, publicKeyOf(sender), before)).toEqual({ text: 'before' });

    const after = sealToGroup(sender, [publicKeyOf(stillIn)], { text: 'after' });
    expect(openFromGroup(stillIn, publicKeyOf(sender), after)).toEqual({ text: 'after' });
    expect(() => openFromGroup(removed, publicKeyOf(sender), after)).toThrow();
  });
});
