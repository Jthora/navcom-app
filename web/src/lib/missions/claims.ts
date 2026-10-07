/**
 * Taking part in a mission, from this device [docs/design/missions.md §3; core: missions/claim.ts].
 *
 * The claims this device holds are kept in the **Wipeable** tier: claims are mission history, and a
 * panic wipe takes them [invariant 5]. Nothing here scores anybody: letting a claim go, or letting
 * it lapse, costs nothing and leaves nothing behind [invariant 8].
 *
 * Loaded with the mission screens, the first time somebody opens one.
 */
import type { Event } from 'nostr-tools/core';
import type { Filter } from 'nostr-tools/filter';
import {
  CLAIM_CAP,
  KIND_INBOX_RELAYS,
  buildClaimDeletion,
  buildMissionClaim,
  buildSealedMissionClaim,
  claimEnds,
  inboxRelays,
  missionActive,
  type Mission
} from '@navcom/core';
import { get, set } from '$lib/terminal/storage';
import { ensureContactKey } from '$lib/terminal/card';
import { relays } from '$lib/terminal/relays';
import { pool } from '$lib/terminal/pool';

export type Visibility = 'open' | 'sealed';

export interface Held {
  /** The package's address, as the claim's `a` tag names it. */
  address: string;
  title: string;
  visibility: Visibility;
  /** Unix seconds: when this claim ends by itself. */
  ends: number;
  /** The open label's id, so it can be withdrawn; null for a sealed claim, which has none to give. */
  claimId: string | null;
}

/** How a claim leaves the device. The app's is the shared relay pool; a test gives its own. */
export interface Wire {
  /** True when at least one relay took it. */
  publish(urls: string[], event: Event): Promise<boolean>;
  query(urls: string[], filter: Filter): Promise<Event[]>;
}

export const wire: Wire = {
  async publish(urls, event) {
    const settled = await Promise.allSettled(pool().publish(urls, event));
    return settled.some((s) => s.status === 'fulfilled');
  },
  query: (urls, filter) => pool().querySync(urls, filter, { maxWait: 4_000 })
};

const STORE = 'mission_claims';
/**
 * Missions this device took part in, kept so the work can be reported after the claim lapses and
 * after the mission leaves the map — reports arrive late on purpose. Wipeable, like the claims.
 */
const HISTORY = 'mission_history';
/** How long a mission is remembered after it ends, for a report to be filed. */
const HISTORY_DAYS = 30;

export interface TookPart {
  mission: Mission;
  /** Unix seconds: when this device first took part. */
  since: number;
}

/** Missions this device took part in, for reporting. */
export function tookPart(now: number): TookPart[] {
  const all = get<TookPart[]>('wipeable', HISTORY) ?? [];
  return all.filter((t) => t.mission.validUntil + HISTORY_DAYS * 86_400 > now);
}

function remember(m: Mission, now: number): void {
  const all = tookPart(now);
  const before = all.find((t) => t.mission.address === m.address);
  const kept = all.filter((t) => t.mission.address !== m.address);
  set('wipeable', HISTORY, [...kept, { mission: m, since: before?.since ?? now }]);
}

/** Claims this device holds that have not ended. */
export function held(now: number): Held[] {
  const all = get<Held[]>('wipeable', STORE) ?? [];
  return all.filter((h) => h.ends > now);
}

function keep(list: Held[]): void {
  set('wipeable', STORE, list);
}

/** Whether somebody signed on is on this device. Taking part needs one [docs/design/missions.md §3]. */
export function signedOn(): boolean {
  return !!get<string>('accruing', 'secret');
}

export type Refusal = 'signed-out' | 'ended' | 'taken' | 'cap';

/** Why this device may not take part in `m` now, or null when it may. */
export function refusal(m: Mission, now: number): Refusal | null {
  if (!signedOn()) return 'signed-out';
  if (!missionActive(m, new Date(now * 1000))) return 'ended';
  if (held(now).some((h) => h.address === m.address)) return null;
  if (m.claims === 'one' && m.state === 'claimed') return 'taken';
  if (held(now).length >= CLAIM_CAP) return 'cap';
  return null;
}

/**
 * Where the poster takes sealed messages, read once per page from its own signed list. Kept per
 * wire, so what one set of relays said is never taken as what another would.
 */
const inboxesByWire = new WeakMap<Wire, Map<string, Promise<string[]>>>();
export function inboxOf(poster: string, w: Wire): Promise<string[]> {
  let inboxes = inboxesByWire.get(w);
  if (!inboxes) inboxesByWire.set(w, (inboxes = new Map()));
  let found = inboxes.get(poster);
  if (!found) {
    found = w
      .query(relays(), { kinds: [KIND_INBOX_RELAYS], authors: [poster] })
      .then((events) => {
        const newest = events.sort((a, b) => b.created_at - a.created_at)[0];
        return newest ? inboxRelays(newest, poster) : [];
      })
      .catch(() => []);
    // A miss is not remembered: the next attempt asks again.
    void found.then((urls) => urls.length === 0 && inboxes!.delete(poster));
    inboxes.set(poster, found);
  }
  return found;
}

export type Outcome = { ok: true; held: Held } | { ok: false; because: string };

/** Send one label, open or sealed. */
async function send(
  m: Mission,
  label: 'claimed' | 'released',
  visibility: Visibility,
  ends: number,
  now: number,
  w: Wire
): Promise<{ ok: true; id: string | null } | { ok: false; because: string }> {
  const contact = ensureContactKey();
  if (visibility === 'open') {
    const event = buildMissionClaim(contact, label, m.address, ends, now);
    return (await w.publish(relays(), event))
      ? { ok: true, id: event.id }
      : { ok: false, because: 'No relay took it. Nothing was sent; try again with signal.' };
  }
  const inbox = await inboxOf(m.publisher.pubkey, w);
  if (inbox.length === 0) {
    return { ok: false, because: `${m.publisher.name}'s inbox could not be found, so nothing was sent.` };
  }
  const event = buildSealedMissionClaim(contact, m.publisher.pubkey, label, m.address, ends, now);
  return (await w.publish(inbox, event))
    ? { ok: true, id: null }
    : { ok: false, because: `${m.publisher.name}'s inbox did not take it. Nothing was sent.` };
}

/**
 * Take part, or renew: a claim that ends in a day, or with the mission if that is sooner. Renewing
 * an open claim withdraws the one it replaces, so a relay holds one claim per person per mission.
 */
export async function takePart(m: Mission, visibility: Visibility, now: number, w: Wire = wire): Promise<Outcome> {
  const why = refusal(m, now);
  if (why) return { ok: false, because: why };
  const ends = claimEnds(now, m.validUntil);
  const sent = await send(m, 'claimed', visibility, ends, now, w);
  if (!sent.ok) return sent;
  const before = held(now).find((h) => h.address === m.address);
  if (before?.claimId) void w.publish(relays(), buildClaimDeletion(ensureContactKey(), before.claimId, now));
  const h: Held = { address: m.address, title: m.title, visibility, ends, claimId: sent.id };
  keep([...held(now).filter((x) => x.address !== m.address), h]);
  remember(m, now);
  return { ok: true, held: h };
}

/**
 * Let a claim go: a `released` label the same way the claim went, and for an open one a deletion
 * request beside it. It is gone from this device either way — walking away is never refused.
 */
export async function letGo(m: Mission, now: number, w: Wire = wire): Promise<{ sent: boolean }> {
  const h = held(now).find((x) => x.address === m.address);
  keep(held(now).filter((x) => x.address !== m.address));
  if (!h) return { sent: true };
  const sent = await send(m, 'released', h.visibility, h.ends, now, w);
  if (h.claimId) void w.publish(relays(), buildClaimDeletion(ensureContactKey(), h.claimId, now));
  return { sent: sent.ok };
}
