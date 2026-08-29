import { nip44 } from 'nostr-tools';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { HOLDERS_MAX } from '../limits.js';
import type { SecretKey } from './keys.js';
import { hybridOpen, hybridSeal, kemPublicFromHex, type Cover } from './pq.js';

/**
 * Sealing one payload so several people can read it.
 *
 * A box holds one Watchtower key. A squad with no box holds the watch on whichever phone is
 * awake, and hands it on — and until this existed, that meant every member sharing one
 * secret forever. Sharing a secret is not a membership model: nobody can be removed, adding
 * somebody means passing a key around again, and the only way to end it is to abandon the
 * Watchtower and re-provision everyone.
 *
 * ## How
 *
 * The payload is encrypted **once**, under a fresh random key. That key is then wrapped
 * separately for each holder. A squad of four costs one encryption and four wraps of 32
 * bytes each, not four encryptions of the whole message — which matters, because the
 * highest-volume thing on this wire is a heartbeat from a phone on a cheap plan.
 *
 * Nothing new is invented. The content key is an ordinary secp256k1 secret and every
 * encryption here is NIP-44 from nostr-tools, the reference implementation. This project
 * does not ship its own cryptography on a boundary protecting people at risk.
 *
 * ## What a relay can see, and what it cannot
 *
 * **No pubkeys appear in the envelope.** The wraps are an unlabelled list, and a reader
 * simply tries them until one opens — four attempts for a squad of four, which is nothing.
 * Labelling them by recipient would publish the squad roster to a public relay, which is
 * the same social-graph mistake `events/presence.ts` spends a throwaway key per message to
 * avoid.
 *
 * **The number of wraps is visible**, and that is stated rather than hidden: a relay can
 * count them and learn how many people hold a watch. It learns no identities and no names.
 * Padding the list to a fixed size would buy little and cost bytes on every message, so it
 * is not done — but if it ever matters, this is the file.
 *
 * A single-holder Watchtower produces **exactly the same shape** as a squad-held one, with a
 * list of length one. That is deliberate: two shapes would let anyone watching a relay sort
 * Watchtowers into "box" and "squad" without decrypting anything.
 *
 * ## Membership is not retroactive, and cannot be made so
 *
 * Removing somebody stops them reading **future** messages. Every message already sent was
 * sealed with a content key they were given, and no wording anywhere may imply otherwise.
 *
 * Normative source: docs/spec/signals.spec.md
 */

/**
 * Where a signal goes, and who can actually read it.
 *
 * These are two different things and conflating them is how a squad-held watch quietly
 * becomes readable by one key again. The `pubkey` is the **address** — the `p` tag a relay
 * routes on, and the identity the watch signs as. `holders` is **who holds the watch**: one
 * key for a box, one per phone for a squad.
 *
 * It is a type rather than two parameters so that passing an address where a holder list
 * belongs is a compile error. The same reasoning as `CompleteLog`: a rule the compiler
 * enforces is a rule, and one written in a comment is a hope.
 */
export interface WatchtowerAddress {
  /** The `p` tag. What a relay routes on. */
  pubkey: string;
  /** Whose keys the payload is sealed to. Never empty. */
  holders: readonly string[];
  /**
   * Published ML-KEM public keys, by holder pubkey, where this device has fetched one.
   *
   * A holder absent from this map gets classical cover, and the sender is told
   * [`crypto/pq.ts`]. Optional so that nothing breaks for a caller that has fetched none.
   */
  kem?: Readonly<Record<string, string>>;
}

/**
 * A Watchtower address.
 *
 * With no holders given, the address is its own holder — the box case, where the node holds
 * the Watchtower key itself. A squad passes the member list.
 */
export function watchtowerAt(
  pubkey: string,
  holders?: readonly string[],
  kem?: Readonly<Record<string, string>>
): WatchtowerAddress {
  return { pubkey, holders: holders?.length ? holders : [pubkey], ...(kem ? { kem } : {}) };
}

/** Version tag, so a future format change is a refusal rather than a misparse. */
const V = 1;

interface Envelope {
  v: number;
  /** The payload, encrypted once under the content key. */
  c: string;
  /**
   * The content key, wrapped for each holder. Unlabelled, and in no meaningful order.
   *
   * Each wrap is **self-describing**, so one message can carry hybrid wraps for the holders
   * whose KEM keys this device has and classical wraps for the rest. A squad where one
   * member has not opened the app since the key bundle shipped still receives everything.
   *
   * - `q:<kem ciphertext hex>.<nip44>` — hybrid
   * - `c:<nip44>` — classical
   *
   * A relay can therefore count how many holders have post-quantum cover, on top of the
   * wrap count it could already see. Stated rather than hidden: it is the same class of
   * leak, it names nobody, and the alternative is padding every message forever.
   */
  k: string[];
}

export class GroupSealError extends Error {}

/**
 * Derives the key a content-encrypted payload uses.
 *
 * The content key acts as both halves of its own conversation, so anybody holding it can
 * decrypt without needing to know who sent the message. That matters for handover: a member
 * who joins mid-shift can be given a content key by another member, and it works without
 * reference to the original sender.
 */
const contentKeyFor = (secret: SecretKey): Uint8Array =>
  nip44.getConversationKey(secret, getPublicKey(secret));

/**
 * Seals a payload to every holder.
 *
 * `recipients` is the holder list — one pubkey for a box, one per phone for a squad. An
 * empty list throws rather than producing a message nobody can read, which is the kind of
 * silent failure that turns into an unanswered `Distress`.
 */
export function sealToGroup(
  secret: SecretKey,
  recipients: readonly string[],
  payload: unknown,
  /**
   * Published ML-KEM keys, by recipient pubkey.
   *
   * A recipient missing from this map is sealed to classically. That is a real, supported
   * outcome rather than an error — **the alternative is refusing to send, and the message
   * that would fail to send is a `Distress`.** `coverOf` reports what actually happened so
   * the operator can be told.
   */
  kem: Readonly<Record<string, string>> = {}
): string {
  if (recipients.length === 0) {
    throw new GroupSealError('Nobody to seal to — a message no one can read is not a message.');
  }

  // Deduped rather than refused: a repeated entry is far more likely a pasted list with an
  // accidental repeat than an attack, and a Distress is the one message this must never
  // refuse to send over something this cheap to fix. A duplicate wrap would cost nothing to
  // the sender or reader but would inflate the relay-visible wrap count a hostile relay can
  // already use to guess how many people hold a watch.
  const holders = [...new Set(recipients)];
  if (holders.length > HOLDERS_MAX) {
    throw new GroupSealError(`Too many holders (${holders.length}, max ${HOLDERS_MAX}).`);
  }

  const contentSecret = generateSecretKey();
  const envelope: Envelope = {
    v: V,
    c: nip44.encrypt(JSON.stringify(payload), contentKeyFor(contentSecret)),
    k: holders.map((to) => {
      const theirKem = kem[to];
      if (!theirKem) {
        return `c:${nip44.encrypt(bytesToHex(contentSecret), nip44.getConversationKey(secret, to))}`;
      }
      const wrap = hybridSeal(secret, to, kemPublicFromHex(theirKem));
      return `q:${wrap.kem}.${nip44.encrypt(bytesToHex(contentSecret), wrap.key)}`;
    })
  };
  return JSON.stringify(envelope);
}

/**
 * What cover a set of recipients actually got — `hybrid` only if **every** one did.
 *
 * Deliberately the weakest link rather than an average or a count. One holder without a
 * published key means the content key is sitting in a classical wrap on a public relay, and
 * an operator told "mostly covered" has been told nothing they can use.
 */
export function coverOf(
  recipients: readonly string[],
  kem: Readonly<Record<string, string>> = {}
): Cover {
  return recipients.every((r) => typeof kem[r] === 'string') ? 'hybrid' : 'classical';
}

/**
 * Opens a group-sealed payload, or throws.
 *
 * Tries each wrap in turn. A wrap that is not ours fails to decrypt, which is indisputable
 * and cheap — there is no oracle here to be careful about, because every holder is entitled
 * to know they are a holder.
 */
export function openFromGroup<T = unknown>(
  secret: SecretKey,
  senderPubkey: string,
  envelopeJson: string
): T {
  let envelope: Envelope;
  try {
    envelope = JSON.parse(envelopeJson) as Envelope;
  } catch {
    throw new GroupSealError('Not a sealed envelope.');
  }
  if (!envelope || envelope.v !== V || !Array.isArray(envelope.k) || typeof envelope.c !== 'string') {
    throw new GroupSealError('Not a sealed envelope this version understands.');
  }

  let classical: Uint8Array | null = null;
  for (const wrapped of envelope.k) {
    let contentSecret: SecretKey;
    try {
      if (wrapped.startsWith('q:')) {
        const dot = wrapped.indexOf('.');
        if (dot < 0) continue;
        const key = hybridOpen(secret, senderPubkey, wrapped.slice(2, dot));
        contentSecret = hexToBytes(nip44.decrypt(wrapped.slice(dot + 1), key));
      } else if (wrapped.startsWith('c:')) {
        classical ??= nip44.getConversationKey(secret, senderPubkey);
        contentSecret = hexToBytes(nip44.decrypt(wrapped.slice(2), classical));
      } else {
        continue;
      }
    } catch {
      // Not our wrap. Expected for every holder but one, on every message -- and for a
      // hybrid wrap, decapsulation succeeds with a garbage secret by design, so the failure
      // surfaces at the NIP-44 authentication step rather than in the KEM.
      continue;
    }
    return JSON.parse(nip44.decrypt(envelope.c, contentKeyFor(contentSecret))) as T;
  }
  throw new GroupSealError('Not addressed to us.');
}

/**
 * Whether a string looks like a group envelope rather than a plain NIP-44 ciphertext.
 *
 * Needed only while both formats exist on the wire. Watchtower-directed traffic is always
 * group-sealed; peer presence and invites have exactly one recipient by construction and
 * stay direct, because wrapping a key for one person you already encrypted to is pure
 * overhead on the highest-volume messages in the system.
 */
export const isGroupEnvelope = (content: string): boolean =>
  content.startsWith('{') && content.includes('"v"');
