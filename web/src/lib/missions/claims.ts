/**
 * Taking part in a mission, from this device [docs/design/missions.md §3; core: missions/claim.ts].
 *
 * The claims this device holds are kept in the **Wipeable** tier: claims are mission history, and a
 * panic wipe takes them [invariant 5]. Nothing here scores anybody: letting a claim go, or letting
 * it lapse, costs nothing and leaves nothing behind [invariant 8].
 *
 * **What no relay confirmed is never called unsent** [audit 11.S, findings 61 and 66]. A claim is
 * recorded before it is sent and kept unless every relay refused it; sent again, it is the same
 * signed event. A claim let go whose release did not go is kept beside the claims, Wipeable too,
 * until it ends by itself — out of the three, and only sent when she sends it.
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
import { contactPubkey, ensureContactKey } from '$lib/terminal/card';
import { missionRelays, usable } from '$lib/terminal/relays';
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
  /**
   * The signed claim, while no relay has confirmed it [audit 11.S, finding 61]. It may have
   * arrived, so it is held, counted and let go like any claim — and sending it again sends this
   * same event: one claim under one id, never a second that nobody could withdraw.
   */
  unconfirmed?: Event;
  /** Claims this one renewed, withdrawn once it is confirmed: until then they may be all a relay holds. */
  replaces?: { id: string; relays: string[] }[];
}

/**
 * A claim let go whose release no relay confirmed [audit 11.S, finding 66]. Letting go takes the
 * claim off this device's claims at once, and out of the three — walking away is never refused —
 * but the claim is still on relays until it ends. So what was already stored is kept, Wipeable as
 * the claim was, until a relay takes the release or the claim ends by itself, and the release can
 * be sent once there is signal. Nothing new is held, and nothing is sent unless she sends it.
 */
export interface Unreleased extends Held {
  poster: string;
  posterName: string;
  /** The signed release, sent again as it is. Absent when none could be built: no inbox was found for a sealed one. */
  release?: Event;
  /** Where the release goes: where operators' traffic goes, or the poster's inbox for a sealed one. */
  releaseTo?: string[];
  /**
   * Set once the release left this phone and no relay refused it — it may be on one — and never
   * cleared by a later refusal, which says nothing about that time. Absent, no relay has it: every
   * one refused it, or none was built. With no signal at all every connection fails, and calling
   * that "unconfirmed" told her the claim might be released when it certainly was not
   * [audit 11.S, finding 66 — review].
   */
  mayHaveArrived?: true;
}

/** What a read heard: the events, and which relays finished answering. Nobody answering is not nothing there [11.E]. */
export interface Heard {
  events: Event[];
  answered: string[];
}

/**
 * What became of something sent [audit 11.S, finding 61]:
 *
 * - `took` — a relay said it holds it
 * - `refused` — every relay said no, or could not be reached: no relay holds it
 * - `unconfirmed` — no relay said either way in time, so **it may have arrived**. On a congested
 *   cell a relay takes the event and its answer comes back after the pool has stopped waiting;
 *   that was read as "nothing was sent", and the retry put a second claim or report on the relays
 *   that nobody could withdraw
 */
export type Published = 'took' | 'refused' | 'unconfirmed';

/** How a claim leaves the device. The app's is the shared relay pool; a test gives its own. */
export interface Wire {
  publish(urls: string[], event: Event): Promise<Published>;
  query(urls: string[], filter: Filter): Promise<Heard>;
}

/** What a screen says of something no relay confirmed. Never "nothing was sent": it may have been. */
export const MAY_HAVE_ARRIVED = 'No relay confirmed it; it may have arrived.';

const QUERY_MS = 4_000;
const PUBLISH_MS = 8_000;

export { usable };

/**
 * How one relay's failure leaves the event, from what the pool rejected with [nostr-tools 2.24].
 * A string is the pool's own, and means it never got as far as a connection. A relay that answered
 * no gives its reason with NIP-01's prefix (`blocked:`, `invalid:`) — except `duplicate:`, which is
 * a relay saying it already holds it. A write to a socket that was already shut never left. The
 * rest — the pool tired of waiting, a connection that dropped with the event on its way, anything
 * this does not recognise — may have arrived, and is said so.
 */
function answerOf(err: unknown): Published {
  if (typeof err === 'string') return 'refused';
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof Error && err.name === 'SendingOnClosedConnection') return 'refused';
  if (/^duplicate:/.test(message)) return 'took';
  if (/^[a-z-]+:/.test(message)) return 'refused';
  return 'unconfirmed';
}

export const wire: Wire = {
  /** `took` as soon as one relay does; otherwise, once every relay has answered or the wait is over. */
  async publish(urls, event) {
    const ok = usable(urls);
    if (ok.length === 0) return 'refused';
    let pending: Promise<unknown>[];
    try {
      pending = pool().publish(ok, event);
    } catch {
      return 'refused';
    }
    return new Promise<Published>((resolve) => {
      let left = pending.length;
      let unsure = false;
      const timer = setTimeout(() => resolve('unconfirmed'), PUBLISH_MS);
      const end = (r: Published) => {
        clearTimeout(timer);
        resolve(r);
      };
      for (const p of pending) {
        p.then(
          () => end('took'),
          (err) => {
            const a = answerOf(err);
            if (a === 'took') return end('took');
            if (a === 'unconfirmed') unsure = true;
            if (--left === 0) end(unsure ? 'unconfirmed' : 'refused');
          }
        );
      }
    });
  },
  /*
   * One subscription per relay, so each one's answer is its own. **A relay counts as having
   * answered only on a real end of its answer, before the wait ran out** — the rule
   * `terminal/subscribe.ts` keeps, here for a one-off read.
   *
   * The pool says "end of answer" in two other places, and both used to count [audit 11, second
   * grid]. At the end of the wait it fires its own stand-in, which the time check below refuses.
   * And it reports every failure — a connection that never came up, a relay's CLOSED, a socket that
   * dropped — as an end of answer and a close in the same moment. So the end of answer waits a
   * microtask to see whether a close came with it: a relay that could not be reached is not one that
   * said there was nothing, and with no signal every relay had "answered" with nothing.
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
            /** Ended — by a real end of answer, the wait, or a close of any kind — and never counted again. */
            let finished = false;
            const done = () => {
              if (finished) return;
              finished = true;
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
                // A close that came with it has finished this by the time the microtask runs.
                oneose: () =>
                  queueMicrotask(() => {
                    if (!finished && Date.now() - start < QUERY_MS - 50) answered.push(url);
                    done();
                  }),
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
 * sent only there never reached the poster, who would then settle it by silence [11.E]. One rule,
 * kept in `relays.ts` beside the others, so the screen that says where things go names this one.
 */
export function operatorRelays(): string[] {
  return missionRelays();
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

function forget(address: string, now: number): void {
  set('wipeable', HISTORY, tookPart(now).filter((t) => t.mission.address !== address));
}

/** Claims this device holds that have not ended. */
export function held(now: number): Held[] {
  const all = get<Held[]>('wipeable', STORE) ?? [];
  return all.filter((h) => h.ends > now);
}

function keep(list: Held[]): boolean {
  return set('wipeable', STORE, list);
}

const RELEASES = 'mission_releases';

/** Claims let go whose release has not reached a relay, until they end by themselves. */
export function unreleased(now: number): Unreleased[] {
  return (get<Unreleased[]>('wipeable', RELEASES) ?? []).filter((u) => u.ends > now);
}

function keepUnreleased(u: Unreleased, now: number): void {
  set('wipeable', RELEASES, [...unreleased(now).filter((x) => x.address !== u.address), u]);
}

function dropUnreleased(address: string, now: number): void {
  set('wipeable', RELEASES, unreleased(now).filter((x) => x.address !== address));
}

/**
 * Withdraw what a claim replaced, now that it is known to be there — under the key that signed it,
 * and only that key: a new card's request would be nobody's [11.E].
 */
function withdrawReplaced(h: Held, now: number, w: Wire): void {
  if (!h.replaces?.length || (h.signer && h.signer !== contactPubkey())) return;
  for (const r of h.replaces) void w.publish(usable([...r.relays, ...operatorRelays()]), buildClaimDeletion(ensureContactKey(), r.id, now));
}

/** A claim a relay has now confirmed: nothing left to send again or to withdraw for it. */
const settledClaim = ({ unconfirmed: _e, replaces: _r, ...h }: Held): Held => h;

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

/**
 * `kept: false` is sent but not recorded: storage refused it, and the screen says so [11.E]. A held
 * claim carrying `unconfirmed` is one no relay confirmed, and may have arrived [audit 11.S].
 */
export type Outcome = { ok: true; held: Held; kept: boolean } | { ok: false; because: string };

/** Who a label is about and whom to seal it to: from the mission, or from what this device kept of a claim. */
type Target = { address: string; poster: string; posterName: string };
const targetOf = (m: Mission): Target => ({ address: m.address, poster: m.publisher.pubkey, posterName: m.publisher.name });

/** One label, open or sealed, signed and not yet sent, with where it goes and what to say if every relay refuses it. */
async function build(
  t: Target,
  label: 'claimed' | 'released',
  visibility: Visibility,
  ends: number,
  now: number,
  w: Wire
): Promise<{ ok: true; event: Event; id: string | null; relays: string[]; refused: string } | { ok: false; because: string }> {
  const contact = ensureContactKey();
  if (visibility === 'open') {
    const event = buildMissionClaim(contact, label, t.address, ends, now);
    return { ok: true, event, id: event.id, relays: operatorRelays(), refused: 'No relay took it. Nothing was sent; try again with signal.' };
  }
  const inbox = await inboxOf(t.poster, w);
  if (inbox.urls.length === 0) return { ok: false, because: noInbox(t.posterName, inbox) };
  const event = buildSealedMissionClaim(contact, t.poster, label, t.address, ends, now);
  return { ok: true, event, id: null, relays: inbox.urls, refused: `${t.posterName}'s inbox did not take it. Nothing was sent.` };
}

/**
 * Take part, or renew: a claim that ends in a day, or with the mission if that is sooner. Renewing
 * an open claim withdraws the one it replaces, so a relay holds one claim per person per mission —
 * once the new one is known to be there.
 *
 * **Recorded before it is sent**, as `Distress` is: a phone that dies on the way, or a relay that
 * takes it and answers too late, still leaves this device knowing what may have left. Only a
 * refusal by every relay puts things back as they were [audit 11.S, finding 61].
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
  const built = await build(targetOf(m), 'claimed', visibility, ends, now, w);
  if (!built.ok) return built;
  const others = () => held(now).filter((x) => x.address !== m.address);
  const before = held(now).find((x) => x.address === m.address);
  const loose = unreleased(now).find((x) => x.address === m.address);
  const signer = contactPubkey() ?? undefined;
  // Withdrawn once this one is there, and only under the key that signed them.
  const replaces = [before, loose]
    .filter((x): x is Held => !!x && x.signer === signer)
    .flatMap((x) => [...(x.replaces ?? []), ...(x.claimId ? [{ id: x.claimId, relays: x.relays ?? [] }] : [])]);
  const h: Held = {
    address: m.address,
    title: m.title,
    visibility,
    ends,
    claimId: built.id,
    relays: built.relays,
    signer,
    unconfirmed: built.event,
    ...(replaces.length ? { replaces } : {})
  };
  const hadHistory = tookPart(now).some((t) => t.mission.address === m.address);
  keep([...others(), h]);
  remember(m, now);
  const result = await w.publish(built.relays, built.event);
  if (result === 'refused') {
    // No relay holds it: everything as it was.
    keep([...others(), ...(before ? [before] : [])]);
    if (!hadHistory) forget(m.address, now);
    return { ok: false, because: built.refused };
  }
  // Taking part again supersedes a release still waiting to go: sent now, it would let go of this claim.
  if (loose) dropUnreleased(m.address, now);
  if (result === 'took') withdrawReplaced(h, now, w);
  const after = result === 'took' ? settledClaim(h) : h;
  const kept = keep([...others(), after]) && remember(m, now);
  return { ok: true, held: after, kept };
}

/**
 * Send again a claim no relay confirmed: **the same signed event**, so a claim that did arrive is
 * never joined by a second one nobody could withdraw [audit 11.S, finding 61]. It stays held
 * whatever comes back: a relay refusing it now says nothing about the first time.
 */
export async function claimAgain(address: string, now: number, w: Wire = wire): Promise<Published | 'gone'> {
  const h = held(now).find((x) => x.address === address);
  if (!h?.unconfirmed) return 'gone';
  const result = await w.publish(usable(h.relays ?? operatorRelays()), h.unconfirmed);
  if (result === 'took') {
    withdrawReplaced(h, now, w);
    keep(held(now).map((x) => (x.address === address ? settledClaim(x) : x)));
  }
  return result;
}

/**
 * How letting go went: a release a relay took; a card that can no longer sign one; or one still to
 * send, and why. `unconfirmed` is this attempt going unanswered; whether the release may be on a
 * relay at all is the kept record's `mayHaveArrived`, which `because` also says.
 */
export type Release = { sent: true } | { sent: false; card: true } | { sent: false; unconfirmed: boolean; because: string };

/**
 * Let a claim go: a `released` label the same way the claim went, and for an open one a deletion
 * request beside it. **It is off this device's claims at once, and out of the three** — walking
 * away is never refused and costs nothing [invariant 8].
 *
 * A release no relay confirmed is kept with the claim it releases, until the claim ends by itself
 * or a relay takes it; calling this again — or `sendRelease` — sends it. Forgetting the claim first
 * left nothing to send once there was signal, and the claim stayed public until it lapsed
 * [audit 11.S, finding 66].
 */
export async function letGo(m: Mission, now: number, w: Wire = wire): Promise<Release> {
  const h = held(now).find((x) => x.address === m.address);
  keep(held(now).filter((x) => x.address !== m.address));
  if (h) {
    const { unconfirmed: _claim, ...claim } = h;
    return release({ ...claim, poster: m.publisher.pubkey, posterName: m.publisher.name }, now, w);
  }
  const u = unreleased(now).find((x) => x.address === m.address);
  return u ? release(u, now, w) : { sent: true };
}

/** Send the release of a claim let go, from what this device kept of it: a screen with no mission to hand can. */
export async function sendRelease(address: string, now: number, w: Wire = wire): Promise<Release> {
  const u = unreleased(now).find((x) => x.address === address);
  return u ? release(u, now, w) : { sent: true };
}

async function release(u: Unreleased, now: number, w: Wire): Promise<Release> {
  // A card withdrawn since cannot sign this claim's release: a new key's would be nobody's [11.E].
  if (u.signer && u.signer !== contactPubkey()) {
    dropUnreleased(u.address, now);
    return { sent: false, card: true };
  }
  let event = u.release;
  let to = u.releaseTo;
  if (!event || !to) {
    const built = await build(u, 'released', u.visibility, u.ends, now, w);
    if (!built.ok) {
      keepUnreleased(u, now);
      return { sent: false, unconfirmed: false, because: built.because };
    }
    event = built.event;
    to = built.relays;
  }
  // Kept before it is sent, as on its way: a phone that dies on the way still has it to send, and
  // it may have left.
  keepUnreleased({ ...u, release: event, releaseTo: to, mayHaveArrived: true }, now);
  const result = await w.publish(to, event);
  if (u.claimId) void w.publish(usable([...(u.relays ?? []), ...operatorRelays()]), buildClaimDeletion(ensureContactKey(), u.claimId, now));
  withdrawReplaced(u, now, w);
  if (result === 'took') {
    dropUnreleased(u.address, now);
    return { sent: true };
  }
  // Every relay refused it this time: it is on one only if an earlier attempt left.
  if (result === 'refused' && !u.mayHaveArrived) keepUnreleased({ ...u, release: event, releaseTo: to }, now);
  if (result === 'unconfirmed') return { sent: false, unconfirmed: true, because: MAY_HAVE_ARRIVED };
  if (u.mayHaveArrived) return { sent: false, unconfirmed: false, because: `${MAY_HAVE_ARRIVED} No relay took it this time.` };
  const refused = u.visibility === 'sealed' ? `${u.posterName}'s inbox did not take the release.` : 'No relay took the release.';
  return { sent: false, unconfirmed: false, because: refused };
}
