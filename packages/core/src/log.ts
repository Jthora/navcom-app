/**
 * The accountability log.
 *
 * It exists so the watch can be checked — the watch is the highest-privilege position in
 * the system, and [C33] makes its actions reviewable by the operators they concern.
 *
 * **And the watch writes it.** That is a real hole rather than a quibble: a hostile watch
 * that can rewrite its own record defeats the mechanism named as its own mitigation.
 *
 * Three separate problems, closed separately, and the middle one is the load-bearing one:
 *
 *   tampering            — editing history after the fact. Closed here, by chaining, but
 *                          **only for a reader who holds the whole log.**
 *   selective disclosure — handing an operator a filtered view they cannot check. NOT
 *                          closed here. A chain link points at the entry before it in the
 *                          full log, which is usually about somebody else, so a filtered
 *                          view can never verify. Closing it needs inclusion proofs against
 *                          a published root.
 *   fabrication/omission — writing a false entry, or never writing a true one. NOT closed
 *                          here. It needs the subject to counter-sign, which is gated on
 *                          the Watchtower opening past people who were personally vetted.
 *
 * The middle one was found by trying to build the operator's review screen on top of this
 * module: `entriesAbout()` produces exactly the shape `verifyChain()` must reject. The two
 * functions had been written to be used together and could not be. The type system now
 * says so — see `CompleteLog`.
 *
 * Chaining is about twenty lines and makes retroactive edits detectable by whoever can see
 * everything. It does not make a lie impossible, and it does not help the operator on its
 * own. This module does not pretend otherwise.
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import type { Author } from './attestation.js';

export type LogAction =
  | 'took-watch'
  | 'handed-over'
  | 'acked'
  | 'answered'
  | 'marked-overdue'
  | 'contacted'
  | 'escalated'
  | 'drill-run'
  | 'drill-result';

/**
 * What happened, from a fixed set.
 *
 * A free-text outcome is the one field through which an area, a position or a query text
 * could reach a log that MUST NOT contain any of them [C27]. No amount of care at the call
 * sites removes that channel; a union does. If a new outcome is genuinely needed, add it
 * here, where the review is.
 *
 * `contact-not-attempted` is the important one: `agents.md` requires inaction to be logged,
 * and an overdue that passed with nothing done is invisible unless something writes it down.
 */
export type LogOutcome =
  | 'acknowledged'
  | 'answered'
  /** Answered with no provenance. The client renders it unverified; the log records that. */
  | 'answered-unverified'
  | 'no-answer'
  | 'held'
  | 'handed-to-human'
  | 'handed-to-agent'
  | 'went-dark'
  | 'marked-overdue'
  | 'contact-made'
  | 'contact-failed'
  /**
   * The node sent the operator a nudge and does not know whether it landed.
   *
   * Distinct from `contact-made`, which claims the operator was actually reached, and from
   * `contact-failed`, which claims nothing left the machine. Publishing to a relay is
   * neither: the event was accepted by somebody's server, and whether a phone ever pulled
   * it down is unknowable from here.
   *
   * The same distinction `transport.ts` draws for `Distress` — *"a signal that never left
   * the device is a different emergency from one that left and went unanswered"* — and the
   * reason the honest middle value has to exist rather than be rounded to the flattering
   * neighbour.
   */
  | 'contact-attempted'
  | 'contact-not-attempted'
  | 'escalation-reached-human'
  | 'escalation-reached-nobody'
  /**
   * Nothing was tried, because the ladder is not built.
   *
   * Distinct from `escalation-reached-nobody`, which claims an attempt. Every `Distress`
   * writes this until the ladder ships, and it should read as damning, because it is.
   */
  | 'escalation-not-attempted'
  | 'pass'
  | 'fail'
  | 'error';

export interface LogEntry {
  /** Unix seconds. */
  at: number;
  /** Who acted. */
  actor: Author;
  action: LogAction;
  /**
   * The operator this concerns, if any.
   *
   * An `Author`, not a callsign — callsigns are not unique. There is no registry, so two
   * operators can both be Raven, and keying the record that holds the watch accountable on
   * a non-unique name would attribute one person's entries to another. Matching is by
   * pubkey; the callsign rides along for reading.
   */
  subject: Author | null;
  outcome: LogOutcome;
  /**
   * Hex sha256 over this entry plus the previous hash. An edit anywhere breaks every
   * link after it.
   */
  hash: string;
  /** The entry before this one. Null only for the first. */
  prev: string | null;
  /**
   * Signature by the **subject**, confirming this is what happened to them.
   *
   * Absent everywhere today. When present it turns an entry from the watch's account of
   * itself into something the affected operator agreed with.
   */
  countersig?: string;
}

/**
 * A complete, contiguous log — every entry, in order, from a declared genesis.
 *
 * Distinct from `LogEntry[]` on purpose. `verifyChain()` accepts only this, so
 * `verifyChain(entriesAbout(log, me))` is a **type error** rather than a plausible-looking
 * call that always returns `intact: false`. That was a real mistake waiting to be made:
 * both functions existed, read as though they composed, and did not.
 */
export type CompleteLog = readonly LogEntry[] & { readonly __complete: unique symbol };

/**
 * Asserts that these entries are a complete log — typically straight after reading the
 * node's log file.
 *
 * The assertion is explicit and greppable because it cannot be checked here: a file that
 * has silently lost its tail still parses. `verifyChain()` is what tests the claim.
 */
export function asCompleteLog(entries: readonly LogEntry[]): CompleteLog {
  return entries as CompleteLog;
}

/** Never positions, areas or query text [C27]. The log records actions, not movements. */
export type NewEntry = Omit<LogEntry, 'hash' | 'prev' | 'countersig'>;

const GENESIS = null;

function digest(entry: NewEntry, prev: string | null): string {
  // Field order is fixed so the same entry always hashes the same way.
  const canonical = JSON.stringify([
    entry.at,
    entry.actor.kind,
    entry.actor.callsign ?? null,
    entry.actor.pubkey ?? null,
    entry.action,
    entry.subject?.kind ?? null,
    entry.subject?.callsign ?? null,
    entry.subject?.pubkey ?? null,
    entry.outcome,
    prev
  ]);
  return bytesToHex(sha256(utf8ToBytes(canonical)));
}

/**
 * Recomputes the hash an entry claims, from its content and its stated `prev`.
 *
 * Exported so a reader holding a single entry can check it without the rest of the log —
 * which is precisely what an operator reviewing their own entries has.
 */
export function entryHashInput(entry: LogEntry): string {
  return digest(entry, entry.prev);
}

export function appendEntry(log: CompleteLog, entry: NewEntry): CompleteLog {
  const prev = log.length === 0 ? GENESIS : log[log.length - 1].hash;
  return asCompleteLog([...log, { ...entry, prev, hash: digest(entry, prev) }]);
}

/** An empty log, before anything has happened. */
export function emptyLog(): CompleteLog {
  return asCompleteLog([]);
}

export interface ChainCheck {
  intact: boolean;
  /** Index of the first entry that does not verify, or -1. */
  brokenAt: number;
  reason: string | null;
}

export interface VerifyOptions {
  /**
   * What the first entry's `prev` should be.
   *
   * `null` for a log that still has its original genesis. After retention drops old
   * entries, the oldest surviving entry points at a hash that no longer exists — which is
   * indistinguishable from tampering unless the node declares the new start. Rotation
   * records that hash; verification is given it here.
   */
  startsAt?: string | null;
}

/**
 * Verifies the chain.
 *
 * An operator reviewing entries about themselves can run this and know whether the record
 * has been edited since it was written — without trusting the party that wrote it.
 */
export function verifyChain(log: CompleteLog, opts: VerifyOptions = {}): ChainCheck {
  let prev: string | null = opts.startsAt ?? GENESIS;
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    if (e.prev !== prev) {
      return { intact: false, brokenAt: i, reason: 'entry does not follow the one before it' };
    }
    if (digest(e, prev) !== e.hash) {
      return { intact: false, brokenAt: i, reason: 'entry content does not match its hash' };
    }
    prev = e.hash;
  }
  return { intact: true, brokenAt: -1, reason: null };
}

/**
 * What an operator sees when reviewing a watch: actions, never a movement history.
 *
 * Matched on pubkey. Passing a callsign would return whatever another Raven did.
 *
 * **The result is not chain-verifiable and the return type says so.** Its links point at
 * entries about other people, which this operator must not see and could not check anyway.
 * Until inclusion proofs ship, an operator reading this is trusting the watch's account of
 * itself — weaker than the spec's table implied, and worth saying on the screen that
 * renders it.
 */
export function entriesAbout(log: CompleteLog, pubkey: string): LogEntry[] {
  return log.filter((e) => e.subject?.pubkey === pubkey);
}
