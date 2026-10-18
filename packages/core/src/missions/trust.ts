/**
 * Who NavCom trusts to sign, and to seal to, right now [interchange spec §3 and §5.0, rev 7].
 *
 * The registry [package.ts] says which keys belong to which publisher and over what dates. This is
 * those dates applied: **one gate, asked of every package before anything is kept** — before a
 * relay's share is capped, before versions are merged, and again when the copy on the device is
 * read back — so a flood under a stolen key cannot push a genuine version out, and a copy kept by
 * an earlier build cannot carry back in what this one refuses.
 *
 * Three rules from the key compromise of 2026-09-28, each a reason something is dropped:
 *
 * - **The reader's clock, with a floor.** A key's window is judged on this device's clock, never on
 *   the date an event carries, and that clock is never earlier than the build [`trustClock`]. A
 *   phone set back a month cannot revive a key that has ended
 * - **A start date grants, an end removes.** A key with no `notBefore` signs nothing NavCom keeps,
 *   and an event dated before its key's start is dropped even once the start has passed, so a
 *   forgery made in the gap never becomes trusted
 * - **A frozen key keeps only its list** [frozen.ts], and versions that close one of its missions.
 *   Closing sends nobody anywhere; anything else from a key whose secret is out could be a lure
 *
 * Pure: the clock is always an argument.
 */
import { FUTURE_TOLERANCE_DAYS } from '../attestation.js';
import { FROZEN_SETS, type FrozenSet } from './frozen.js';
import { MISSION_PACKAGE_KIND, keyOf, registryTime, type MissionPublisher, type MissionPublishers, type PublisherKey } from './package.js';

/**
 * The clock trust is judged on, in Unix seconds: this device's, or the moment the build was made
 * if that is later. A phone cannot legitimately predate the build it runs [web: built.ts], so the
 * later of the two is never wrong in the direction that matters here — reviving a key that ended.
 */
export function trustClock(deviceMs: number, builtAt: string | null): number {
  const built = builtAt === null ? NaN : Date.parse(builtAt);
  return Math.floor((Number.isFinite(built) ? Math.max(deviceMs, built) : deviceMs) / 1000);
}

/** Whether NavCom trusts what `key` signs at `at`: it has a start, it has begun, and it has not ended. */
export function trustedToSign(key: PublisherKey, at: number): boolean {
  const start = registryTime(key.notBefore);
  const end = registryTime(key.notAfter);
  return Number.isFinite(start) && Number.isFinite(end) && start <= at && at < end;
}

/** A frozen key's list, checked against the digest the registry pins. */
export interface Frozen {
  ids: ReadonlySet<string>;
  /** The `d` of each mission on the list: a version there that closes it may be kept too. */
  ds: ReadonlySet<string>;
}

/**
 * `key`'s frozen list, or null when it is not frozen or no list for it is on hand — and then nothing
 * under it is kept. That the list is the one the registry pinned, byte for byte, is the build's to
 * refuse [registry-rules.ts, `registryProblems`]: a phone re-checking a pin shipped beside the list
 * it pins would prove nothing about either.
 */
export function frozenSetOf(key: PublisherKey, sets: readonly FrozenSet[] = FROZEN_SETS): Frozen | null {
  if (!key.frozen) return null;
  const set = sets.find((s) => s.key === key.pubkey);
  if (!set) return null;
  return { ids: new Set(set.packages.map((p) => p.id)), ds: new Set(set.packages.map((p) => p.d)) };
}

/**
 * Why a package is dropped before anything else is asked of it, or null to keep it:
 *
 * - `unknown` — not a key NavCom reads
 * - `untrusted` — its key has no start: NavCom does not trust it to sign yet
 * - `early` — dated before its key's start
 * - `window` — its key's window is not open on this device's clock, floored at the build
 * - `future` — dated more than a day past that clock. Dropped, not flagged: a date ahead is how a
 *   stolen key wins a sort by date
 * - `unpinned` — its key is frozen and no list for it is on hand
 * - `frozen` — its key is frozen, it is not on the list, and it closes nothing on it
 */
export type Dropped = 'unknown' | 'untrusted' | 'early' | 'window' | 'future' | 'unpinned' | 'frozen';

/** What the gate reads of an event: nothing that costs a signature check. */
export interface Gated {
  id: string;
  pubkey: string;
  created_at: number;
  tags: readonly (readonly string[])[];
}

const tagOf = (e: Gated, name: string) => e.tags.find((t) => t[0] === name)?.[1];

/** The registry gate [this module's header]. Cheap: no signature, no parse of the content. */
export function gate(e: Gated, registry: MissionPublishers, at: number, sets: readonly FrozenSet[] = FROZEN_SETS): Dropped | null {
  const found = keyOf(registry, e.pubkey);
  if (!found) return 'unknown';
  const { key } = found;
  const start = registryTime(key.notBefore);
  if (!Number.isFinite(start)) return 'untrusted';
  if (e.created_at < start) return 'early';
  if (!trustedToSign(key, at)) return 'window';
  if (e.created_at > at + FUTURE_TOLERANCE_DAYS * 86_400) return 'future';
  if (!key.frozen) return null;
  const set = frozenSetOf(key, sets);
  if (!set) return 'unpinned';
  if (set.ids.has(e.id)) return null;
  const d = tagOf(e, 'd');
  return d !== undefined && set.ds.has(d) && tagOf(e, 'mission_state') === 'closed' ? null : 'frozen';
}

/**
 * Where a version competes with the others: its publisher's entry and its `d`, **never its
 * address**. The address holds the key, so grouped by address a republish under a new key would
 * show beside the old one, and the old key's version could never be replaced.
 */
export function slotOf(e: Gated, registry: MissionPublishers): string | null {
  const found = keyOf(registry, e.pubkey);
  return found ? `${found.entry.id} ${tagOf(e, 'd') ?? ''}` : null;
}

/** What two versions in one slot are ranked by. */
export interface Ranked {
  generation: number;
  created_at: number;
  id: string;
}

export function rankOf(e: Gated, registry: MissionPublishers): Ranked {
  return { generation: keyOf(registry, e.pubkey)?.key.generation ?? 0, created_at: e.created_at, id: e.id };
}

/**
 * Whether `a` outranks `b` in one slot: **the higher generation first, whatever either says about
 * when**, then the newer, then the lower id [NIP-01], so every device agrees. A stolen old key
 * dating a version next year cannot override what its successor signed.
 */
export function outranks(a: Ranked, b: Ranked): boolean {
  if (a.generation !== b.generation) return a.generation > b.generation;
  if (a.created_at !== b.created_at) return a.created_at > b.created_at;
  return a.id < b.id;
}

/** Whether `key` speaks for its publisher at `at`: trusted to sign then, and neither exposed nor frozen. */
const speaks = (key: PublisherKey, at: number) => !key.exposed && !key.frozen && trustedToSign(key, at);

/**
 * The keys whose `settled` label counts on a mission `poster` posted: its publisher's keys trusted
 * to sign at `at`, **none exposed and none frozen**. Whoever holds an exposed secret could settle
 * anything, and settling is where standing mints; a report it would have settled settles by
 * silence instead, which still counts as settled [interchange spec §5.3]. A poster NavCom does not
 * read settles nothing.
 */
export function settlersOf(poster: string, registry: MissionPublishers, at: number): ReadonlySet<string> {
  const found = keyOf(registry, poster);
  if (!found) return new Set();
  return new Set(found.entry.keys.filter((k) => speaks(k, at)).map((k) => k.pubkey));
}

/**
 * Whether a label `pubkey` signed, dated `signedAt`, is read at all on a report — any of the three
 * words, not only `settled` [decided 2026-10-18, decision 3: none of the frozen key's labels counts].
 *
 * A key the registry does not list is anybody's, and is heard as anybody is. **A key it lists is
 * heard only while it speaks for its publisher**: trusted to sign at `at`, neither exposed nor
 * frozen, and on a label dated from its start. Whoever holds an exposed secret, or the secret of a
 * key not trusted yet, could otherwise settle a report as a witness — and on a report sealed beside
 * open ones, by the inner id the leaked key unwraps — or challenge one, and either would read under
 * the publisher's own name. A report it would have settled settles by silence instead.
 */
export function labelHeard(registry: MissionPublishers, at: number): (pubkey: string, signedAt: number) => boolean {
  return (pubkey, signedAt) => {
    const found = keyOf(registry, pubkey);
    if (!found) return true;
    return speaks(found.key, at) && signedAt >= registryTime(found.key.notBefore);
  };
}

/** What a mission a device kept is checked by: its key, its `d`, and when it says it was posted. */
export interface KeptMission {
  address: string;
  d: string;
  publisher: { pubkey: string };
  publishedAt: number;
}

/**
 * Whether a mission this device kept as a parsed mission — in its history, by whatever build it ran
 * when it took part — is one this build would keep now, so it may still be reported on [`gate`].
 *
 * The history holds no event, so the gate is asked of what it does hold: the key must be one this
 * build trusts to sign at `at`, the mission dated from that key's start and not ahead of `at`; and
 * under a frozen key, its `d` must be on the frozen list. By `d`, since there is no id to ask by: a
 * report names the mission's address, which is the same for every version at that `d`, so nothing
 * it tells is told about a mission the list does not hold. Without this, a mission an earlier build
 * kept under a key this one refuses — Mecha Jono's next key, which the bundle before this one
 * trusted at once, or its old key at a `d` planted after the leak — stayed under "To report", and an
 * open report on it told whoever signed it which card did the work.
 */
export function keptMissionTrusted(m: KeptMission, registry: MissionPublishers, at: number, sets: readonly FrozenSet[] = FROZEN_SETS): boolean {
  if (m.address !== `${MISSION_PACKAGE_KIND}:${m.publisher.pubkey}:${m.d}`) return false;
  const found = keyOf(registry, m.publisher.pubkey);
  if (!found) return false;
  const { key } = found;
  const start = registryTime(key.notBefore);
  if (!Number.isFinite(start) || !(m.publishedAt >= start)) return false;
  if (!trustedToSign(key, at)) return false;
  if (m.publishedAt > at + FUTURE_TOLERANCE_DAYS * 86_400) return false;
  if (!key.frozen) return true;
  return frozenSetOf(key, sets)?.ds.has(m.d) ?? false;
}

/**
 * Where something sealed on a mission `poster` posted goes now, or why nothing does:
 *
 * - the key — **its publisher's newest key that NavCom trusts to sign now and whose secret was not
 *   exposed**, which need not be the key that posted the mission: the work on an old key's mission
 *   is told to the publisher under its new one. `since` is when that key's start fell, which is when
 *   sealed sending to this publisher resumed
 * - `paused` — no key it could be, **because the one NavCom trusts to sign now is exposed**.
 *   Nothing is sealed to an exposed key: whoever holds its secret can fetch the wraps addressed to it
 *   and open them, and prove which card sent each. Nothing is held on the phone to send later either
 *   [the-artifact-that-leaves.md P5]
 * - `lapsed` — no key it could be, and no exposure is why: none is trusted to sign now, because one
 *   ended unrenewed, or a bundle is running past its keys' ends. Said apart from `paused`, so a
 *   phone never tells somebody a secret leaked when none did
 * - `no-inbox` — the release pins no inbox for it
 * - `unknown` — not a publisher this release reads
 *
 * The release that gives a publisher's new key its start therefore resumes sealed sending to that
 * key, unless the same release names a separate inbox key, which nothing does yet.
 */
export type SealTarget =
  | { ok: true; entry: MissionPublisher; key: string; inbox: readonly string[]; since: number }
  | { ok: false; why: 'paused' | 'lapsed' | 'no-inbox'; entry: MissionPublisher }
  | { ok: false; why: 'unknown' };

export function sealTargetOf(poster: string, registry: MissionPublishers, at: number): SealTarget {
  const found = keyOf(registry, poster);
  if (!found) return { ok: false, why: 'unknown' };
  const { entry } = found;
  const live = entry.keys.filter((k) => trustedToSign(k, at));
  const key = live.filter((k) => speaks(k, at)).sort((a, b) => b.generation - a.generation)[0];
  if (!key) return { ok: false, why: live.some((k) => k.exposed !== undefined || k.frozen) ? 'paused' : 'lapsed', entry };
  const inbox = (entry.inbox ?? []).filter((u) => u.startsWith('wss://'));
  if (inbox.length === 0) return { ok: false, why: 'no-inbox', entry };
  return { ok: true, entry, key: key.pubkey, inbox, since: registryTime(key.notBefore) };
}

/** The day a key of `poster`'s publisher was exposed, if the key itself was, or null. */
export function exposedKey(pubkey: string, registry: MissionPublishers): string | null {
  return keyOf(registry, pubkey)?.key.exposed ?? null;
}
