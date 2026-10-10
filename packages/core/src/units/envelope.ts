/**
 * Crew envelope v1: one crew state, sealed so that only the next epoch's roster can open the next
 * epoch's secret, padded so a relay learns nothing from its length.
 *
 * **It composes only existing, audited primitives and invents none:** `hybridSeal`, `hybridOpen` and
 * `kemKeypair` from `crypto/pq.ts` (ML-KEM-768 from `@noble/post-quantum` beside the secp256k1
 * exchange), NIP-44 v2 from nostr-tools, and HKDF, HMAC and SHA-256 from `@noble/hashes`. The
 * arrangement is new, on a boundary that protects people, so **it needs outside review before any
 * screen uses it.** Nothing outside `units/` imports this, and `test/units-unreached.test.ts` fails if
 * the Field Terminal or the watch ever does. `group.ts` and its `q:` format for the watch are
 * untouched.
 *
 * ## Layout
 *
 * ```
 * content = c1 . body . kem_0 . box_0 . … . kem_{room-1} . box_{room-1}
 * ```
 *
 * Exactly 2 + 2·room fields. Base64 has no `.`, so the split is unambiguous.
 *
 * - `body` is NIP-44 under the epoch's state key `K_state`, over the plaintext padded with ASCII
 *   spaces to exactly {@link BODY_BYTES} for the room. Bodies are JSON, which ignores the trailing
 *   spaces; the opener checks the exact length, so a fork's unpadded state is refused. A body that is
 *   too long is refused, never cut short.
 * - `kem_i` is the 1,088-byte ML-KEM ciphertext in base64, and `box_i` is NIP-44 of the new epoch's
 *   secret in hex under the hybrid wrap key, from the throwaway outer key to member `i` in roster
 *   order. So a member opens their own wrap first: one decapsulation.
 * - **Wraps past the roster are real**: a fresh secp256k1 key and its derived ML-KEM key per wrap,
 *   wrapping 32 random bytes, then discarded. A state that keeps the epoch (`epoch` null) is all
 *   spare wraps. So a state's length is the same whoever is in the crew, however many, and whether or
 *   not the epoch turned.
 * - **No classical fallback.** Every recipient needs an ML-KEM key, which the hello carries. Unlike
 *   `group.ts`, whose fallback exists so a `Distress` is never refused, nothing here is a `Distress`.
 *
 * Wraps sit beside the body rather than inside it, and KEM values are base64 rather than hex: nested
 * as `group.ts` nests them, room 15 does not fit one event (groups.md §7, *Padding to room*).
 *
 * ## Keys
 *
 * From the epoch secret `E` (32 bytes), by HKDF-SHA256 (groups.md §7, *Epochs, and the two
 * clocks*): `K_line`, `K_state` and the route secret `R`, each used directly as a NIP-44 conversation
 * key. {@link epochCommit} commits to `E`. **The signed inner state MUST carry it** (the crews layer,
 * not built): a former member who still reads the body could otherwise wrap a secret of their own
 * choosing to everyone and read what follows.
 *
 * ## The outer event
 *
 * Kind `1913`, signed by the throwaway key whose classical half the wraps used. One routing tag,
 * {@link ROUTE_TAG_NAME} (proposed, still to be checked against the NIP index), carrying
 * {@link routeTag} for the day, and a NIP-40 expiration at the end of the blurred UTC day plus
 * {@link STATE_KEEP_DAYS}. `created_at` is a random moment earlier in the same UTC day.
 *
 * ## Sizes, measured 2026-10-09
 *
 * Node 22.23.2, nostr-tools 2.24.2, @noble/post-quantum 0.7.0. A complete event is exactly
 * {@link EVENT_BYTES} for its room, whatever the real body length, however many real recipients, and
 * whether or not the epoch turned: 23,412 / 35,392 / 47,372 / 57,726 bytes for rooms 4 / 8 / 12 / 15,
 * leaving 42,124 / 30,144 / 18,164 / 7,810 under 65,536. Each wrap is 1,629 characters. **These body
 * lengths are provisional**: the state body, hello and welcome are not designed, groups.md asks for
 * all three at one length, and the lengths are measured again together before first ship. Seal and
 * open times on the device floor are unmeasured.
 */

import * as nip44 from 'nostr-tools/nip44';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import { hkdf } from '@noble/hashes/hkdf';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, concatBytes, hexToBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils';
import { base64 } from '@scure/base';
import { KIND_CREW_EVENT } from '../events/kinds.js';
import { isCurveKey, type SecretKey } from '../crypto/keys.js';
import { hybridOpen, hybridSeal, kemKeypair } from '../crypto/pq.js';
import { ROOMS, type Room } from './charter.js';

export const ENVELOPE_V1 = 'c1';

/** The padded plaintext length of a state body, per room. **Provisional**: see *Sizes*, above. */
export const BODY_BYTES: Readonly<Record<Room, number>> = { 4: 12_288, 8: 16_384, 12: 20_480, 15: 24_576 };

/** The length of every complete `1913` state event, per room, as JSON. Measured; see *Sizes*. */
export const EVENT_BYTES: Readonly<Record<Room, number>> = { 4: 23_412, 8: 35_392, 12: 47_372, 15: 57_726 };

/** The one routing tag a crew event carries. Proposed: still to be checked against the NIP index. */
export const ROUTE_TAG_NAME = 'y';

/** States expire this many days after the end of their blurred posting day (groups.md §7). */
export const STATE_KEEP_DAYS = 30;

const KEM_CIPHERTEXT_BYTES = 1088;
const KEM_PUBLIC_BYTES = 1184;
const DAY = 86_400;

const INFO = {
  line: 'navcom-crew-line-v1',
  state: 'navcom-crew-state-v1',
  route: 'navcom-crew-route-v1',
  commit: 'navcom-crew-epoch-commit-v1'
} as const;

export class CrewEnvelopeError extends Error {}

const fail = (why: string): never => {
  throw new CrewEnvelopeError(why);
};
const is32 = (b: unknown): b is Uint8Array => b instanceof Uint8Array && b.length === 32;
const isRoom = (r: unknown): r is Room => (ROOMS as readonly unknown[]).includes(r);

/** A fresh epoch secret, from the platform's own randomness. */
export const newEpochSecret = (): Uint8Array => randomBytes(32);

/** The three keys an epoch secret gives: lines, states, and the route secret. */
export function epochKeys(E: Uint8Array): { line: Uint8Array; state: Uint8Array; route: Uint8Array } {
  if (!is32(E)) fail('An epoch secret is 32 bytes.');
  return {
    line: hkdf(sha256, E, undefined, INFO.line, 32),
    state: hkdf(sha256, E, undefined, INFO.state, 32),
    route: hkdf(sha256, E, undefined, INFO.route, 32)
  };
}

/** 32 hex committing to an epoch secret, for the signed inner state to carry. */
export function epochCommit(E: Uint8Array): string {
  if (!is32(E)) fail('An epoch secret is 32 bytes.');
  return bytesToHex(hkdf(sha256, E, undefined, INFO.commit, 16));
}

/**
 * Whether the epoch secret a wrap gave this phone is the one the signed state committed to. False
 * means somebody who could read the body re-wrapped a secret of their own: take nothing from it.
 */
export function checkEpochCommit(E: Uint8Array, commit: string): boolean {
  try {
    return epochCommit(E) === commit;
  } catch {
    return false;
  }
}

/** The UTC day of a unix time, as `YYYY-MM-DD`: the day a route tag is for. */
export const utcDay = (unixSeconds: number): string => new Date(unixSeconds * 1000).toISOString().slice(0, 10);

/**
 * The day's routing tag: the first 32 hex of HMAC-SHA256(R, unit id ‖ day). Members find the day's
 * events by it; a relay sees a tag that changes daily and with every epoch, and never the unit id.
 */
export function routeTag(route: Uint8Array, unitId: Uint8Array, day: string): string {
  if (!is32(route)) fail('A route secret is 32 bytes.');
  if (!(unitId instanceof Uint8Array) || unitId.length !== 16) fail('A unit id is 16 bytes.');
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) fail('A day is YYYY-MM-DD.');
  return bytesToHex(hmac(sha256, route, concatBytes(unitId, utf8ToBytes(day)))).slice(0, 32);
}

export interface CrewRecipient {
  pubkey: string;
  /** Their ML-KEM-768 public key, 1,184 bytes. Required: crews have no classical fallback. */
  kem: Uint8Array;
}

/**
 * Seals one state. `epoch` is the new epoch's secret, wrapped to each recipient in roster order; null
 * keeps the epoch, and every wrap is spare. Returns the content and the throwaway key that must sign
 * the outer event ({@link crewStateEvent}), since its classical half is in every wrap.
 */
export function sealCrewState(o: {
  room: Room;
  stateKey: Uint8Array;
  body: string;
  epoch: Uint8Array | null;
  recipients: readonly CrewRecipient[];
  throwaway?: SecretKey;
}): { content: string; signer: SecretKey } {
  if (!isRoom(o.room)) fail('A crew’s room is 4, 8, 12 or 15.');
  if (!is32(o.stateKey)) fail('A state key is 32 bytes.');
  if (o.epoch !== null && !is32(o.epoch)) fail('An epoch secret is 32 bytes.');
  if (!Array.isArray(o.recipients) || o.recipients.length > o.room) fail('More recipients than the room holds.');
  for (const r of o.recipients) {
    if (!isCurveKey(r?.pubkey)) fail('A recipient is a key.');
    if (!(r.kem instanceof Uint8Array) || r.kem.length !== KEM_PUBLIC_BYTES) {
      fail('Every crew member needs a post-quantum key: crews have no classical fallback.');
    }
  }
  if (typeof o.body !== 'string') fail('A state body is text.');
  const size = utf8ToBytes(o.body).length;
  const padded = BODY_BYTES[o.room];
  if (size > padded) fail(`That state is ${size} bytes; room ${o.room} carries ${padded}. Nothing was cut.`);

  const throwaway = o.throwaway ?? generateSecretKey();
  const parts: string[] = [ENVELOPE_V1, nip44.encrypt(o.body + ' '.repeat(padded - size), o.stateKey)];
  const real = o.epoch === null ? [] : o.recipients;
  for (let i = 0; i < o.room; i++) {
    let to: string;
    let kem: Uint8Array;
    let secret: Uint8Array;
    if (i < real.length) {
      to = real[i]!.pubkey;
      kem = real[i]!.kem;
      secret = o.epoch!;
    } else {
      // A spare wrap: a real hybrid wrap to a key nobody keeps.
      const spare = generateSecretKey();
      to = getPublicKey(spare);
      kem = kemKeypair(spare).publicKey;
      secret = randomBytes(32);
    }
    const wrap = hybridSeal(throwaway, to, kem);
    parts.push(base64.encode(hexToBytes(wrap.kem)), nip44.encrypt(bytesToHex(secret), wrap.key));
  }
  return { content: parts.join('.'), signer: throwaway };
}

/**
 * Opens one state: the body for anyone holding this epoch's state key, and the next epoch's secret
 * for a member of the next roster. `me.index` is this member's place in that roster, tried first;
 * if it does not open, every wrap is tried. Throws {@link CrewEnvelopeError} and nothing else.
 */
export function openCrewState(
  content: string,
  o: { room: Room; stateKey: Uint8Array; outerPubkey: string; me?: { secret: SecretKey; index: number } }
): { body: string; epoch: Uint8Array | null } {
  if (!isRoom(o.room)) fail('A crew’s room is 4, 8, 12 or 15.');
  if (typeof content !== 'string') fail('Not a crew state.');
  const parts = content.split('.');
  if (parts.length !== 2 + 2 * o.room) fail('Not a crew state for this room.');
  if (parts[0] !== ENVELOPE_V1) fail('Not a crew state this version understands.');

  const kems: string[] = [];
  for (let i = 0; i < o.room; i++) {
    let bytes: Uint8Array;
    try {
      bytes = base64.decode(parts[2 + 2 * i]!);
    } catch {
      return fail('A wrap in that state is damaged.');
    }
    if (bytes.length !== KEM_CIPHERTEXT_BYTES) fail('A wrap in that state is the wrong size.');
    kems.push(bytesToHex(bytes));
  }

  let body: string;
  try {
    body = nip44.decrypt(parts[1]!, o.stateKey);
  } catch {
    return fail('That state is not for this epoch’s key.');
  }
  if (utf8ToBytes(body).length !== BODY_BYTES[o.room]) fail('That state is not padded to its room, so it was not read.');

  let epoch: Uint8Array | null = null;
  if (o.me) {
    const tryWrap = (i: number): Uint8Array | null => {
      try {
        const key = hybridOpen(o.me!.secret, o.outerPubkey, kems[i]!);
        const hex = nip44.decrypt(parts[3 + 2 * i]!, key);
        return /^[0-9a-f]{64}$/.test(hex) ? hexToBytes(hex) : null;
      } catch {
        return null;
      }
    };
    const first = Number.isInteger(o.me.index) && o.me.index >= 0 && o.me.index < o.room ? o.me.index : -1;
    if (first >= 0) epoch = tryWrap(first);
    for (let i = 0; epoch === null && i < o.room; i++) if (i !== first) epoch = tryWrap(i);
  }
  return { body: body.replace(/ +$/, ''), epoch };
}

/** A whole number of seconds in [0, n), from the platform's own randomness. */
function below(n: number): number {
  const [a, b, c, d] = randomBytes(4);
  return n <= 1 ? 0 : (((a! << 24) | (b! << 16) | (c! << 8) | d!) >>> 0) % n;
}

/**
 * The outer `1913` event for a sealed state: signed by the throwaway key, one routing tag, and an
 * expiry at the end of the blurred UTC day plus {@link STATE_KEEP_DAYS}. Its `created_at` is a random
 * moment earlier the same UTC day, never the real send time.
 */
export function crewStateEvent(o: { content: string; route: string; now: number; signer: SecretKey }): Event {
  if (typeof o.route !== 'string' || !/^[0-9a-f]{32}$/.test(o.route)) fail('A route tag is 32 hex.');
  if (!Number.isSafeInteger(o.now) || o.now < 0) fail('A time is whole seconds.');
  const dayStart = Math.floor(o.now / DAY) * DAY;
  const created = dayStart + below(o.now - dayStart + 1);
  const expires = dayStart + DAY + STATE_KEEP_DAYS * DAY;
  return finalizeEvent({
    kind: KIND_CREW_EVENT,
    created_at: created,
    tags: [[ROUTE_TAG_NAME, o.route], ['expiration', String(expires)]],
    content: o.content
  }, o.signer);
}
