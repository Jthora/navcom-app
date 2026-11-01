import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import type { SecretKey } from '../crypto/keys.js';
import { KIND_CREDENTIAL, KIND_CLAIM, KIND_REVOCATION } from './kinds.js';
import { CALLSIGN_MAX, withinLimit } from '../limits.js';

/**
 * Vouching for somebody, without creating a record of them.
 *
 * An endorsement is an attestation whose subject happens to be a person: a claim, its author,
 * and a scope tag — **signed, and held by the recipient rather than indexed anywhere.**
 *
 * ## The credential names nobody
 *
 * This is the part that decides everything else, and it is not an optimisation. A credential
 * reads *"I vouch for the holder of this"* — it carries a scope and a date and **no subject
 * at all**, and it binds to whatever persona claims it.
 *
 * So an endorser can never create a record naming a person who has not agreed to exist in
 * this system. The consent problem is resolved at its root rather than managed, and you can
 * vouch for somebody who has never opened the app.
 *
 * What follows from it, rather than needing its own argument:
 *
 * - **No central social graph.** Nobody, including us, can query who knows whom. There is
 *   nothing to breach, sell, subpoena or leak
 * - **Verification is local and offline.** You present; my device checks signatures. No
 *   network, no lookup, no server
 * - **Provenance by name, never a count.** You trust somebody because you recognise who
 *   vouched for them. A tally can be manufactured; a recognised author cannot
 *
 * ## The cost, stated
 *
 * A credential that names nobody is a **bearer token**: whoever holds the bytes can claim
 * it. Somebody who intercepts an unclaimed one before its intended recipient becomes its
 * holder, and the endorser cannot see that it happened — they cannot see whether it was
 * claimed at all.
 *
 * That is the price of not naming people, and this design pays it deliberately. It is
 * survivable because a credential is handed over the way everything else here is: in person,
 * or through whatever the two of them already use.
 *
 * ## Age rather than expiry
 *
 * A credential carries the date it was written and nothing expires on a timer. Somebody
 * endorsed `medic` five years ago is a fact about five years ago, and this system already
 * has one way of handling that: **show the age and let the reader weigh it**, exactly as the
 * directory does. Inventing an expiry would be a second rule for the same problem.
 *
 * Withdrawal is explicit — an endorser publishes a revocation, checked when online. An
 * endorser retracting their own claim is not an appeal, and creates no adjudication between
 * anybody [`declined.md`].
 *
 * Normative source: docs/product/identity.md
 */

/**
 * What an endorsement can say. **Never free text.**
 *
 * An endorser explaining *why* somebody is credible is how an operator's history leaks —
 * and the person with the most valuable knowledge is usually the one with the most to lose
 * from having it described.
 */
export const SCOPES = [
  'worked-with',
  'reliable',
  'de-escalation',
  'medic',
  'logistics',
  /** The cleanest route to first standing for somebody who has nothing yet. */
  'trained-with-me',
  /** The qualification for holding a board. See docs/watch/the-watch.md. */
  'can-take-watch'
] as const;
export type Scope = (typeof SCOPES)[number];

export class EndorsementError extends Error {}

export interface CredentialPayload {
  scope: Scope;
  /** What the endorser calls themselves: their choice [invariant 6]. */
  endorser: string;
  /** ISO date. Shown as an age rather than checked against a clock. */
  at: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date that is actually a date.
 *
 * The pattern above checks the **shape** and nothing else, so `2026-13-45` passed it — a
 * hand-rolled client could put a month thirteen on a credential, and the screen that renders
 * *"N days ago"* rendered `NaN days ago`. A date that is not a date is not a weak claim about
 * when somebody vouched; it is not a claim at all.
 */
function realDate(iso: string): boolean {
  if (!ISO_DATE.test(iso)) return false;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso;
}

/**
 * Writes a credential.
 *
 * Not published. It is handed to somebody however the two of them already talk — this app
 * holds no contact details and therefore cannot deliver anything itself, which is a property
 * rather than a gap.
 */
export function writeCredential(
  endorserSecret: SecretKey,
  payload: CredentialPayload,
  createdAt: number
): Event {
  if (!SCOPES.includes(payload.scope)) throw new EndorsementError('Unknown scope.');
  if (!withinLimit(payload.endorser, CALLSIGN_MAX)) {
    throw new EndorsementError(`A credential needs a callsign of ${CALLSIGN_MAX} characters or fewer.`);
  }
  if (!realDate(payload.at)) throw new EndorsementError('`at` must be a real date, as YYYY-MM-DD.');

  return finalizeEvent(
    {
      kind: KIND_CREDENTIAL,
      created_at: createdAt,
      // No `p` tag, and there must never be one. A recipient tag would name the person this
      // is about, which is the whole thing this design refuses to do.
      tags: [],
      content: JSON.stringify({
        scope: payload.scope,
        endorser: payload.endorser.trim(),
        at: payload.at
      })
    },
    endorserSecret
  );
}

/**
 * Takes up a credential, binding it to this persona.
 *
 * Claiming needs no account, no approval and no network. The claim is a signature over the
 * credential's id, so presenting the pair proves both *somebody vouched for this* and *I am
 * the one holding it*.
 */
export function claimCredential(
  holderSecret: SecretKey,
  credential: Event,
  createdAt: number
): Event {
  if (credential.kind !== KIND_CREDENTIAL) throw new EndorsementError('Not a credential.');
  if (!verifyEvent(credential)) throw new EndorsementError('That credential is not signed.');

  return finalizeEvent(
    {
      kind: KIND_CLAIM,
      created_at: createdAt,
      tags: [['e', credential.id]],
      content: ''
    },
    holderSecret
  );
}

export interface Endorsement {
  scope: Scope;
  /** The callsign that vouched, as they wrote it. */
  endorser: string;
  /** The endorser's key, so a reader can recognise somebody they have met. */
  endorserKey: string;
  /** ISO date it was written. Rendered as an age, never checked against a clock. */
  at: string;
  /** The persona presenting it. */
  holder: string;
  /** The credential's id, which is what a revocation names. */
  id: string;
}

/**
 * Reads a presented pair, or returns null.
 *
 * Checks both signatures and that the claim is over *this* credential. Offline, always —
 * there is nothing to look up, which is the point.
 */
export function readEndorsement(credential: Event, claim: Event): Endorsement | null {
  if (credential.kind !== KIND_CREDENTIAL || claim.kind !== KIND_CLAIM) return null;
  if (!verifyEvent(credential) || !verifyEvent(claim)) return null;
  if (claim.tags.find((t) => t[0] === 'e')?.[1] !== credential.id) return null;

  try {
    const p = JSON.parse(credential.content) as Partial<CredentialPayload>;
    if (typeof p.scope !== 'string' || !SCOPES.includes(p.scope as Scope)) return null;
    if (!withinLimit(p.endorser, CALLSIGN_MAX)) return null;
    if (typeof p.at !== 'string' || !realDate(p.at)) return null;

    return {
      scope: p.scope as Scope,
      endorser: p.endorser,
      endorserKey: credential.pubkey,
      at: p.at,
      holder: claim.pubkey,
      id: credential.id
    };
  } catch {
    return null;
  }
}

/**
 * Withdraws a credential.
 *
 * Published, unlike the credential itself, because a reader has to be able to find it — and
 * a revocation names only the credential, so publishing one still reveals nobody.
 *
 * **This is an endorser retracting their own claim, not an appeal.** Nobody adjudicates
 * between two operators here and nobody is asked to.
 */
export function revoke(endorserSecret: SecretKey, credentialId: string, createdAt: number): Event {
  return finalizeEvent(
    {
      kind: KIND_REVOCATION,
      created_at: createdAt,
      tags: [['d', credentialId]],
      content: ''
    },
    endorserSecret
  );
}

/**
 * Whether a revocation actually withdraws this endorsement.
 *
 * **Only the original endorser can revoke.** Anybody may publish an event claiming to; a
 * reader checks that the key matches the one that wrote the credential, so a stranger cannot
 * strip somebody's standing by asserting it.
 */
export function isRevokedBy(endorsement: Endorsement, revocation: Event): boolean {
  if (revocation.kind !== KIND_REVOCATION) return false;
  if (revocation.pubkey !== endorsement.endorserKey) return false;
  if (revocation.tags.find((t) => t[0] === 'd')?.[1] !== endorsement.id) return false;
  return verifyEvent(revocation);
}
