/**
 * Responses — kind 20912.
 *
 * Every signal gets one, even if it is only receipt. **Silence is never an answer.**
 *
 * Normative source: docs/spec/signals.spec.md
 */

import type { UnsignedEvent } from 'nostr-tools/core';
import { finalizeEvent, getEventHash, verifyEvent } from 'nostr-tools/pure';
import { seal } from '../crypto/envelope.js';
import { isPubkey, publicKeyOf, type SecretKey } from '../crypto/keys.js';
import type { Author } from '../attestation.js';
import type { LadderState } from '../escalation.js';
import type { LogEntry } from '../log.js';
import type { InclusionProof, LogRoot } from '../merkle.js';
import { KIND_ANSWER_SIGNATURE, KIND_RESPONSE, tagInReplyTo, tagRecipient } from './kinds.js';

export type ResponseType =
  | 'ack'
  | 'answer'
  | 'escalation-status'
  | 'log-review'
  /**
   * *"You are past the time you gave."*
   *
   * The **only** thing a node sends an operator without being asked, and it exists because
   * `watch-state.spec.md` requires it: on crossing overdue grace the node MUST mark the
   * entry, make it visible to whoever holds watch, **and attempt contact with the
   * operator**. The first two shipped; the third logged `contact-not-attempted` for months
   * with a comment saying it should read badly until it stopped being true.
   *
   * **This is not an alarm, and the distinction is the whole design.** It goes to the
   * operator themselves, never to a third party — nobody else is told, nothing is paged,
   * no ladder starts, and the same spec paragraph forbids all three [C4, invariant 3].
   * A watch that could raise somebody else on a missed window would be inferring duress
   * from silence, which is the one thing this system will never do. Asking the person
   * *"are you still out?"* is the opposite: it resolves the ambiguity by consulting the
   * only individual who actually knows.
   *
   * It needs no new signal to answer it. `routine` says still out, `stood-down` says home,
   * and both already clear the overdue. The text points at controls that exist.
   *
   * **The terminal must not notify on it.** The field terminal is silent, and
   * `/terminal/on-call/` states in-product that a `Distress` page is the only notification
   * NavCom ever sends. This arrives and waits to be looked at, like everything else here.
   */
  | 'contact'
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
  /**
   * Where the escalation ladder is, on a response the escalation executor sends.
   *
   * Structured so a phone never has to parse English to learn the one thing it must act on:
   * `exhausted` means nobody on call answered and nobody is left to try. Before this existed
   * the ladder said so only in `text`, and the operator's phone filed the whole response under
   * "an agent answered" — so the watch's own *nobody is coming* never reached the screen, and
   * the operator learned it ten minutes later from the phone's own timer.
   */
  ladder?: LadderState;
  /**
   * `responder`'s own signature on this answer, where they signed for themselves: 128 hex characters,
   * the BIP-340 signature on the never-published event {@link answerSignatureEvent} builds, with
   * `responder.pubkey` as its signer.
   *
   * **What ends a `Distress` on a squad's watch** [`signals.spec.md`, *The answer signature*]. Every
   * member holds the watch key, and so does everybody who ever did, so a `20912` that key signs says
   * only that somebody who once held the watch sent it. A squad member's answer is signed by their own
   * key as well, bound to the operator, the watch, the ids it answers and its words, and an operator's
   * phone ends a `Distress` on it only when that key is one of the holders it was handed.
   */
  sig?: string;
  /**
   * The id of the `20912` the escalation executor signed with its own key, where this is the watch
   * key's copy of it.
   *
   * A box whose executor has its own key sends each response twice: signed by that key, and the same
   * words signed by the watch key, for phones handed the watch before it named the executor. A phone
   * that knows the executor's key and has heard that event already passes over the copy; one that
   * has not reads the copy as the watch key's like any other, and it never ends a `Distress` there.
   */
  copy_of?: string;
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

/** The watch key's copy of a response the executor signed with its own key, as `copy_of` describes. */
export function watchCopy(payload: ResponsePayload, executorEventId: string): ResponsePayload {
  return { ...payload, copy_of: executorEventId };
}

/**
 * What an answer signature is about: the watch it is given for, the operator it answers, and the
 * `20911` ids it answers — the `e` tags of the `20912` that carries it.
 */
export interface AnswerAbout {
  watch: string;
  operator: string;
  ids: readonly string[];
}

/** Pins the construction, so these words signed for anything else are not this. */
const ANSWER_SIGNATURE_V1 = 'navcom-answer-v1';

/**
 * The never-published event whose signature is an answer's `sig` [`signals.spec.md`, *The answer
 * signature*]. Normative, because a second implementation has to build the same bytes:
 *
 * - `kind` {@link KIND_ANSWER_SIGNATURE}, `created_at` 0, no tags, `pubkey` the signer
 * - `content` the JSON array, as `JSON.stringify` writes it: `"navcom-answer-v1"`, the watch's
 *   pubkey and the operator's (lower-case hex), the ids (each once, sorted), then the answer's
 *   `type`, `responder.kind`, `responder.callsign`, `text` and `ladder`, each `null` where absent
 *
 * So the signature is bound to who it answers, through which watch, which `Distress` attempts, and
 * every word the operator is shown. Nothing in it can be moved to another operator, another attempt
 * or other words without the signature failing. Its id and signature are nostr's own (NIP-01), so
 * any nostr library checks it.
 */
export function answerSignatureEvent(about: AnswerAbout, payload: ResponsePayload, signer: string): UnsignedEvent {
  const ids = [...new Set(about.ids)].sort();
  const or = (v: unknown) => (v === undefined ? null : v);
  return {
    kind: KIND_ANSWER_SIGNATURE,
    pubkey: signer,
    created_at: 0,
    tags: [],
    content: JSON.stringify([
      ANSWER_SIGNATURE_V1,
      about.watch.toLowerCase(),
      about.operator.toLowerCase(),
      ids,
      or(payload.type),
      or(payload.responder?.kind),
      or(payload.responder?.callsign),
      or(payload.text),
      or(payload.ladder)
    ])
  };
}

/**
 * A squad member's answer, signed for themselves: `responder.pubkey` set to their own key, and `sig`
 * their signature on it.
 *
 * For the phone holding the watch. The `20912` is still signed by the watch key and sealed to the
 * operator as before, so a relay learns nothing new; this rides inside it. `about.ids` are the ids
 * that `20912` names in its `e` tags, and nothing else.
 *
 * **It is a signature, so it can be shown to others.** Anybody who can open that `20912` — the
 * operator's phone, whoever seizes it, and everybody who holds or ever held the watch key — can
 * rebuild {@link answerSignatureEvent} and present it: an event this member's key signed, naming the
 * operator, the watch, the `Distress` ids, their callsign and their words [`signals.spec.md`, *The
 * answer signature*]. That is what lets a person stand behind an answer, and it is also all it says.
 */
export function signAnswer(holder: SecretKey, about: AnswerAbout, payload: ResponsePayload): ResponsePayload {
  const pubkey = publicKeyOf(holder);
  const { sig: _old, ...rest } = payload;
  const unsigned: ResponsePayload = { ...rest, responder: { ...payload.responder, pubkey } };
  const signed = finalizeEvent(answerSignatureEvent(about, unsigned, pubkey), holder);
  return { ...unsigned, sig: signed.sig };
}

const SIG_HEX = /^[0-9a-f]{128}$/;

/**
 * Whether `sig` is `responder.pubkey`'s own signature on this answer, about these ids.
 *
 * It says whose signature it is, never whether that key may close anything: the caller checks the
 * key against the holders it was handed. Anything malformed — no key, no signature, a key that is not
 * one, a signature over other words or other ids — is false, never a throw.
 */
export function answerSignedByResponder(about: AnswerAbout, payload: ResponsePayload): boolean {
  const signer = payload?.responder?.pubkey;
  const sig = payload?.sig;
  if (typeof signer !== 'string' || !isPubkey(signer) || typeof sig !== 'string' || !SIG_HEX.test(sig)) return false;
  try {
    const event = answerSignatureEvent(about, payload, signer);
    return verifyEvent({ ...event, id: getEventHash(event), sig });
  } catch {
    return false;
  }
}
