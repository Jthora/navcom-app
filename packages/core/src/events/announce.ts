import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import type { SecretKey } from '../crypto/keys.js';
import { KIND_ANNOUNCE } from './kinds.js';

/**
 * *"My directory is now this hash."*
 *
 * The one thing NavCom publishes that is about the **project** rather than about a person, and
 * the only event in this system that belongs on a private relay.
 *
 * ## What it is for
 *
 * A node that holds NavCom's directory has to learn when there is a new one. The alternative is
 * polling an HTTPS endpoint on a timer, which works and is what
 * [`pinning.md`](../../../../docs/pinning.md) documents — this is the same thing with the trigger
 * moved, so a holder finds out when it happens rather than up to a day later.
 *
 * **Nostr carries the pointer; IPFS carries the payload.** A few hundred bytes say what the
 * directory now is and where the archive can be fetched, and anything that cares goes and gets
 * it. The relay never holds bulk data, so its store stays measured in kilobytes however large the
 * artifacts get.
 *
 * ## Why this is the only kind that may cross a private relay
 *
 * Every other event NavCom produces is about an operator, and a private relay is **worse** for
 * those than a public one. The protection in `relays.ts` was never the sealing — that holds
 * anywhere — it is the anonymity set: a squad's presence among thousands of strangers reveals
 * nothing, and the same traffic in a small allowlisted room tells its operator exactly who is
 * active tonight. *A list of where operators are, in time if not in space.*
 *
 * This event names no operator, carries no callsign, and says nothing that is not already public
 * on `navcom.app`. It is a hash, two counts, a URL and a commit.
 *
 * ## The signature proves origin, never truth
 *
 * A node key signs this, and that key confers **no authority whatsoever**. It is not an operator
 * key, not a Watchtower key, and being able to verify it means only that this pipeline published
 * it — never that the claim is correct.
 *
 * That distinction is load-bearing rather than pedantic. If the key leaks, somebody can announce
 * a CID NavCom never built; what they cannot do is make the bytes at that CID hash to it.
 * **A consumer that fetches and verifies is unharmed; one that trusts the announcement is not.**
 * So the pointer is something to check, never something to believe, and any node acting on one
 * without verifying the content has misunderstood what it is.
 *
 * Normative source: docs/spec/announce.spec.md
 */

/** What an announcement says. Deliberately small, and deliberately all already-public. */
export interface Announcement {
  /** Which artifact this is about — the `d` tag, so a later one replaces this one. */
  artifact: string;
  /** The content identifier. The whole point of the message. */
  cid: string;
  /** Where the archive can be fetched over ordinary HTTPS, for a holder with no IPFS peer yet. */
  car?: string;
  /** What the artifact holds, so a reader can tell whether it is worth fetching. */
  census?: Record<string, number>;
  /** The commit it was built from, so the identifier can be reproduced. */
  commit?: string;
}

export class AnnounceError extends Error {}

/**
 * Caps, at the boundary every client shares.
 *
 * The same reasoning as `limits.ts`: an announcement arrives from a relay serving whatever it
 * likes, so a cap on the publisher stops only the publisher. Generous for a real pointer,
 * hostile to anything using this as a transport for something it is not.
 */
const ARTIFACT_MAX = 64;
const CID_MAX = 128;
const URL_MAX = 512;
const CENSUS_KEYS_MAX = 8;

/** `navcom:directory` — a node prefix and an artifact name, and nothing that names a person. */
const ARTIFACT = /^[a-z0-9]+:[a-z0-9-]+$/;
/** Multibase base32 or base58btc, which is every CID anything here will produce. */
const CID = /^(b[a-z2-7]{20,}|Qm[1-9A-HJ-NP-Za-km-z]{44})$/;

function check(a: Announcement): void {
  if (!ARTIFACT.test(a.artifact) || a.artifact.length > ARTIFACT_MAX) {
    throw new AnnounceError('An announcement names an artifact like `navcom:directory`.');
  }
  if (!CID.test(a.cid) || a.cid.length > CID_MAX) {
    throw new AnnounceError(`"${a.cid}" is not a content identifier.`);
  }
  if (a.car !== undefined) {
    // HTTPS only. A pointer that can send a holder to a plaintext URL is a pointer that can be
    // rewritten in transit by anybody between them, which defeats the purpose of naming a hash.
    if (!a.car.startsWith('https://') || a.car.length > URL_MAX) {
      throw new AnnounceError('A fetch URL must be https and shorter than ' + URL_MAX + '.');
    }
  }
  if (a.census) {
    if (Object.keys(a.census).length > CENSUS_KEYS_MAX) {
      throw new AnnounceError(`A census carries at most ${CENSUS_KEYS_MAX} counts.`);
    }
    for (const [k, v] of Object.entries(a.census)) {
      if (!/^[a-z_]{1,24}$/.test(k)) throw new AnnounceError(`"${k}" is not a census key.`);
      if (!Number.isSafeInteger(v) || v < 0) throw new AnnounceError(`"${k}" is not a count.`);
    }
  }
  if (a.commit !== undefined && !/^[0-9a-f]{7,64}$/.test(a.commit)) {
    throw new AnnounceError('A commit is a hex object name.');
  }
}

/**
 * Builds an announcement, signed by the node key.
 *
 * Addressable on the artifact name, so a node's latest word about one thing replaces its earlier
 * word rather than accumulating — there is no history here worth keeping and a relay should not
 * be asked to prune one.
 */
export function buildAnnouncement(
  nodeSecret: SecretKey,
  announcement: Announcement,
  createdAt: number
): Event {
  check(announcement);
  const { artifact, cid, car, census, commit } = announcement;

  return finalizeEvent(
    {
      kind: KIND_ANNOUNCE,
      created_at: createdAt,
      tags: [['d', artifact]],
      content: JSON.stringify({
        artifact,
        cid,
        ...(car ? { car } : {}),
        ...(census ? { census } : {}),
        ...(commit ? { commit } : {})
      })
    },
    nodeSecret
  );
}

/**
 * Reads an announcement, or returns null.
 *
 * A relay serves whatever it likes, so everything the builder refuses is refused again here —
 * and the `d` tag has to agree with the payload, because if they disagree one of them is lying
 * and neither is worth guessing about.
 */
export function readAnnouncement(event: Event): (Announcement & { by: string }) | null {
  if (event.kind !== KIND_ANNOUNCE) return null;
  if (!verifyEvent(event)) return null;

  try {
    const a = JSON.parse(event.content) as Partial<Announcement>;
    if (typeof a.artifact !== 'string' || typeof a.cid !== 'string') return null;
    if (a.car !== undefined && typeof a.car !== 'string') return null;
    if (a.commit !== undefined && typeof a.commit !== 'string') return null;
    if (a.census !== undefined && (a.census === null || typeof a.census !== 'object' || Array.isArray(a.census))) {
      return null;
    }
    check(a as Announcement);
    if (event.tags.find((t) => t[0] === 'd')?.[1] !== a.artifact) return null;

    return { ...(a as Announcement), by: event.pubkey };
  } catch {
    return null;
  }
}
