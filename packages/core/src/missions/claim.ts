/**
 * Taking part in a mission, and letting it go [docs/spec/mission-interchange.spec.md §5.1].
 *
 * Not `KIND_CLAIM`, which is a credential taken up and never published. This is a NIP-32 label,
 * kind 1985, in the `navcom.mission` namespace, naming the package's address — never a place, and
 * never a time beyond its own end. Signed by the operator's **contact key**, so taking part costs
 * no operational exposure [docs/product/what-leaves.md].
 *
 * **The operator chooses who sees it, every time** [docs/design/missions.md §3]. In the open, the
 * label is published as it is. For the poster only, the same label is sealed to the poster
 * (NIP-44) and gift-wrapped by a one-time key (NIP-59), so a relay learns only that somebody wrote
 * to the poster. A private claim withholds who, never that.
 *
 * **A lease, not a lock.** Every claim ends by itself within a day, or with its mission if that is
 * sooner, and taking part again renews it. A claim left standing is a promise nobody is keeping,
 * and on a one-person task it shuts everybody else out. Lapsing costs nothing: a report is
 * accepted if any claim came before the mission's end.
 *
 * **Letting go is a label too** — `released`, in the open or sealed the same way — so a private
 * claim can be let go as easily as a public one. Choosing privacy must not cost the option of
 * changing your mind.
 */
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import { sealToPoster } from './seal.js';

/** NIP-32. */
export const KIND_LABEL = 1985;
/** NIP-09. */
export const KIND_DELETION = 5;
/** NIP-17: where somebody accepts sealed messages. */
export const KIND_INBOX_RELAYS = 10050;

export const MISSION_NAMESPACE = 'navcom.mission';

/** How long a claim stands before it ends by itself, unless renewed. */
export const CLAIM_LEASE_SECONDS = 86_400;

/** Claims one operator may hold at once [docs/design/economy.md §9]. Raised by rung, once rungs exist. */
export const CLAIM_CAP = 3;

export type MissionLabel = 'claimed' | 'released';

/** When a claim made at `now` ends: a day later, or when its mission does, whichever is first. */
export function claimEnds(now: number, missionEnds: number): number {
  return Math.min(now + CLAIM_LEASE_SECONDS, missionEnds);
}

/** The label, unsigned: what goes out in the open, or inside a seal. */
export function missionLabel(label: MissionLabel, mission: string, ends: number, createdAt: number) {
  return {
    kind: KIND_LABEL,
    created_at: createdAt,
    content: '',
    tags: [
      ['L', MISSION_NAMESPACE],
      ['l', label, MISSION_NAMESPACE],
      ['a', mission],
      ['expiration', String(ends)]
    ]
  };
}

/** In the open: the label, signed by the contact key. */
export function buildMissionClaim(
  contactSecret: Uint8Array,
  label: MissionLabel,
  mission: string,
  ends: number,
  createdAt: number
): Event {
  return finalizeEvent(missionLabel(label, mission, ends, createdAt), contactSecret);
}

/**
 * For the poster only: the label as an unsigned rumor, sealed by the contact key to the poster,
 * then wrapped by a one-time key. The poster checks the wrap, the seal, and that the label inside
 * is the seal-signer's own [Mecha Jono, Q4].
 *
 * The wrap carries a time after which a relay may drop it, never before the claim inside has ended
 * and worked out from the wrap's own blurred time alone, so it says nothing of when the claim was
 * sent. The label inside carries the exact end, and that is the one the poster reads [seal.ts].
 */
export function buildSealedMissionClaim(
  contactSecret: Uint8Array,
  poster: string,
  label: MissionLabel,
  mission: string,
  ends: number,
  createdAt: number
): Event {
  return sealToPoster(contactSecret, poster, missionLabel(label, mission, ends, createdAt), { ends, within: CLAIM_LEASE_SECONDS }).wrap;
}

/**
 * A NIP-09 request to drop something the contact key published. Relays may honour it or not, and
 * nothing recalls a copy somebody already has; a screen offering it must say so.
 */
export function buildDeletion(contactSecret: Uint8Array, id: string, kind: number, createdAt: number): Event {
  return finalizeEvent(
    {
      kind: KIND_DELETION,
      created_at: createdAt,
      content: '',
      tags: [
        ['e', id],
        ['k', String(kind)]
      ]
    },
    contactSecret
  );
}

/** A NIP-09 request to drop an open claim, sent beside its `released` label. */
export function buildClaimDeletion(contactSecret: Uint8Array, claimId: string, createdAt: number): Event {
  return buildDeletion(contactSecret, claimId, KIND_LABEL, createdAt);
}

/**
 * Where `poster` accepts sealed messages, from its kind-10050 list: secure relay addresses only,
 * and only from a list it signed itself. Empty when there is no such list — a private claim then
 * has nowhere to go, and the caller must say so rather than send it somewhere else.
 */
export function inboxRelays(event: unknown, poster: string): string[] {
  const e = event as Partial<Event> | null;
  if (!e || e.kind !== KIND_INBOX_RELAYS || e.pubkey !== poster || !Array.isArray(e.tags)) return [];
  // Rebuilt from its own fields: a copy can carry a cached verdict from somewhere else.
  const own = {
    id: e.id!, pubkey: e.pubkey!, created_at: e.created_at!, kind: e.kind!,
    tags: e.tags!, content: e.content!, sig: e.sig!
  } as Event;
  if (!verifyEvent(own)) return [];
  const out: string[] = [];
  for (const t of e.tags) {
    if (t[0] === 'relay' && typeof t[1] === 'string' && /^wss:\/\/[^\s/]+/.test(t[1]) && !out.includes(t[1])) out.push(t[1]);
  }
  return out;
}
