import { finalizeEvent, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import type { SecretKey } from '../crypto/keys.js';
import { KIND_WATCH_STATE } from './kinds.js';
import { CALLSIGN_MAX, TEXT_MAX, withinLimit } from '../limits.js';
import { darkState, WATCH_STATE_VERSION } from './watch-state.js';

/**
 * A watch key put out of use (2026-11-04, the brief's SC3): a holder removed from a watch still holds
 * its key, and could go on reading what operators send it and answering as the watch.
 *
 * The holder who retires it publishes, under the old key, a Dark state that says so: who retired it,
 * by the name they hold it under, and why, in their own words, with their own holder key's signature
 * over both. That signature is the record of a use of power [the brief's D3 A]: every operator sees
 * whose hand it was and the reason, and a holder cannot retire a watch anonymously.
 *
 * **What it cannot do is stop the old key.** Whoever kept it can publish under it again, and a relay
 * serves the newest. So a phone that has seen a retirement keeps it [web `config.ts`]: that watch is
 * retired there for good, everything later under its key is refused and shown as such, and nothing
 * more is sent to it. The way forward is a new code, from a holder, scanned. A phone that never saw it
 * is as safe as the relay's newest copy, which is why the new code is handed out at once.
 *
 * Additive to `10910`: a build that predates it reads a plain Dark, which is the safe direction.
 */
export interface Retirement {
  /** The holder who retired it, by the name they hold it under. */
  by: string;
  /** Why, in their words. Never about the people served [invariant 1]; the screen guides. */
  reason: string;
}

export interface RetirementRead extends Retirement {
  /** The holder key that signed it: one of the holders this phone's code named. */
  holder: string;
  at: number;
}

/** The tag the holder's statement carries, naming the watch it retires. */
const RETIRES = 'retires';

export class RetirementError extends Error {}

/**
 * The retirement, as the `10910` to publish under the old watch key: a Dark state carrying the holder's
 * own signed statement.
 */
export function buildRetirement(watch: SecretKey, holder: SecretKey, r: Retirement, now: number): Event {
  const by = r.by.trim();
  const reason = r.reason.trim();
  if (!withinLimit(by, CALLSIGN_MAX)) throw new RetirementError('A retirement names who did it.');
  if (!reason) throw new RetirementError('Say why, in your own words: operators are shown it.');
  if (reason.length > TEXT_MAX) throw new RetirementError(`Keep it to ${TEXT_MAX} characters.`);
  const watchPub = getPublicKey(watch);
  const statement = finalizeEvent(
    { kind: KIND_WATCH_STATE, created_at: now, tags: [[RETIRES, watchPub]], content: JSON.stringify({ by, reason }) },
    holder
  );
  const content = { ...darkState(), v: WATCH_STATE_VERSION, since: now, retired: statement };
  return finalizeEvent({ kind: KIND_WATCH_STATE, created_at: now, tags: [], content: JSON.stringify(content) }, watch);
}

/**
 * The retirement a watch state carries, or null: only one signed by a holder this phone was told of,
 * naming this watch, inside a state the watch key itself signed.
 */
export function readRetirement(event: Pick<Event, 'pubkey' | 'content'>, watchPubkey: string, holders: readonly string[]): RetirementRead | null {
  if (event.pubkey !== watchPubkey) return null;
  let statement: unknown;
  try {
    statement = (JSON.parse(event.content) as { retired?: unknown }).retired;
  } catch {
    return null;
  }
  if (!statement || typeof statement !== 'object') return null;
  const s = statement as Event;
  try {
    if (s.kind !== KIND_WATCH_STATE || !verifyEvent(s)) return null;
  } catch {
    return null;
  }
  if (!holders.includes(s.pubkey)) return null;
  if (!s.tags.some((t) => t[0] === RETIRES && t[1] === watchPubkey)) return null;
  try {
    const { by, reason } = JSON.parse(s.content) as Retirement;
    if (typeof by !== 'string' || typeof reason !== 'string' || !withinLimit(by, CALLSIGN_MAX) || !reason.trim() || reason.length > TEXT_MAX) return null;
    return { by, reason, holder: s.pubkey, at: s.created_at };
  } catch {
    return null;
  }
}
