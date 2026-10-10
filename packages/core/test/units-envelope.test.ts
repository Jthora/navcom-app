import { describe, expect, it } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';
import { base64 } from '@scure/base';
import { randomBytes } from '@noble/hashes/utils';
import { kemKeypair } from '../src/crypto/pq.js';
import { KIND_CREW_EVENT } from '../src/events/kinds.js';
import { ROOMS, type Room } from '../src/units/charter.js';
import {
  BODY_BYTES, CrewEnvelopeError, ENVELOPE_V1, EVENT_BYTES, ROUTE_TAG_NAME, STATE_KEEP_DAYS, checkEpochCommit,
  crewStateEvent, epochCommit, epochKeys, newEpochSecret, openCrewState, routeTag, sealCrewState, utcDay
} from '../src/units/envelope.js';

/**
 * Crew envelope v1. Failure paths first: what it refuses, and that a former member, a stranger and a
 * forger each get nothing. Then the length: one per room, whatever is inside.
 */

const LIMIT = 65_536;
const NOW = Date.UTC(2027, 2, 9, 17, 30) / 1000;
const UNIT = randomBytes(16);

interface Member { secret: Uint8Array; pubkey: string; kem: Uint8Array }
const member = (): Member => {
  const secret = generateSecretKey();
  return { secret, pubkey: getPublicKey(secret), kem: kemKeypair(secret).publicKey };
};
const roster = (n: number): Member[] => Array.from({ length: n }, member);
const bytes = (s: string) => new TextEncoder().encode(s).length;

/** A sealed state for `members`, turning to a new epoch, with a small JSON body that commits to it. */
function sealed(room: Room, members: Member[], o: { epoch?: Uint8Array | null; body?: string } = {}) {
  const old = newEpochSecret();
  const next = o.epoch === undefined ? newEpochSecret() : o.epoch;
  const { state } = epochKeys(old);
  const body = o.body ?? JSON.stringify({ commit: next ? epochCommit(next) : null, roster: members.map((m) => m.pubkey) });
  const { content, signer } = sealCrewState({ room, stateKey: state, body, epoch: next, recipients: members });
  return { content, signer, outer: getPublicKey(signer), state, next, body };
}

describe('F: seal refuses', () => {
  const state = epochKeys(newEpochSecret()).state;
  const base = { room: 4 as Room, stateKey: state, body: '{}', epoch: newEpochSecret(), recipients: roster(2) };

  it('a body longer than its room carries, rather than cutting it', () => {
    expect(() => sealCrewState({ ...base, body: 'x'.repeat(BODY_BYTES[4] + 1) })).toThrow(CrewEnvelopeError);
    expect(() => sealCrewState({ ...base, body: 'é'.repeat(BODY_BYTES[4] / 2 + 1) })).toThrow(CrewEnvelopeError);
  });

  it('more recipients than the room', () => {
    expect(() => sealCrewState({ ...base, recipients: roster(5) })).toThrow(CrewEnvelopeError);
  });

  it('a recipient with no post-quantum key: there is no classical fallback', () => {
    const [a] = roster(1);
    expect(() => sealCrewState({ ...base, recipients: [{ pubkey: a!.pubkey } as never] })).toThrow(/post-quantum/);
    expect(() => sealCrewState({ ...base, recipients: [{ pubkey: a!.pubkey, kem: new Uint8Array(32) }] })).toThrow(CrewEnvelopeError);
  });

  it('a room off the menu, a short epoch, a short state key', () => {
    expect(() => sealCrewState({ ...base, room: 16 as Room })).toThrow(CrewEnvelopeError);
    expect(() => sealCrewState({ ...base, epoch: new Uint8Array(31) })).toThrow(CrewEnvelopeError);
    expect(() => sealCrewState({ ...base, stateKey: new Uint8Array(16) })).toThrow(CrewEnvelopeError);
  });
});

describe('F: open refuses, throwing only CrewEnvelopeError', () => {
  const members = roster(2);
  const s = sealed(4, members);
  const open = (content: string, o: Partial<Parameters<typeof openCrewState>[1]> = {}) =>
    openCrewState(content, { room: 4, stateKey: s.state, outerPubkey: s.outer, ...o });

  it('the wrong number of fields, or a field count for another room', () => {
    expect(() => open(`${s.content}.x.y`)).toThrow(CrewEnvelopeError);
    expect(() => open(s.content, { room: 8 })).toThrow(CrewEnvelopeError);
    expect(() => open('')).toThrow(CrewEnvelopeError);
  });

  it('another version tag', () => {
    expect(() => open(s.content.replace(/^c1\./, 'c2.'))).toThrow(CrewEnvelopeError);
  });

  it('a fork’s unpadded state', () => {
    const parts = s.content.split('.');
    parts[1] = nip44.encrypt('{"roster":[]}', s.state);
    expect(() => open(parts.join('.'))).toThrow(/padded/);
  });

  it('a KEM field that is not 1,088 bytes, or not base64', () => {
    const parts = s.content.split('.');
    parts[2] = base64.encode(new Uint8Array(1087));
    expect(() => open(parts.join('.'))).toThrow(CrewEnvelopeError);
    parts[2] = '!!!';
    expect(() => open(parts.join('.'))).toThrow(CrewEnvelopeError);
  });

  it('never throws anything else', () => {
    for (const bad of [undefined, null, 7, 'c1', `c1.${'.'.repeat(9)}`] as unknown[]) {
      try {
        open(bad as string);
        throw new Error('opened');
      } catch (e) {
        expect(e).toBeInstanceOf(CrewEnvelopeError);
      }
    }
  });
});

describe('F2: who gets what', () => {
  it('a former member reads the body they still hold the key for, and gets no new epoch', () => {
    const stay = roster(3);
    const former = member();
    const s = sealed(4, stay);
    const read = openCrewState(s.content, { room: 4, stateKey: s.state, outerPubkey: s.outer, me: { secret: former.secret, index: 0 } });
    expect(read.body).toBe(s.body);
    expect(read.epoch).toBeNull();
  });

  it('a stranger cannot open the body', () => {
    const s = sealed(4, roster(2));
    expect(() => openCrewState(s.content, { room: 4, stateKey: epochKeys(newEpochSecret()).state, outerPubkey: s.outer })).toThrow(CrewEnvelopeError);
  });

  it('a forger who reads the body and re-wraps a secret of their own is caught by the commit', () => {
    const members = roster(3);
    const s = sealed(4, members);
    const commit = (JSON.parse(s.body) as { commit: string }).commit;
    // The forger holds the old state key, so can copy the body and wrap a secret of their choosing.
    const chosen = newEpochSecret();
    const forged = sealCrewState({ room: 4, stateKey: s.state, body: s.body, epoch: chosen, recipients: members });
    const got = openCrewState(forged.content, {
      room: 4, stateKey: s.state, outerPubkey: getPublicKey(forged.signer), me: { secret: members[1]!.secret, index: 1 }
    });
    expect(got.epoch).toEqual(chosen);
    expect(checkEpochCommit(got.epoch!, commit)).toBe(false);
    const real = openCrewState(s.content, { room: 4, stateKey: s.state, outerPubkey: s.outer, me: { secret: members[1]!.secret, index: 1 } });
    expect(checkEpochCommit(real.epoch!, commit)).toBe(true);
  });
});

describe('F3: spare wraps are real', () => {
  it('every KEM field is a 1,088-byte ciphertext, every box one length, and nothing repeats', () => {
    const members = roster(2);
    const a = sealed(8, members).content.split('.');
    const b = sealed(8, members).content.split('.');
    const kemA = a.filter((_, i) => i >= 2 && i % 2 === 0);
    const boxA = a.filter((_, i) => i >= 3 && i % 2 === 1);
    expect(kemA).toHaveLength(8);
    for (const k of kemA) expect(base64.decode(k)).toHaveLength(1088);
    expect(new Set(boxA.map((x) => x.length)).size).toBe(1);
    expect(new Set([...a.slice(1), ...b.slice(1)]).size).toBe(2 * (a.length - 1));
  });

  it('no member’s key opens a spare wrap', () => {
    const members = roster(2);
    const s = sealed(4, members);
    for (const m of members) {
      for (const i of [2, 3]) {
        // Asking for a spare wrap first falls back to the member's own, never to the spare.
        const got = openCrewState(s.content, { room: 4, stateKey: s.state, outerPubkey: s.outer, me: { secret: m.secret, index: i } });
        expect(got.epoch).toEqual(s.next);
      }
    }
    const kept = sealed(4, members, { epoch: null });
    for (const m of members) {
      expect(openCrewState(kept.content, { room: 4, stateKey: kept.state, outerPubkey: kept.outer, me: { secret: m.secret, index: 0 } }).epoch).toBeNull();
    }
  });
});

describe('H: opening', () => {
  it('each member opens their own wrap, and a wrong index still opens by trying the rest', () => {
    const members = roster(4);
    const s = sealed(4, members);
    members.forEach((m, i) => {
      const got = openCrewState(s.content, { room: 4, stateKey: s.state, outerPubkey: s.outer, me: { secret: m.secret, index: i } });
      expect(got.epoch).toEqual(s.next);
      expect(got.body).toBe(s.body);
    });
    const wrong = openCrewState(s.content, { room: 4, stateKey: s.state, outerPubkey: s.outer, me: { secret: members[3]!.secret, index: 0 } });
    expect(wrong.epoch).toEqual(s.next);
  });
});

describe('H: one length per room', () => {
  it.each(ROOMS.map((room) => ({ room })))('room $room: every state is exactly EVENT_BYTES, under 64 KiB', ({ room }) => {
    const sizes = new Set<number>();
    const route = routeTag(epochKeys(newEpochSecret()).route, UNIT, utcDay(NOW));
    const cases: { members: number; body: number; epoch: boolean }[] = [
      { members: 1, body: 2, epoch: true },
      { members: room, body: BODY_BYTES[room], epoch: true },
      { members: Math.ceil(room / 2), body: Math.floor(BODY_BYTES[room] / 3), epoch: false },
      { members: room, body: 0, epoch: false }
    ];
    let sealMs = 0;
    let openMs = 0;
    for (const c of cases) {
      const members = roster(c.members);
      const body = 'x'.repeat(c.body);
      const t0 = performance.now();
      const s = sealed(room, members, { body, epoch: c.epoch ? newEpochSecret() : null });
      sealMs = Math.max(sealMs, performance.now() - t0);
      const event = crewStateEvent({ content: s.content, route, now: NOW, signer: s.signer });
      sizes.add(bytes(JSON.stringify(event)));
      const t1 = performance.now();
      const got = openCrewState(event.content, { room, stateKey: s.state, outerPubkey: event.pubkey, me: { secret: members[0]!.secret, index: 0 } });
      openMs = Math.max(openMs, performance.now() - t1);
      expect(got.body).toBe(body);
      expect(got.epoch === null).toBe(!c.epoch);
    }
    const [size] = [...sizes];
    console.log(`room ${room}: ${size} B, ${LIMIT - size!} B to spare; seal ≤ ${sealMs.toFixed(0)} ms, open ≤ ${openMs.toFixed(1)} ms`);
    expect([...sizes]).toEqual([EVENT_BYTES[room]]);
    expect(EVENT_BYTES[room]).toBeLessThanOrEqual(LIMIT);
  });

  it('each wrap is 1,629 characters', () => {
    const parts = sealed(4, roster(1)).content.split('.');
    expect(parts[2]!.length + 1 + parts[3]!.length).toBe(1629);
    expect(parts[0]).toBe(ENVELOPE_V1);
  });
});

describe('the outer event and the route', () => {
  it('blurs the time within the UTC day and expires thirty days after it ends', () => {
    const s = sealed(4, roster(1));
    const dayStart = Math.floor(NOW / 86_400) * 86_400;
    const times = new Set<number>();
    for (let i = 0; i < 40; i++) {
      const e = crewStateEvent({ content: s.content, route: 'ab'.repeat(16), now: NOW, signer: s.signer });
      expect(e.kind).toBe(KIND_CREW_EVENT);
      expect(e.created_at).toBeGreaterThanOrEqual(dayStart);
      expect(e.created_at).toBeLessThanOrEqual(NOW);
      expect(e.tags).toEqual([[ROUTE_TAG_NAME, 'ab'.repeat(16)], ['expiration', String(dayStart + 86_400 + STATE_KEEP_DAYS * 86_400)]]);
      times.add(e.created_at);
    }
    expect(times.size).toBeGreaterThan(1);
    expect(() => crewStateEvent({ content: s.content, route: 'nope', now: NOW, signer: s.signer })).toThrow(CrewEnvelopeError);
  });

  it('routes by a tag that is 32 hex, deterministic, changes by day and by epoch, and hides the unit', () => {
    const E = newEpochSecret();
    const { route } = epochKeys(E);
    const a = routeTag(route, UNIT, '2027-03-09');
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(routeTag(route, UNIT, '2027-03-09')).toBe(a);
    expect(routeTag(route, UNIT, '2027-03-10')).not.toBe(a);
    expect(routeTag(epochKeys(newEpochSecret()).route, UNIT, '2027-03-09')).not.toBe(a);
    const hex = Buffer.from(UNIT).toString('hex');
    expect(a).not.toContain(hex.slice(0, 8));
    expect(utcDay(NOW)).toBe('2027-03-09');
    expect(() => routeTag(route, UNIT, '9 March')).toThrow(CrewEnvelopeError);
  });

  it('derives three distinct keys and a commit from one secret', () => {
    const E = newEpochSecret();
    const k = epochKeys(E);
    const all = [k.line, k.state, k.route].map((x) => Buffer.from(x).toString('hex'));
    expect(new Set(all).size).toBe(3);
    expect(epochCommit(E)).toMatch(/^[0-9a-f]{32}$/);
    expect(epochCommit(E)).toBe(epochCommit(E));
    expect(checkEpochCommit(new Uint8Array(3), epochCommit(E))).toBe(false);
  });
});
