import { finalizeEvent, generateSecretKey, verifyEvent } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import { open, seal } from '../crypto/envelope.js';
import type { SecretKey } from '../crypto/keys.js';
import { KIND_INVITE, tagRecipient } from './kinds.js';
import { CALLSIGN_MAX, withinLimit } from '../limits.js';

/**
 * *"Here is my key. I would like to pair."*
 *
 * The fix for cold start. Until this existed the only way to pair was to stand next to
 * somebody, which serves a squad that already knows each other and nobody else — and the
 * operator this project is actually built around is the one who knows nobody.
 *
 * ## An accept is an invite in the other direction
 *
 * There is one message here, not three. A sends an invite to B; if B wants it, B sends an
 * invite back to A. Pairing is complete when each holds the other's key.
 *
 * That shape is not a shortcut, it is the reason declining is free:
 *
 * - **There is no decline message, and there cannot be one.** Ignoring an invite sends
 *   nothing, so a sender learns nothing — not that it was read, not that it was refused,
 *   not that the key is live. Somebody who owes a refusal is somebody who accepts to avoid
 *   an awkward one, and this is the same rule as `unpair` sending nothing
 * - There is no pending state on the sender's device to manage, expire or nag about, and
 *   nothing anywhere to show a *"waiting on Raven"* line
 *
 * ## Which key an invite is addressed to
 *
 * The first one goes to a **contact key** read off a public card. The reply goes to the
 * sender's **operational key**, which the first invite carried inside its ciphertext. So an
 * operator's working key reaches only people they chose to write to, and a card never
 * exposes it — see `events/public.ts` for why that separation is load-bearing.
 *
 * ## The wrapper
 *
 * Same shape as peer presence: a throwaway key signs the outer event, the sealed content is
 * a complete event signed by the sender's real key. A relay storing invites therefore
 * learns who has an inbox and roughly how busy it is, and nothing about who is writing to
 * whom. The inner signature is what proves the key being offered actually belongs to the
 * person offering it — a payload that merely states a pubkey can state anybody's.
 *
 * Normative source: docs/spec/signals.spec.md
 */

export interface InvitePayload {
  /** What the sender calls themselves. The recipient may rename them on accepting. */
  callsign: string;
  /**
   * A line saying who you are, since a stranger has no reason to recognise a callsign.
   *
   * Nothing about anybody being served may appear here [invariant 1]. That cannot be
   * enforced on free text, so the screen guides rather than pretends.
   */
  note?: string;
  /**
   * The invite this one answers, whole: the asker's own signed event, which only the holder of the
   * card it was sealed to could open.
   *
   * An accept is an invite in the other direction, so the asker had to accept the answer too, and a
   * newcomer told "they will appear on Peers" waited on a pairing one tap short [journey,
   * 2026-10-28]. Carrying the request back proves, with no pending state on the asker's phone, that
   * this answers *their* request to *that* card: the asker checks their own signature, and nobody but
   * the card's holder could have read what they signed. A build that does not know this field reads
   * an ordinary invite, and the asker accepts it as before.
   */
  answers?: Event;
}

export const NOTE_MAX = 280;
/** More than any invite this builds, with its note: an answer carries one whole. */
const ANSWERS_MAX = 4096;

export class InviteError extends Error {}

/**
 * Wraps an invite for one recipient.
 *
 * `to` is a contact key when answering a card, or an operational key when replying to an
 * invite. This function does not know or care which — the distinction is the caller's, and
 * lives in the store that decides where a key came from.
 */
export function buildInvite(
  secret: SecretKey,
  to: string,
  payload: InvitePayload,
  createdAt: number,
  /** Their published ML-KEM key, where we have it. Classical cover without. */
  recipientKem?: string
): Event {
  const callsign = payload.callsign.trim();
  if (!withinLimit(callsign, CALLSIGN_MAX)) {
    throw new InviteError(`An invite needs a callsign of ${CALLSIGN_MAX} characters or fewer.`);
  }
  const note = payload.note?.trim();
  if (note && note.length > NOTE_MAX) throw new InviteError(`Keep it to ${NOTE_MAX} characters.`);

  const content: InvitePayload = { callsign };
  if (note) content.note = note;
  if (payload.answers) content.answers = payload.answers;

  // The real message, signed by the operational key. Never published as-is: the whole
  // point of an invite is to hand over that key, and the outside of the envelope is the
  // one place it must not be.
  const inner = finalizeEvent(
    {
      kind: KIND_INVITE,
      created_at: createdAt,
      tags: [tagRecipient(to)],
      content: JSON.stringify(content)
    },
    secret
  );

  const ephemeral = generateSecretKey();
  return finalizeEvent(
    {
      kind: KIND_INVITE,
      created_at: createdAt,
      tags: [tagRecipient(to)],
      content: seal(ephemeral, to, inner, recipientKem)
    },
    ephemeral
  );
}

export interface Invite {
  /** The operational pubkey being offered, proven by the inner signature rather than claimed. */
  from: string;
  payload: InvitePayload;
  at: number;
  /** The signed invite itself, for an accept to carry back [`InvitePayload.answers`]. */
  inner: Event;
  /**
   * Who asked, where this answers an invite: the pubkey that signed the request it carries, checked.
   * Null for an invite that answers nothing, or carries something that is not a signed invite.
   */
  answering: string | null;
}

/** Who signed the invite an answer carries, if it is one: a signed invite, and small. */
function answered(request: unknown): string | null {
  if (request === undefined || request === null || typeof request !== 'object') return null;
  const event = request as Event;
  try {
    if (JSON.stringify(event).length > ANSWERS_MAX) return null;
    if (event.kind !== KIND_INVITE || !verifyEvent(event)) return null;
  } catch {
    return null;
  }
  return event.pubkey;
}

/**
 * Opens an invite addressed to one of our keys.
 *
 * `secret` is whichever key it was sent to — the contact key for invites answering a card,
 * the operational key for replies.
 *
 * **Anybody may send one.** There is no allowlist here, unlike `readPresence`, and that
 * asymmetry is deliberate: presence from a stranger puts them on the screen showing who is
 * out, where they could be mistaken for a peer. An invite from a stranger is the feature.
 * What bounds it is that only a published card has a public address at all.
 */
export function readInvite(secret: SecretKey, wrap: Event): Invite | null {
  if (wrap.kind !== KIND_INVITE) return null;

  let inner: Event;
  try {
    inner = open<Event>(secret, wrap.pubkey, wrap.content);
  } catch {
    return null;
  }

  if (!inner || typeof inner !== 'object' || !verifyEvent(inner)) return null;
  if (inner.kind !== KIND_INVITE) return null;

  try {
    const payload = JSON.parse(inner.content) as InvitePayload;
    if (!withinLimit(payload.callsign, CALLSIGN_MAX)) return null;
    if (payload.note !== undefined) {
      if (typeof payload.note !== 'string' || payload.note.length > NOTE_MAX) return null;
    }
    return { from: inner.pubkey, payload, at: inner.created_at, inner, answering: answered(payload.answers) };
  } catch {
    return null;
  }
}
