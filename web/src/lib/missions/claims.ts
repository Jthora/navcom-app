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
  MISSION_PUBLISHERS,
  buildClaimDeletion,
  buildMissionClaim,
  buildSealedMissionClaim,
  claimEnds,
  keptMissionTrusted,
  keyOf,
  missionActive,
  sealTargetOf,
  type Mission,
  type MissionPublishers,
  type SealTarget
} from '@navcom/core';
import { get, set } from '$lib/terminal/storage';
import { contactPubkey, ensureContactKey } from '$lib/terminal/card';
import { missionRelays, usable } from '$lib/terminal/relays';
import { pool } from '$lib/terminal/pool';
import { floorNow } from './floor';

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
  /**
   * The key a sealed claim was sealed to, so its release goes to the same one [rev 7]. Absent on a
   * claim kept before 2026-10-18, which was sealed to the key that posted its mission.
   */
  sealedTo?: string;
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
  /** The signed release, sent again as it is. Absent when none could be built: no inbox is pinned for a sealed one's poster. */
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
  /**
   * Who takes sealed messages where: the registry this release ships when absent, as the app's
   * wire leaves it. A test stands its own in rather than adding a key to the shipped one.
   */
  publishers?: MissionPublishers;
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

/** Everything kept in this device's mission history that has not aged out, whichever build kept it. */
function history(now: number): TookPart[] {
  const all = get<TookPart[]>('wipeable', HISTORY) ?? [];
  return all.filter((t) => t.mission.validUntil + HISTORY_DAYS * 86_400 > now);
}

/**
 * Missions this device took part in, for reporting — **only those this build would keep now**
 * [core: trust.ts, `keptMissionTrusted`], judged on this device's clock floored at the build.
 *
 * The history holds missions as an earlier build read them, and that build may have trusted a key
 * this one refuses: the bundle before this one trusted Mecha Jono's next key at once, and every one
 * before that kept whatever its old key signed. Such a mission stayed under "To report" with its
 * planted words, and an open report on it told whoever signed it which card did the work. It is
 * left where it is, not deleted, and shows again if a release comes to trust it; a wipe takes it
 * like the rest.
 */
export function tookPart(now: number, publishers: MissionPublishers = MISSION_PUBLISHERS): TookPart[] {
  const at = floorNow(now * 1000);
  return history(now).filter((t) => keptMissionTrusted(t.mission, publishers, at));
}

function remember(m: Mission, now: number): boolean {
  const all = history(now);
  const before = all.find((t) => t.mission.address === m.address);
  const kept = all.filter((t) => t.mission.address !== m.address);
  return set('wipeable', HISTORY, [...kept, { mission: m, since: before?.since ?? now }]);
}

function forget(address: string, now: number): void {
  set('wipeable', HISTORY, history(now).filter((t) => t.mission.address !== address));
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

export type Refusal = 'retiring' | 'signed-out' | 'ended' | 'taken' | 'cap';

/**
 * Whether `m` was posted under a retiring key, and whether the publisher's own list confirmed it
 * [core: package.ts, `retiring`]. Asked of the registry by key for a mission kept by a build from
 * before 2026-10-18, which did not record it.
 */
export function retiringOf(m: Mission, publishers: MissionPublishers = MISSION_PUBLISHERS): 'unconfirmed' | 'confirmed' | null {
  if (m.retiring !== undefined) return m.retiring;
  const frozen = keyOf(publishers, m.publisher.pubkey)?.key.frozen;
  return frozen ? (frozen.confirmed ? 'confirmed' : 'unconfirmed') : null;
}

/**
 * Why this device may not take part in `m` now, or null when it may.
 *
 * **`retiring`, before anything else:** posted under a key whose secret leaked, and not yet on the
 * publisher's own signed list of what it signed, so it may have been planted with the stolen
 * secret. Nobody can take it, signed on or not, renewing or new [interchange spec §3, rev 7].
 *
 * `open` is the missions still open, when the caller knows them: a claim on a mission closed early
 * still held a place in the cap for up to a day, with no way to let it go [11.X].
 */
export function refusal(m: Mission, now: number, open?: ReadonlySet<string>): Refusal | null {
  if (retiringOf(m) === 'unconfirmed') return 'retiring';
  if (!signedOn()) return 'signed-out';
  if (!missionActive(m, new Date(now * 1000))) return 'ended';
  if (held(now).some((h) => h.address === m.address)) return null;
  if (m.claims === 'one' && m.state === 'claimed') return 'taken';
  if (held(now).filter((h) => !open || open.has(h.address)).length >= CLAIM_CAP) return 'cap';
  return null;
}

/**
 * Where something sealed on a mission `poster` posted goes now, or why nothing does — **the
 * registry's answer, and nothing any relay says** [core: trust.ts, `sealTargetOf`]. No relay is
 * asked, so nothing about a sealed claim or report goes out before it does.
 *
 * The inbox is the one NavCom's release pins beside the publisher [interchange spec §5.0]. It was
 * the newest kind-10050 list the poster signed, by the date the signer wrote, which whoever holds an
 * exposed secret could sign for next year. The key is the publisher's newest one trusted to sign and
 * not exposed: **nothing is sealed to a key whose secret leaked**, because whoever holds it can fetch
 * every wrap addressed to it and open it (decided 2026-10-18). Then sealed sending is paused, and
 * nothing is kept on the phone to send later [the-artifact-that-leaves.md P5].
 *
 * Judged on this device's clock floored at the build [floor.ts], since an end removes trust.
 */
export function sealTo(poster: string, now: number, publishers: MissionPublishers = MISSION_PUBLISHERS): SealTarget {
  return sealTargetOf(poster, publishers, floorNow(now * 1000));
}

/** The day `pubkey`'s secret was exposed, or null [core: package.ts, `exposed`]. */
export function exposedOn(pubkey: string, publishers: MissionPublishers = MISSION_PUBLISHERS): string | null {
  return keyOf(publishers, pubkey)?.key.exposed ?? null;
}

/** The poster by the registry's name, for a record that kept only its key. */
const posterName = (poster: string, publishers: MissionPublishers = MISSION_PUBLISHERS) => keyOf(publishers, poster)?.entry.name ?? 'the poster';

/**
 * Whose leaked key something sealed went to, for the row in this device's own history that says so
 * [decided 2026-10-18, decision 2]: the publisher's name and the day the secret was exposed, or
 * null for a key whose secret did not leak. Worked out from what the row kept and the registry;
 * nothing new is stored.
 */
export function leakedTo(key: string, publishers: MissionPublishers = MISSION_PUBLISHERS): { name: string; exposed: string } | null {
  const found = keyOf(publishers, key);
  return found?.key.exposed ? { name: found.entry.name, exposed: found.key.exposed } : null;
}

/** The poster's key, from a package's address, `30079:<pubkey>:<d>`. */
export const posterOfAddress = (address: string) => address.split(':')[1] ?? '';

/**
 * Why sealed sending to `name` is off, in words: said on the choice itself, before anything can be
 * sent, and wherever something sealed would have gone [decided 2026-10-18].
 */
export const pausedWords = (name: string) =>
  `Sealed sending to ${name} is paused: its key's secret leaked, so whoever holds it could open anything sealed to it. Nothing is kept on this phone; come back once ${name} reads under a new key.`;

/**
 * The same pause where no secret leaked: no key of `name`'s is current in this version of NavCom —
 * one ended unrenewed, or this phone is running a version past its keys' ends. Said apart, because
 * telling somebody a key leaked when none did is the one thing these words must never say.
 */
export const lapsedWords = (name: string) =>
  `Sealed sending to ${name} is paused: none of its keys is current in this version of NavCom, so there is no key to seal to. Nothing is kept on this phone.`;

/** Why nothing goes sealed now, for a target that is not one. No relay was asked, so none is blamed. */
export function nowhereFor(t: Exclude<SealTarget, { ok: true }>, name: string): string {
  if (t.why === 'paused') return pausedWords(name);
  if (t.why === 'lapsed') return lapsedWords(name);
  if (t.why === 'no-inbox') return `NavCom has no inbox for ${name}, so there is nowhere to send it sealed.`;
  return `NavCom no longer reads the key ${name} posted this with, so there is nowhere to send it sealed.`;
}

/** Why nothing went sealed, in words, with no retry suggested that would change it [11.E]. */
export const noInbox = (t: Exclude<SealTarget, { ok: true }>, name: string) => `${nowhereFor(t, name)} Nothing was sent.`;

/** The same, for something sent before that may have arrived: only this attempt is said to have sent nothing [finding 61]. */
export const noInboxAgain = (t: Exclude<SealTarget, { ok: true }>, name: string) => `${MAY_HAVE_ARRIVED} ${nowhereFor(t, name)} Nothing was sent this time.`;

/** Something sealed, sent again with nowhere to go: nothing left this time, and why, in words. */
export type Nowhere = { nowhere: string };

/**
 * Where something sealed is sent again: **the inbox this release pins now**, and only while the key
 * it was sealed to is still the one to seal to — the same wrap cannot go anywhere else, and a key
 * whose secret leaked is never one [rev 7]. A record kept before 2026-10-17 was aimed by a kind-10050
 * list whoever holds an exposed key could sign, so where it was stored is never used.
 */
export function sealedAgain(poster: string, sealedToKey: string | undefined, now: number, w: Wire): string[] | Nowhere {
  const t = sealTo(poster, now, w.publishers);
  const name = posterName(poster, w.publishers);
  if (!t.ok) return { nowhere: noInboxAgain(t, name) };
  if (t.key !== (sealedToKey ?? poster)) return { nowhere: `${MAY_HAVE_ARRIVED} It was sealed to a key ${name} no longer reads under, so it cannot go again. Nothing was sent this time.` };
  return usable([...t.inbox]);
}


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
): Promise<{ ok: true; event: Event; id: string | null; relays: string[]; refused: string; sealedTo?: string } | { ok: false; because: string }> {
  const contact = ensureContactKey();
  if (visibility === 'open') {
    const event = buildMissionClaim(contact, label, t.address, ends, now);
    return { ok: true, event, id: event.id, relays: operatorRelays(), refused: 'No relay took it. Nothing was sent; try again with signal.' };
  }
  // Nothing is built, signed or kept before the target is known to be one [rev 7].
  const to = sealTo(t.poster, now, w.publishers);
  if (!to.ok) return { ok: false, because: noInbox(to, t.posterName) };
  const relays = usable([...to.inbox]);
  if (relays.length === 0) return { ok: false, because: noInbox({ ok: false, why: 'no-inbox', entry: to.entry }, t.posterName) };
  const event = buildSealedMissionClaim(contact, to.key, label, t.address, ends, now);
  return { ok: true, event, id: null, relays, refused: `${t.posterName}'s inbox did not take it. Nothing was sent.`, sealedTo: to.key };
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
    ...(replaces.length ? { replaces } : {}),
    ...(built.sealedTo ? { sealedTo: built.sealedTo } : {})
  };
  const hadHistory = history(now).some((t) => t.mission.address === m.address);
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
 * whatever comes back: a relay refusing it now says nothing about the first time. A sealed one goes
 * to the poster's inbox as this release pins it, or nowhere, and says so [`sealedAgain`].
 */
export async function claimAgain(address: string, now: number, w: Wire = wire): Promise<Published | 'gone' | Nowhere> {
  const h = held(now).find((x) => x.address === address);
  if (!h?.unconfirmed) return 'gone';
  const to = h.visibility === 'sealed' ? sealedAgain(posterOfAddress(h.address), h.sealedTo, now, w) : usable(h.relays ?? operatorRelays());
  if (!Array.isArray(to)) return to;
  const result = await w.publish(to, h.unconfirmed);
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
export type Release =
  | { sent: true }
  | { sent: false; card: true }
  /** `nowhere`: sealed, and this release pins no inbox for its poster, so nothing was sent and `because` says why. */
  | { sent: false; unconfirmed: boolean; because: string; nowhere?: true };

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
  /*
   * A sealed release goes to the inbox this release pins now, never where it was stored, and only to
   * the key the claim was sealed to while that key is still the one to seal to [`sealedAgain`]. A
   * key whose secret leaked never is [rev 7]: nothing is sealed to it, and nothing is kept on the
   * phone to send later, so the release does not go and the claim ends by itself, within a day.
   */
  if (u.visibility === 'sealed') {
    const target = sealTo(u.poster, now, w.publishers);
    // No inbox pinned, or a poster this release does not read: kept as it was, in case a release pins one.
    if (!target.ok && target.why !== 'paused') {
      keepUnreleased(u, now);
      return { sent: false, unconfirmed: false, because: u.mayHaveArrived ? noInboxAgain(target, u.posterName) : noInbox(target, u.posterName), nowhere: true };
    }
    // Paused, or sealed to a key it would not be sealed to now: it can never go, so nothing is kept for it.
    if (!target.ok || target.key !== (u.sealedTo ?? u.poster)) {
      dropUnreleased(u.address, now);
      const why = target.ok ? `It was sealed to a key ${u.posterName} no longer reads under.` : nowhereFor(target, u.posterName);
      const before = u.mayHaveArrived ? `${MAY_HAVE_ARRIVED} ` : '';
      return { sent: false, unconfirmed: false, because: `${before}The release cannot go. ${why} The claim ends by itself within a day.`, nowhere: true };
    }
    to = usable([...target.inbox]);
  }
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
