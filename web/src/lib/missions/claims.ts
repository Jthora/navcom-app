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
  DEFAULT_RELAYS,
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
import { contactPubkey, ensureContactKey } from '$lib/terminal/card';
import { relays, usable } from '$lib/terminal/relays';
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
  /** Where the open label went, so a withdrawal goes there too [11.E]. Absent on claims made before. */
  relays?: string[];
  /** The key that signed it: a card withdrawn since cannot sign its release [11.E]. */
  signer?: string;
}

/** What a read heard: the events, and which relays finished answering. Nobody answering is not nothing there [11.E]. */
export interface Heard {
  events: Event[];
  answered: string[];
}

/** How a claim leaves the device. The app's is the shared relay pool; a test gives its own. */
export interface Wire {
  /** True when at least one relay took it. */
  publish(urls: string[], event: Event): Promise<boolean>;
  query(urls: string[], filter: Filter): Promise<Heard>;
}

const QUERY_MS = 4_000;
const PUBLISH_MS = 8_000;

export { usable };

const within = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

export const wire: Wire = {
  async publish(urls, event) {
    const ok = usable(urls);
    if (ok.length === 0) return false;
    try {
      const settled = await within(Promise.allSettled(pool().publish(ok, event)), PUBLISH_MS, []);
      return settled.some((s) => s.status === 'fulfilled');
    } catch {
      return false;
    }
  },
  /*
   * One subscription per relay, so each one's answer is its own. A relay counts as having answered
   * only if it finished before the wait ran out: the pool ends a slow relay's wait the same way as
   * a real end of answer, and that is exactly the difference between "nothing" and "nobody said".
   */
  async query(urls, filter) {
    const events = new Map<string, Event>();
    const answered: string[] = [];
    await Promise.all(
      usable(urls).map(
        (url) =>
          new Promise<void>((resolve) => {
            const start = Date.now();
            let sub: { close(reason?: string): void } | undefined;
            const done = () => {
              clearTimeout(guard);
              try {
                sub?.close();
              } catch {
                /* already closed */
              }
              resolve();
            };
            const guard = setTimeout(done, QUERY_MS + 1_000);
            try {
              sub = pool().subscribe([url], filter, {
                maxWait: QUERY_MS,
                onevent: (e: Event) => void events.set(e.id, e),
                oneose: () => {
                  if (Date.now() - start < QUERY_MS - 50) answered.push(url);
                  done();
                },
                onclose: done
              });
            } catch {
              done();
            }
          })
      )
    );
    return { events: [...events.values()], answered };
  }
};

/**
 * Where an operator's public mission traffic goes: this device's relays and the ones every poster
 * reads [interchange spec §5.0]. A Watched operator's relays are the watch's, and a claim or report
 * sent only there never reached the poster, who would then settle it by silence [11.E].
 */
export function operatorRelays(): string[] {
  return usable([...relays(), ...DEFAULT_RELAYS]);
}

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

function remember(m: Mission, now: number): boolean {
  const all = tookPart(now);
  const before = all.find((t) => t.mission.address === m.address);
  const kept = all.filter((t) => t.mission.address !== m.address);
  return set('wipeable', HISTORY, [...kept, { mission: m, since: before?.since ?? now }]);
}

/** Claims this device holds that have not ended. */
export function held(now: number): Held[] {
  const all = get<Held[]>('wipeable', STORE) ?? [];
  return all.filter((h) => h.ends > now);
}

function keep(list: Held[]): boolean {
  return set('wipeable', STORE, list);
}

/** Whether somebody signed on is on this device. Taking part needs one [docs/design/missions.md §3]. */
export function signedOn(): boolean {
  return !!get<string>('accruing', 'secret');
}

export type Refusal = 'signed-out' | 'ended' | 'taken' | 'cap';

/**
 * Why this device may not take part in `m` now, or null when it may.
 *
 * `open` is the missions still open, when the caller knows them: a claim on a mission closed early
 * still held a place in the cap for up to a day, with no way to let it go [11.X].
 */
export function refusal(m: Mission, now: number, open?: ReadonlySet<string>): Refusal | null {
  if (!signedOn()) return 'signed-out';
  if (!missionActive(m, new Date(now * 1000))) return 'ended';
  if (held(now).some((h) => h.address === m.address)) return null;
  if (m.claims === 'one' && m.state === 'claimed') return 'taken';
  if (held(now).filter((h) => !open || open.has(h.address)).length >= CLAIM_CAP) return 'cap';
  return null;
}

/**
 * Where the poster takes sealed messages, read once per page from its own signed list. Kept per
 * wire, so what one set of relays said is never taken as what another would.
 */
const inboxesByWire = new WeakMap<Wire, Map<string, Promise<Inbox>>>();
/** The poster's inbox relays, and whether any relay answered the question at all. */
export type Inbox = { urls: string[]; answered: boolean };
export function inboxOf(poster: string, w: Wire): Promise<Inbox> {
  let inboxes = inboxesByWire.get(w);
  if (!inboxes) inboxesByWire.set(w, (inboxes = new Map()));
  let found = inboxes.get(poster);
  if (!found) {
    found = w
      .query(operatorRelays(), { kinds: [KIND_INBOX_RELAYS], authors: [poster] })
      .then(({ events, answered }) => {
        const newest = events.sort((a, b) => b.created_at - a.created_at)[0];
        return { urls: newest ? usable(inboxRelays(newest, poster)) : [], answered: answered.length > 0 };
      })
      .catch(() => ({ urls: [], answered: false }));
    // A miss is not remembered: the next attempt asks again.
    void found.then((i) => i.urls.length === 0 && inboxes!.delete(poster));
    inboxes.set(poster, found);
  }
  return found;
}

/** Why nothing went sealed, in words: a poster with no list and a phone with no signal are different [11.E]. */
export const noInbox = (poster: string, i: Inbox) =>
  i.answered
    ? `${poster} has not said where they take sealed messages, so nothing was sent.`
    : `No relay answered when asking where ${poster} takes sealed messages. Nothing was sent; try again with signal.`;

/** `kept: false` is sent but not recorded: storage refused it, and the screen says so [11.E]. */
export type Outcome = { ok: true; held: Held; kept: boolean } | { ok: false; because: string };

/** Send one label, open or sealed. */
async function send(
  m: Mission,
  label: 'claimed' | 'released',
  visibility: Visibility,
  ends: number,
  now: number,
  w: Wire
): Promise<{ ok: true; id: string | null; relays: string[] } | { ok: false; because: string }> {
  const contact = ensureContactKey();
  if (visibility === 'open') {
    const event = buildMissionClaim(contact, label, m.address, ends, now);
    const to = operatorRelays();
    return (await w.publish(to, event))
      ? { ok: true, id: event.id, relays: to }
      : { ok: false, because: 'No relay took it. Nothing was sent; try again with signal.' };
  }
  const inbox = await inboxOf(m.publisher.pubkey, w);
  if (inbox.urls.length === 0) return { ok: false, because: noInbox(m.publisher.name, inbox) };
  const event = buildSealedMissionClaim(contact, m.publisher.pubkey, label, m.address, ends, now);
  return (await w.publish(inbox.urls, event))
    ? { ok: true, id: null, relays: inbox.urls }
    : { ok: false, because: `${m.publisher.name}'s inbox did not take it. Nothing was sent.` };
}

/**
 * Take part, or renew: a claim that ends in a day, or with the mission if that is sooner. Renewing
 * an open claim withdraws the one it replaces, so a relay holds one claim per person per mission.
 */
export async function takePart(
  m: Mission,
  visibility: Visibility,
  now: number,
  w: Wire = wire,
  open?: ReadonlySet<string>
): Promise<Outcome> {
  const why = refusal(m, now, open);
  if (why) return { ok: false, because: why };
  const ends = claimEnds(now, m.validUntil);
  const sent = await send(m, 'claimed', visibility, ends, now, w);
  if (!sent.ok) return sent;
  const before = held(now).find((h) => h.address === m.address);
  const signer = contactPubkey() ?? undefined;
  if (before?.claimId && before.signer === signer) {
    void w.publish(usable([...(before.relays ?? []), ...operatorRelays()]), buildClaimDeletion(ensureContactKey(), before.claimId, now));
  }
  const h: Held = { address: m.address, title: m.title, visibility, ends, claimId: sent.id, relays: sent.relays, signer };
  const kept = keep([...held(now).filter((x) => x.address !== m.address), h]) && remember(m, now);
  return { ok: true, held: h, kept };
}

/**
 * Let a claim go: a `released` label the same way the claim went, and for an open one a deletion
 * request beside it. It is gone from this device either way — walking away is never refused.
 */
export async function letGo(m: Mission, now: number, w: Wire = wire): Promise<{ sent: boolean; card?: boolean }> {
  const h = held(now).find((x) => x.address === m.address);
  keep(held(now).filter((x) => x.address !== m.address));
  if (!h) return { sent: true };
  // A card withdrawn since cannot sign this claim's release: a new key's would be nobody's [11.E].
  if (h.signer && h.signer !== contactPubkey()) return { sent: false, card: true };
  const sent = await send(m, 'released', h.visibility, h.ends, now, w);
  if (h.claimId) void w.publish(usable([...(h.relays ?? []), ...operatorRelays()]), buildClaimDeletion(ensureContactKey(), h.claimId, now));
  return { sent: sent.ok };
}
