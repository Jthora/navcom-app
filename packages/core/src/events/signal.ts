/**
 * Signals — kinds 20910 and 20911.
 *
 * Structured, terse and defined: a protocol rather than a chat. Every signal has a shape, a
 * responder and a response window, which is what makes it faster to send under stress and
 * impossible to turn into a feed.
 *
 * Normative source: docs/spec/signals.spec.md
 */

import { sealToGroup, type WatchtowerAddress } from '../crypto/group.js';
import { AREA_MAX, TEXT_MAX, withinLimit } from '../limits.js';
import type { SecretKey } from '../crypto/keys.js';
import { KIND_DISTRESS, KIND_SIGNAL, tagRecipient, tagSignalType, type SignalType } from './kinds.js';

export interface Position {
  lat: number;
  lon: number;
  precision_m: number;
}

export interface OnStationPayload {
  /**
   * How the board displays this operator. Optional on the wire, and a daemon falls back to
   * a short deterministic label from the pubkey when it is absent.
   *
   * The spec originally omitted it, and the board then had no way to show a name at all —
   * caught by the daemon implementation rather than by review.
   */
  callsign?: string;
  /** Coarse — a district, never an address. */
  area: string;
  expected_duration: number;
  /** Null disables routine check-ins. It never implies anything about safety. */
  routine_interval: number | null;
  share_position: boolean;
  position: Position | null;
}

export interface QueryPayload {
  text: string;
  area?: string;
}

export interface AssistPayload {
  /**
   * Optional on purpose. An assist with no text still means "I need someone" — requiring a
   * reason would delay a send at the moment sending matters, and the watch can ask.
   */
  text?: string;
  area?: string;
  /**
   * How long the watch has. Required, because "I need someone" and "I need someone now"
   * ask for different responses and the watch cannot tell them apart from silence.
   *
   * One tap, not a sentence — which is why this stays required where `text` does not.
   */
  urgency: 'soon' | 'now';
}

export interface DistressPayload {
  /** Last known position if the operator shares it; otherwise `area` carries what is known. */
  position: Position | null;
  /** Coarse. Present even when position is null, so a responder has somewhere to start. */
  area: string | null;
  text?: string;
}

/**
 * How long a client keeps retrying a `Distress` that has not been acknowledged.
 *
 * The spec says retry indefinitely with backoff, and that requirement is what makes an
 * ephemeral transport acceptable here at all: relays do not store these events, so a single
 * failed publish is a signal nobody ever receives.
 *
 * Implemented by `sendDistressUntilAcknowledged` in transport.ts, which stops only when a
 * human acknowledges or the operator cancels — never on its own.
 */
export const DISTRESS_RETRY_FOREVER = true;

/**
 * A request for the entries about oneself.
 *
 * Deliberately carries no subject. The node answers about the pubkey that signed the
 * request, so there is no field through which one operator could ask for another's record.
 */
export interface LogReviewPayload {
  /** Only entries at or after this unix second. Omitted means everything retained. */
  since?: number;
  /** How many at most. The node caps this regardless of what is asked for. */
  limit?: number;
}

/** Accepting a specific `Distress`. The id is the `20911` event being answered. */
/**
 * What ran out. Free text, and deliberately no quantities and no taxonomy.
 *
 * A list of supply categories would be content this project has no business generating —
 * what a squad carries is local knowledge, and a dropdown that omits the thing you actually
 * need teaches people the app is not for them.
 *
 * **Nothing about anybody being served belongs here** [invariant 1]. That cannot be enforced
 * on free text, so the screen guides rather than pretends — the same as `Query`.
 */
export interface ResupplyPayload {
  text: string;
  /** Coarse, like everywhere else. Helps whoever restocks know which stash it is. */
  area?: string;
}

export interface DistressAckPayload {
  distress_id: string;
}

export type SignalPayload =
  | OnStationPayload
  | QueryPayload
  | AssistPayload
  | LogReviewPayload
  | ResupplyPayload
  | DistressAckPayload
  | Record<string, never>;

/** Response windows, in seconds. Surfaced to the operator rather than hidden. */
export const RESPONSE_WINDOW: Record<SignalType | 'distress', number | null> = {
  'on-station': 60,
  routine: 60,
  query: 120,
  assist: 300,
  'stood-down': 60,
  // Not urgent. It is a records request, and nobody is in the street waiting on it.
  'log-review': 120,
  // Acknowledging is the fastest thing in the system: it is one tap, and somebody is
  // waiting on it in a way they are not waiting on anything else.
  'distress-ack': 10,
  /**
   * The longest window in the table, on purpose.
   *
   * Nobody is waiting in the street on a resupply. It is still acknowledged, because every
   * signal here is acknowledged and silence is never a response — but the window says
   * plainly that this is the least urgent thing an operator can send, and it must never
   * compete for attention with something that is not.
   */
  resupply: 600,
  distress: null
};

export class SignalError extends Error {}

/**
 * Refuses text longer than a person writes.
 *
 * At the boundary rather than on the input, because a `maxlength` stops only the operator
 * who typed it — not a relay, a fork, or a restored backup.
 */
export function checkedText(payload: SignalPayload | DistressPayload): void {
  const text = (payload as { text?: unknown }).text;
  if (text !== undefined && text !== null && !withinLimit(text, TEXT_MAX)) {
    throw new SignalError(`Keep it to ${TEXT_MAX} characters.`);
  }
  // The field beside it, missed the first time. A Distress carries both.
  const area = (payload as { area?: unknown }).area;
  if (area !== undefined && area !== null && !withinLimit(area, AREA_MAX)) {
    throw new SignalError(`An area is ${AREA_MAX} characters or fewer — a district, never an address.`);
  }
}

export function buildSignal(
  secret: SecretKey,
  to: WatchtowerAddress,
  type: SignalType,
  payload: SignalPayload,
  createdAt: number
) {
  checkedText(payload);
  return {
    kind: KIND_SIGNAL,
    created_at: createdAt,
    // The type is an unencrypted tag so a client can filter without decrypting; the payload
    // is sealed to whoever holds the watch, which is one key for a box and one per phone
    // for a squad. Always the group envelope, even for one holder -- two shapes would let
    // anyone watching a relay sort Watchtowers into "box" and "squad" without decrypting.
    tags: [tagRecipient(to.pubkey), tagSignalType(type)],
    content: sealToGroup(secret, to.holders, payload, to.kem)
  };
}

/**
 * Distress gets its own kind so it is never queued behind routine traffic.
 *
 * It is **always deliberate** — never inferred from silence, a missed window or inactivity
 * [invariant 3]. Nothing in this module can construct one from a timer, and nothing should
 * be added that can.
 */
export function buildDistress(
  secret: SecretKey,
  to: WatchtowerAddress,
  payload: DistressPayload,
  createdAt: number
) {
  checkedText(payload);
  return {
    kind: KIND_DISTRESS,
    created_at: createdAt,
    // No `t` tag: distress is identified by its kind, not by a filterable label, so it
    // cannot be missed by a subscriber filtering on signal types.
    tags: [tagRecipient(to.pubkey)],
    content: sealToGroup(secret, to.holders, payload, to.kem)
  };
}
