/**
 * Responses — kind 20912.
 *
 * Every signal gets one, even if it is only receipt. **Silence is never an answer.**
 *
 * Normative source: docs/spec/signals.spec.md
 */

import { seal } from '../crypto/envelope.js';
import type { SecretKey } from '../crypto/keys.js';
import type { Author } from '../attestation.js';
import type { LogEntry } from '../log.js';
import type { InclusionProof, LogRoot } from '../merkle.js';
import { KIND_RESPONSE, tagInReplyTo, tagRecipient } from './kinds.js';

export type ResponseType =
  | 'ack'
  | 'answer'
  | 'escalation-status'
  | 'log-review'
  /**
   * *"Nobody is coming."*
   *
   * An `assist` means **I need someone**, and until this existed a watch could only
   * acknowledge one. An operator who asked for help, got "received", and waited is in the
   * same position as one who was told help was on the way — which is invariant 2's failure
   * shape, one rung down from `Distress`.
   *
   * A watch that cannot send anybody has to be able to say so. That is not a judgement
   * about the request; it is a fact about capacity, and an operator can act on it. They
   * cannot act on silence.
   *
   * **Never valid in reply to a `Distress`.** `Distress` terminates in a human or reports
   * that it could not [invariant 2], and that reporting is the escalation ladder's job, in
   * its own `escalation-status`. A watch able to decline one could end it with a tap.
   * `declineIsValid` enforces this, and it is a function rather than a comment so that a
   * client cannot express the invalid case by accident.
   */
  | 'declined';

/**
 * Whether *"nobody is coming"* may be said in reply to this kind of signal.
 *
 * The check lives in core rather than in a screen, so every client inherits it and no
 * second surface can forget. It refuses `distress` and refuses an unknown type — an
 * unrecognised signal is not a licence to decline it.
 */
export function declineIsValid(replyingTo: string): boolean {
  return replyingTo === 'assist' || replyingTo === 'query';
}

/** Which record an answer came from, verified when, and how. */
export interface Provenance {
  record_id: string;
  verified: string | null;
  method: string | null;
}

export interface ResponsePayload {
  type: ResponseType;
  /**
   * Who answered — an author, not a name the node picked.
   *
   * `kind` MUST be accurate: an operator must never be uncertain whether they are talking
   * to a person. Where `sig` is absent, the Watchtower is speaking on the responder's
   * behalf, and a consumer may treat that as weaker than a signed answer.
   */
  responder: Author;
  text: string | null;
  /** Present on any directory-derived answer. Absent means the client renders unverified. */
  provenance: Provenance | null;
  /**
   * The answer to a `log-review`, and only ever about the operator who asked.
   *
   * `root` is the commitment the proofs are against. **A client MUST check it against a
   * root it saw published itself** — a root supplied alongside the proofs it validates is
   * the watch marking its own homework, and proves nothing on its own.
   */
  review?: LogReview;
  /** Hex signature by `responder`, where they signed for themselves. */
  sig?: string;
}

export interface LogReview {
  root: LogRoot;
  entries: { entry: LogEntry; proof: InclusionProof }[];
  /** True when the node held more than it sent. Paging exists because relays cap message size. */
  more: boolean;
  /**
   * What the escalation executor's own log says, if the daemon has been told where to find
   * it. Absent when not configured -- most deployments today don't set this.
   *
   * A separate chain with its own root, and **this device has no way to independently
   * verify that root yet**: nothing publishes it anywhere, unlike the primary review's root
   * (published on `10910`). `checkReview` run against it will honestly report
   * `root-not-seen` — not a bug, the accurate reflection of what is and isn't checkable
   * today. Publishing this root too is real, separate, future work.
   */
  escalation?: Omit<LogReview, 'escalation'>;
}

export function buildResponse(
  secret: SecretKey,
  operatorPubkey: string,
  inReplyTo: string,
  payload: ResponsePayload,
  createdAt: number
) {
  return {
    kind: KIND_RESPONSE,
    created_at: createdAt,
    tags: [tagRecipient(operatorPubkey), tagInReplyTo(inReplyTo)],
    content: seal(secret, operatorPubkey, payload)
  };
}

/**
 * How a client must present an answer.
 *
 * An answer without provenance renders as **unverified** — not as a plain answer with a
 * missing badge. A confident wrong answer at 10pm is the worst failure available to this
 * system, and it is worse coming from an agent because it carries unearned authority.
 */
export function isUnverified(payload: ResponsePayload): boolean {
  return payload.type === 'answer' && payload.provenance === null;
}
