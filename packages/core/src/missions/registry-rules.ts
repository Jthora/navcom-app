/**
 * What the build refuses in the publisher registry, and the file it publishes it as
 * [interchange spec §3, rev 7].
 *
 * Nothing here runs on a phone. `registryProblems` is run by core's own tests, which the deploy
 * runs as part of its build (`vercel.json`), so a registry breaking one of these rules never
 * ships — the same pattern as the six-month staleness rule on the community list. The rules are
 * the ones a release could get wrong in a hurry: an exposed key's end pushed later, a key left to
 * run out unrenewed, a second entry that reads as the first's name.
 *
 * `registryDocument` is what `/.well-known/navcom-publishers.json` holds, with its sha256 in the
 * interchange block of `/.well-known/navcom-intel.json`, so a publisher can check once a day that
 * the inbox and keys NavCom serves for it are the ones it agreed — the one check a release made
 * under compulsion cannot remove, because it runs somewhere else.
 */
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { FROZEN_SETS, type FrozenSet } from './frozen.js';
import { registryTime, type MissionPublishers } from './package.js';

/**
 * The digest the registry pins over a frozen list [package.ts, `frozen.sha256`]: sha256 over the
 * key, then one `<id> <d>` line per package in id order, newline-separated, UTF-8. Recomputable from
 * the published registry file, so anyone can check that what NavCom keeps is what it says it keeps.
 * The build refuses a list that does not match its pin [`registryProblems`].
 */
export function frozenDigest(set: Pick<FrozenSet, 'key' | 'packages'>): string {
  const lines = [...set.packages].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((p) => `${p.id} ${p.d}`);
  return bytesToHex(sha256(utf8ToBytes([set.key, ...lines].join('\n'))));
}

/**
 * The latest end any build may give an exposed key, by key. **Only ever moved earlier**: a late
 * end fails open, because a bundle already on a phone keeps trusting the key until it reloads.
 * `6301c4d0…` ends on 13 November 2026 (decided 2026-10-18).
 */
export const EXPOSED_LATEST: Readonly<Record<string, string>> = {
  '6301c4d09a014909e5a48b7d0c9aa859eec18804c2fc87eab4e414aa5a319692': '2026-11-13T00:00:00Z'
};

/** How far ahead a key's end may be: a year, so trusting a key is restated by a person at least that often. */
export const KEY_YEARS_MAX = 366 * 86_400;
/** How long a publisher's key must still run, once it has one that is not exposed: time to renew it before it lapses. */
export const RENEW_AHEAD_SECONDS = 60 * 86_400;

/**
 * Names no publisher may take, compared as `nameKey` compares them: this application's own, and
 * the bodies it speaks for or reads from, which a lure would most like to be mistaken for.
 */
export const RESERVED_NAMES: readonly string[] = ['NavCom', 'Earth Alliance', 'Starcom', 'The Record', 'Watchtower', 'Distress'];

/**
 * Capital Greek and Cyrillic letters that draw as a Latin capital, mapped before case is folded:
 * folded first, Greek `Ν` would become `ν`, which draws as a v, and a twin of `NavCom` would pass.
 */
const UPPER_TWINS: Readonly<Record<string, string>> = {
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X',
  'А': 'A', 'В': 'B', 'Е': 'E', 'Ѕ': 'S', 'І': 'I', 'Ј': 'J', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'У': 'Y', 'Х': 'X', 'Ү': 'Y', 'Һ': 'H', 'Ԁ': 'D', 'Ԛ': 'Q', 'Ԝ': 'W'
};
/** Small Greek and Cyrillic letters that draw as a small Latin one. */
const LOWER_TWINS: Readonly<Record<string, string>> = {
  'α': 'a', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x', 'γ': 'y', 'ω': 'w', 'η': 'n', 'μ': 'u',
  'а': 'a', 'в': 'b', 'е': 'e', 'ё': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x', 'ѕ': 's',
  'і': 'i', 'ї': 'i', 'ј': 'j', 'һ': 'h', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w', 'ӏ': 'l', 'ү': 'y', 'ь': 'b'
};
/** Built on first use, not at load: a module-level call would keep the tables in every bundle that imports core, used or not. */
let twins: { upper: RegExp; lower: RegExp } | null = null;
const twinsOf = () => (twins ??= { upper: new RegExp(`[${Object.keys(UPPER_TWINS).join('')}]`, 'g'), lower: new RegExp(`[${Object.keys(LOWER_TWINS).join('')}]`, 'g') });

/**
 * A name as two readers would confuse it: NFKC, case-folded, and with everything that is not a
 * letter or a digit removed, so `Mecha  Jono`, `MECHA JONO` and `Mecha-Jono` are one name. Zero
 * and one become o and l, the look-alikes a screen at night would not tell apart.
 *
 * **Letters of another script that draw as Latin ones become those Latin letters** — Greek and
 * Cyrillic, the two a phone's own fonts draw identically — because NFKC leaves them as they are:
 * `Mеcha Jono` with a Cyrillic е and `NavCοm` with a Greek ο passed as new names, and would render
 * as the names they copy [adversary pass, 2026-10-18]. Not the whole Unicode confusables table: a
 * name in either script is still a name, and only the letters that are twins are folded.
 */
export function nameKey(name: string): string {
  const { upper, lower } = twinsOf();
  return name
    .normalize('NFKC')
    .replace(upper, (c) => UPPER_TWINS[c]!)
    .toLowerCase()
    .replace(lower, (c) => LOWER_TWINS[c]!)
    .replace(/[^\p{L}\p{N}]/gu, '')
    .replace(/0/g, 'o')
    .replace(/1/g, 'l');
}

const HEX64 = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Everything wrong with `registry` at `at` (Unix seconds — the build's moment), in words. Empty
 * means it may ship.
 *
 * **The 60-day rule, stated exactly:** an entry is refused when it has at least one key that is
 * not exposed and has a `notBefore`, and none of those keys has a `notAfter` at least 60 days after
 * `at`. An entry whose only keys trusted to sign are exposed is not held to it — Mecha Jono's,
 * until the release that gives `86f824c3…` its start — because it has nothing to renew: its exposed
 * key ends on its own date, held by `EXPOSED_LATEST`. From that release on, the new key must run 60
 * days past every build, so it is renewed before it lapses.
 */
export function registryProblems(registry: MissionPublishers, at: number, sets: readonly FrozenSet[] = FROZEN_SETS): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const names = new Map<string, string>();
  const keys = new Set<string>();
  const reserved = new Map(RESERVED_NAMES.map((n) => [nameKey(n), n]));

  for (const entry of registry) {
    const who = `${entry.id}`;
    if (!ID.test(entry.id)) problems.push(`${who}: the id must be lowercase letters, digits and hyphens, at most 32.`);
    if (ids.has(entry.id)) problems.push(`${who}: two entries share this id.`);
    ids.add(entry.id);

    const name = nameKey(entry.name);
    if (!name) problems.push(`${who}: it has no name.`);
    else if (reserved.has(name)) problems.push(`${who}: "${entry.name}" reads as ${reserved.get(name)}, which no publisher may be called.`);
    else if (names.has(name)) problems.push(`${who}: "${entry.name}" reads as "${names.get(name)}", another entry's name.`);
    names.set(name, entry.name);

    if (entry.next !== null) problems.push(`${who}: next is reserved, and nothing reads it yet.`);
    for (const url of entry.inbox ?? []) if (!url.startsWith('wss://')) problems.push(`${who}: its inbox ${url} is not a secure relay address.`);
    if (entry.keys.length === 0) problems.push(`${who}: it has no key.`);

    const generations = new Set<number>();
    for (const key of entry.keys) {
      const k = `${who} ${key.pubkey.slice(0, 8)}`;
      if (!HEX64.test(key.pubkey)) problems.push(`${k}: not 64 lowercase hex.`);
      if (keys.has(key.pubkey)) problems.push(`${k}: listed twice.`);
      keys.add(key.pubkey);
      if (!Number.isInteger(key.generation) || key.generation < 1) problems.push(`${k}: its generation must be a whole number from 1.`);
      if (generations.has(key.generation)) problems.push(`${k}: two keys of one publisher share generation ${key.generation}.`);
      generations.add(key.generation);

      const end = registryTime(key.notAfter);
      const start = registryTime(key.notBefore);
      if (!Number.isFinite(end)) problems.push(`${k}: its notAfter is not a date.`);
      else if (end > at + KEY_YEARS_MAX) problems.push(`${k}: its notAfter is more than a year after this build.`);
      if (key.notBefore !== undefined && !Number.isFinite(start)) problems.push(`${k}: its notBefore is not a date.`);
      if (Number.isFinite(start) && Number.isFinite(end) && start >= end) problems.push(`${k}: it ends before it starts.`);

      if (key.exposed !== undefined) {
        if (!DAY.test(key.exposed)) problems.push(`${k}: the day it was exposed must be YYYY-MM-DD.`);
        const latest = registryTime(EXPOSED_LATEST[key.pubkey]);
        if (!Number.isFinite(latest)) problems.push(`${k}: it is exposed, and EXPOSED_LATEST gives it no latest end.`);
        else if (!(end <= latest)) problems.push(`${k}: it is exposed, and its notAfter is later than ${EXPOSED_LATEST[key.pubkey]}.`);
      }
      if (key.frozen) {
        if (key.exposed === undefined) problems.push(`${k}: it is frozen and not marked exposed.`);
        const set = sets.find((s) => s.key === key.pubkey);
        if (!set) problems.push(`${k}: it is frozen, and frozen.ts holds no list for it.`);
        else if (frozenDigest(set) !== key.frozen.sha256) problems.push(`${k}: its frozen list does not match the digest pinned beside it.`);
      }
    }

    // The 60-day rule [above].
    const renewable = entry.keys.filter((k) => k.exposed === undefined && k.notBefore !== undefined);
    if (renewable.length > 0 && !renewable.some((k) => registryTime(k.notAfter) >= at + RENEW_AHEAD_SECONDS)) {
      problems.push(`${who}: no key it signs with runs 60 days past this build; renew one by release.`);
    }
  }
  return problems;
}

/** The registry as the file a publisher checks: everything the release pins, and the rules it is read by. */
export function registryDocument(registry: MissionPublishers, sets: readonly FrozenSet[] = FROZEN_SETS) {
  return {
    spec: 'navcom-publishers',
    version: '1.0.0',
    document: 'https://navcom.app/docs/spec/mission-interchange.spec/',
    rules: [
      'A key is trusted to sign from its notBefore until its notAfter, judged on the reader\'s clock and never earlier than the build. A key with no notBefore is trusted to sign nothing, and an event dated before its key\'s notBefore is dropped',
      'For one publisher and one d, a higher generation outranks a lower one whatever created_at says',
      'A frozen key keeps only the package versions on its list, and versions that close one of their missions. Unconfirmed, each shows at its jurisdiction only and cannot be taken',
      'Nothing is sealed to an exposed key, and no label counts from a key that is exposed, frozen, or not trusted to sign on the reader\'s clock, whichever word it says',
      'Sealed claims and reports go to the inbox below, never to one a relay names, and to the publisher\'s newest key that is trusted to sign and not exposed; with none, sealed sending to it is paused',
      'A version dated more than a day ahead of the reader\'s clock is dropped'
    ],
    publishers: registry.map((entry) => ({
      id: entry.id,
      name: entry.name,
      agent: entry.agent,
      inbox: entry.inbox ?? [],
      keys: entry.keys.map((key) => {
        const set = key.frozen ? sets.find((s) => s.key === key.pubkey) : undefined;
        return {
          pubkey: key.pubkey,
          generation: key.generation,
          notBefore: key.notBefore ?? null,
          notAfter: key.notAfter,
          exposed: key.exposed ?? null,
          frozen: key.frozen
            ? { sha256: key.frozen.sha256, confirmed: key.frozen.confirmed, packages: set ? [...set.packages].sort((a, b) => (a.id < b.id ? -1 : 1)) : [] }
            : null
        };
      }),
      next: entry.next
    }))
  };
}
