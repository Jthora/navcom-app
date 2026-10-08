import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';
import {
  CLAIM_LEASE_SECONDS,
  KIND_INBOX_RELAYS,
  KIND_LABEL,
  MISSION_NAMESPACE,
  buildClaimDeletion,
  buildMissionClaim,
  buildSealedMissionClaim,
  claimEnds,
  inboxRelays
} from '../src/missions/claim';
import { KIND_GIFT_WRAP } from '../src/missions/seal';

/**
 * Taking part in a mission [interchange spec §5.1]. The sealed path is opened here the way the
 * poster opens it — wrap, seal, then the label inside — because a claim the poster cannot read is
 * a claim that never happened, and nothing in this codebase would notice.
 */

const MISSION = '30079:6301c4d09a014909e5a48b7d0c9aa859eec18804c2fc87eab4e414aa5a319692:starcom_mission_package_x';
const NOW = 1791316800;
const tag = (tags: string[][], name: string) => tags.find((t) => t[0] === name);

describe('a claim is a lease, not a lock', () => {
  it('ends a day after it is made', () => {
    expect(claimEnds(NOW, NOW + 10 * 86_400)).toBe(NOW + CLAIM_LEASE_SECONDS);
  });

  it('ends with its mission, when that comes first', () => {
    expect(claimEnds(NOW, NOW + 3_600)).toBe(NOW + 3_600);
  });
});

describe('a claim in the open', () => {
  const contact = generateSecretKey();
  const claim = buildMissionClaim(contact, 'claimed', MISSION, NOW + 600, NOW);

  it('is a NIP-32 label in navcom.mission, naming the package and nothing else', () => {
    expect(claim.kind).toBe(KIND_LABEL);
    expect(verifyEvent(claim)).toBe(true);
    expect(claim.pubkey).toBe(getPublicKey(contact));
    expect(tag(claim.tags, 'L')).toEqual(['L', MISSION_NAMESPACE]);
    expect(tag(claim.tags, 'l')).toEqual(['l', 'claimed', MISSION_NAMESPACE]);
    expect(tag(claim.tags, 'a')).toEqual(['a', MISSION]);
    expect(tag(claim.tags, 'expiration')).toEqual(['expiration', String(NOW + 600)]);
    // No place, no time beyond its end, no words.
    expect(claim.tags.map((t) => t[0]).sort()).toEqual(['L', 'a', 'expiration', 'l']);
    expect(claim.content).toBe('');
  });

  it('is let go by a released label and a deletion request for the claim', () => {
    const released = buildMissionClaim(contact, 'released', MISSION, NOW + 600, NOW + 60);
    expect(tag(released.tags, 'l')).toEqual(['l', 'released', MISSION_NAMESPACE]);
    const deletion = buildClaimDeletion(contact, claim.id, NOW + 60);
    expect(deletion.kind).toBe(5);
    expect(deletion.pubkey).toBe(claim.pubkey);
    expect(tag(deletion.tags, 'e')).toEqual(['e', claim.id]);
    expect(tag(deletion.tags, 'k')).toEqual(['k', String(KIND_LABEL)]);
  });
});

describe('a claim for the poster only', () => {
  const contact = generateSecretKey();
  const posterSecret = generateSecretKey();
  const poster = getPublicKey(posterSecret);
  const wrap = buildSealedMissionClaim(contact, poster, 'claimed', MISSION, NOW + 600, NOW);

  /** As the poster opens it: wrap, then seal, then the label, each checked. */
  function open() {
    expect(verifyEvent(wrap)).toBe(true);
    const seal = JSON.parse(nip44.decrypt(wrap.content, nip44.getConversationKey(posterSecret, wrap.pubkey)));
    expect(seal.kind).toBe(13);
    expect(verifyEvent(seal)).toBe(true);
    const label = JSON.parse(nip44.decrypt(seal.content, nip44.getConversationKey(posterSecret, seal.pubkey)));
    return { seal, label };
  }

  it('shows a relay only that somebody wrote to the poster', () => {
    expect(wrap.kind).toBe(KIND_GIFT_WRAP);
    expect(wrap.tags.map((t) => t[0])).toEqual(['p', 'expiration']);
    expect(tag(wrap.tags, 'p')).toEqual(['p', poster]);
    // A one-time key: not the operator's, so two claims are unlinkable to anyone but the poster.
    expect(wrap.pubkey).not.toBe(getPublicKey(contact));
    expect(wrap.created_at).toBeLessThanOrEqual(NOW);
    expect(wrap.created_at).toBeGreaterThan(NOW - 2 * 86_400 - 1);
  });

  it('opens, for the poster, to the same label, sealed by the claimant', () => {
    const { seal, label } = open();
    expect(seal.pubkey).toBe(getPublicKey(contact));
    // The label inside is the seal-signer's own, and its id is its own.
    expect(label.pubkey).toBe(seal.pubkey);
    expect(label.kind).toBe(KIND_LABEL);
    expect(tag(label.tags, 'l')).toEqual(['l', 'claimed', MISSION_NAMESPACE]);
    expect(tag(label.tags, 'a')).toEqual(['a', MISSION]);
    // The exact end is here, inside, and only here: the wrap's own is later, and the poster reads this one.
    expect(tag(label.tags, 'expiration')).toEqual(['expiration', String(NOW + 600)]);
    expect(label.sig).toBeUndefined();
  });

  it('cannot be opened by anyone else', () => {
    const stranger = generateSecretKey();
    expect(() => nip44.decrypt(wrap.content, nip44.getConversationKey(stranger, wrap.pubkey))).toThrow();
  });
});

describe('where the poster accepts sealed messages', () => {
  const posterSecret = generateSecretKey();
  const poster = getPublicKey(posterSecret);
  const list = (tags: string[][], secret = posterSecret) =>
    finalizeEvent({ kind: KIND_INBOX_RELAYS, created_at: NOW, content: '', tags }, secret);

  it('reads the secure relays from the poster’s own signed list', () => {
    const e = list([
      ['relay', 'wss://nos.lol'],
      ['relay', 'wss://relay.primal.net'],
      ['relay', 'ws://insecure.example'],
      ['relay', 'wss://nos.lol']
    ]);
    expect(inboxRelays(e, poster)).toEqual(['wss://nos.lol', 'wss://relay.primal.net']);
  });

  it('trusts no list the poster did not sign', () => {
    expect(inboxRelays(list([['relay', 'wss://evil.example']], generateSecretKey()), poster)).toEqual([]);
    const tampered = { ...list([['relay', 'wss://nos.lol']]), tags: [['relay', 'wss://evil.example']] };
    expect(inboxRelays(tampered, poster)).toEqual([]);
    expect(inboxRelays(null, poster)).toEqual([]);
  });
});

describe('what the second audit of Milestone 11 found', () => {
  const contact = generateSecretKey();
  const posterSecret = generateSecretKey();
  const poster = getPublicKey(posterSecret);
  const LEASE_END = NOW + CLAIM_LEASE_SECONDS;
  const expiry = (w: { tags: string[][] }) => Number(tag(w.tags, 'expiration')![1]);
  const many = (n: number, label: 'claimed' | 'released' = 'claimed') =>
    Array.from({ length: n }, () => buildSealedMissionClaim(contact, poster, label, MISSION, LEASE_END, NOW));

  /*
   * The lease ends a day after the claim, so a wrap carrying the lease's exact end gave away the
   * second it was sent — expiration less a day — which the blurred `created_at` beside it exists
   * to hide. And a claim and its release share an end, so their wraps paired up across the two
   * one-time keys that are meant to keep them apart.
   */
  it('a sealed claim’s wrap does not give away the second it was sent', () => {
    const wraps = many(40);
    expect(wraps.filter((w) => expiry(w) - CLAIM_LEASE_SECONDS === NOW).length).toBeLessThanOrEqual(1);
    expect(new Set(wraps.map(expiry)).size).toBeGreaterThan(30);
  });

  it('a claim and its release cannot be paired by the ends on their wraps', () => {
    const claims = many(20);
    const releases = many(20, 'released');
    expect(claims.filter((c, i) => expiry(c) === expiry(releases[i]!)).length).toBeLessThanOrEqual(1);
  });

  it('a wrap never lets a relay drop it before the claim inside has ended', () => {
    for (const w of many(40)) {
      expect(expiry(w)).toBeGreaterThanOrEqual(LEASE_END);
      expect(expiry(w)).toBeLessThanOrEqual(LEASE_END + 2 * 86_400);
    }
    // A release made after the clock went back carries an end further off than a lease runs: still kept until then.
    const late = NOW + 3 * 86_400 + 5;
    for (let i = 0; i < 20; i++) expect(expiry(buildSealedMissionClaim(contact, poster, 'released', MISSION, late, NOW))).toBeGreaterThanOrEqual(late);
  });

  /*
   * An end blurred apart from the blurred time beside it narrowed what the two days hide: a relay
   * holding both reads the claim as sent inside the overlap of two windows, under twelve hours wide
   * for one wrap in sixteen [audit 11, second grid — review]. Worked out from the wrap's own time,
   * the end is the same distance from it on every wrap, and so says nothing the time does not.
   */
  it('a wrap’s end says nothing of when the claim was sent that its blurred time does not', () => {
    const wraps = many(40);
    expect(new Set(wraps.map((w) => expiry(w) - w.created_at)).size).toBe(1);
  });

  it('the poster reads the claim’s exact end inside, whatever the wrap says outside', () => {
    const w = many(1)[0]!;
    const seal = JSON.parse(nip44.decrypt(w.content, nip44.getConversationKey(posterSecret, w.pubkey)));
    const label = JSON.parse(nip44.decrypt(seal.content, nip44.getConversationKey(posterSecret, seal.pubkey)));
    expect(tag(label.tags, 'expiration')).toEqual(['expiration', String(LEASE_END)]);
    expect(expiry(w)).toBeGreaterThan(LEASE_END);
  });

  it('a wrap’s own time is blurred across two days, as NIP-59 asks, not merely allowed to be', () => {
    const at = many(40).map((w) => w.created_at);
    for (const t of at) {
      expect(t).toBeLessThanOrEqual(NOW);
      expect(t).toBeGreaterThan(NOW - 2 * 86_400);
    }
    expect(new Set(at).size).toBeGreaterThan(30);
  });

  it('reads an inbox only from the poster’s kind-10050 list, not from another list of relays it signed', () => {
    const outbox = finalizeEvent({ kind: 10002, created_at: NOW, content: '', tags: [['relay', 'wss://nos.lol']] }, posterSecret);
    expect(inboxRelays(outbox, poster)).toEqual([]);
  });
});
