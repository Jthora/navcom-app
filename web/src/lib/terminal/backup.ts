/**
 * Everything an operator would need on another phone.
 *
 * Accruing fields only, and of those only the ones `fields.ts` says cross. That is not a
 * shortcut — the tiers already encode exactly this distinction: **accruing is the decade,
 * wipeable is tonight.** A backup that carried tonight would carry the thing a panic wipe exists
 * to destroy, and restoring it would undo a wipe somebody meant. And some of the decade is this
 * phone's own: the relays it talks to, the key bundles it learned, the watch key it holds.
 */

import { openBackup, publicKeyOf, sealBackup, secretFromHex } from '@navcom/core';
import { get, set } from './storage';
import { forgetOfferedWatch, offeredWatch, offerWatch, type NamedWatch } from './config';
import { carryOf } from './fields';

export type { NamedWatch } from './config';

/**
 * The most keys a real backup carries, with room to spare.
 *
 * A restore writes into the tier holding the identity, the standing and the patrol record,
 * and a full phone stops saving [1.E]. A blob is pasted rather than fetched, so nothing else
 * bounds it. `fields.test.ts` holds what a kit may carry under it, so every kit this build
 * makes is one restore accepts.
 */
export const MAX_RESTORED_KEYS = 64;

export interface Kit {
  v: 1;
  at: string;
  /** The accruing fields `fields.ts` says cross: the decade, and the watch to offer. */
  accruing: Record<string, unknown>;
  /**
   * The phone it was made on held a watch key, which a kit never carries: so the phone it is
   * restored on can say the key stayed behind, rather than "Restored" to a holder who would then
   * believe they still hold the watch. That a key existed, never the key.
   */
  watch_key_stayed?: true;
}

export class BackupError extends Error {}

/**
 * The accruing tier, or a refusal.
 *
 * **Damaged is not the same as empty**, and this returned `{}` for both. 0.X established that
 * corrupt storage reads as empty everywhere else, which is the right call — a terminal that
 * will not start is worse than one asking to be set up again. It is the wrong call *here*: it
 * means an operator whose storage is damaged makes a backup, is told it worked, keeps it for
 * a year, and it holds **nothing**. The one artifact meant to survive a lost phone, silently
 * empty.
 */
function accruing(): Record<string, unknown> {
  if (typeof localStorage === 'undefined') return {};
  const raw = localStorage.getItem('navcom.accruing');
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed;
  } catch {
    throw new BackupError(
      'This phone\u2019s storage is damaged, so a backup would be empty. Nothing has been written. Status has more about what can be salvaged.'
    );
  }
}

/** When a backup was last made on this device, as an ISO date, or null. */
const MADE = 'backup_made';

/**
 * The last time this operator made a backup.
 *
 * Recorded because **the screen could state the rule and not whether it applied.** It says
 * *"a backup you never made does not exist"*, which is true and general, and the app had no
 * way to tell an operator which of those two people they were.
 *
 * The date matters more than the fact. Standing is built over years and peers accumulate, so
 * a backup made before any of that **does not hold it** — the operator has a safety net for
 * a version of themselves that no longer exists, and nothing said so.
 */
export const lastMade = (): string | null => get<string>('accruing', MADE);

/**
 * How a field of these crosses, or null for one that stays where it is: `fields.ts`, and one rule
 * it cannot say on its own.
 *
 * **The patrol record crosses only beside the setting that keeps it in the decade.** Without that
 * setting it lives in tonight's tier (`patrol.ts`), and a kit that wrote it into the decade put a
 * record on the phone that no screen shows and no panic wipe reaches: a seized phone with patrols
 * on it its owner never saw. Every build that wrote the record into the decade wrote the setting
 * with it, so a real kit loses nothing.
 */
function crosses(fields: Record<string, unknown>, field: string): 'kit' | 'watch' | null {
  const carry = carryOf(field);
  if (carry === 'device') return null;
  if (field === 'patrols' && fields['keep_patrol_history'] !== true) return null;
  return carry;
}

/** Seals what an operator would need. Throws on an empty passphrase. */
export function makeBackup(passphrase: string): string {
  const all = accruing();
  // Declared, never excepted: a field nobody listed stays on this phone [fields.ts].
  const kept = Object.fromEntries(Object.entries(all).filter(([k]) => crosses(all, k) !== null));
  // A blob that looks like a backup and holds nothing is worse than no backup, because the
  // operator stops worrying about it.
  if (Object.keys(kept).length === 0) {
    throw new BackupError(
      // A watch key alone would have been a backup once. Said, so a holder does not think the
      // file they did not get would have carried it.
      typeof all['watch_secret'] === 'string'
        ? 'There is nothing on this phone to back up yet. A backup never carries the watch key: it stays on this phone.'
        : 'There is nothing on this phone to back up yet.'
    );
  }

  const blob = sealBackup(passphrase, {
    v: 1,
    at: new Date().toISOString().slice(0, 10),
    accruing: kept,
    ...(typeof all['watch_secret'] === 'string' ? { watch_key_stayed: true as const } : {})
  } satisfies Kit);
  // After sealing, so a backup that threw is not recorded as one that exists.
  set('accruing', MADE, new Date().toISOString().slice(0, 10));
  return blob;
}

export class RestoreError extends Error {}

/**
 * Restores onto this device.
 *
 * **Refuses to overwrite an identity that is already here.** Restoring over a live persona
 * would destroy standing silently, and the operator doing it is usually somebody who
 * mistyped which phone they were holding. Burn first if that is genuinely the intent.
 */
export function restore(
  passphrase: string,
  blob: string
): {
  keys: number;
  watch: NamedWatch | null;
  /** What the kit carried that this phone did not take: its own keys, fields nobody declared, and a patrol record nothing kept. */
  withheld: string[];
  /** The old phone held a watch key, and it stayed there: a kit an older build made carried it, and is refused it here. */
  watchKeyStayed: boolean;
} {
  if (get<string>('accruing', 'secret')) {
    throw new RestoreError(
      'This phone already has an identity. Restoring would replace it and lose whatever it holds — burn it first if that is what you mean.'
    );
  }

  const kit = openBackup<Kit>(passphrase, blob);
  if (!kit || typeof kit !== 'object' || typeof kit.accruing !== 'object' || !kit.accruing) {
    throw new RestoreError('That backup is not one this version understands.');
  }
  // Declared and never checked. A kit written to a shape this build has never seen may mean
  // something different by the same key names, and restoring it writes into the tier that
  // holds an identity.
  if (kit.v !== 1) {
    throw new RestoreError('That backup was written by a newer version of NavCom than this one.');
  }

  const entries = Object.entries(kit.accruing);

  /*
   * A backup is a thing somebody can hand you.
   *
   * It is decrypted with a passphrase the operator types, so this is not an attack a stranger
   * runs at a distance — but *"here is your backup from the old phone, the passphrase is X"*
   * is an ordinary sentence, and what it wrote was **whatever keys the blob contained**.
   *
   * Bounded so that a "backup" cannot simply be a storage bomb: 1.E established that a full
   * phone stops saving, and this writes into the tier that holds the identity, the standing
   * and the patrol record.
   */
  if (entries.length > MAX_RESTORED_KEYS) {
    throw new RestoreError('That backup holds far more than a NavCom backup should. Nothing has been restored.');
  }

  /*
   * Only what a kit is declared to carry, read from the same list `makeBackup` seals by.
   *
   * The exclusions were enforced on the way out and not on the way in: `relays_own` was left out
   * of a backup we wrote and accepted from one we read, which let a crafted kit route everything
   * this operator sends through relays somebody else chose. Then the list was a deny-list, so a kit
   * could plant any field nobody had thought to deny — `kem_keys`, a crew roster, a watch key. A
   * field this phone keeps for itself, or one no build declared, is withheld and named.
   *
   * A watch is offered, never written: it decides where every Distress goes and who reads it
   * [audit: relay paths, F02].
   */
  const restored = entries.filter(([k]) => crosses(kit.accruing, k) === 'kit');
  const named = Object.fromEntries(entries.filter(([k]) => crosses(kit.accruing, k) === 'watch')) as Record<string, unknown>;
  const withheld = entries.filter(([k]) => crosses(kit.accruing, k) === null).map(([k]) => k);
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  /*
   * The escalation key travels with the watch it belongs to, inside the signed code it came in, and
   * is held with it until the operator adds the watch: written straight in, it would decide whose
   * answer ends this phone's Distress. Only a code that watch signed gives it a key (`offeredWatch`).
   * A bare `watch_executor`, from the build that kept the key on its own, is held back and never read:
   * nothing says which watch it was for, or that the watch named it.
   */
  const escalation = named['watch_escalation'];
  const watch: NamedWatch | null =
    typeof named['watchtower'] === 'string'
      ? {
          pubkey: named['watchtower'],
          relays: strings(named['relays']),
          holders: strings(named['watch_holders']),
          ...(typeof escalation === 'string' && escalation ? { escalation } : {})
        }
      : null;
  for (const [key, value] of restored) set('accruing', key, value);

  /*
   * The new phone adopts the date the kit was sealed.
   *
   * `MADE` is written after sealing, so it never travels inside a backup — which left an
   * operator who had just restored being told they had never made one. The kit already
   * records when it was made, and that is the more useful truth: **how old the safety net
   * they are now standing on actually is.**
   */
  if (restored.length === 0 && !watch) {
    // "Restored 0 things" read as a success. It is not one, and an operator told it worked
    // stops looking for the backup that would have.
    throw new RestoreError('That backup holds nothing. Whatever it was made from, it did not have anything on it.');
  }

  if (typeof kit.at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(kit.at)) {
    set('accruing', MADE, kit.at);
  }
  // Held until the operator adds it or forgets it, rather than for as long as one screen is open
  // [audit: relay paths, review]. Offered, never installed: nothing that sends reads it.
  if (watch) offerWatch(watch);
  else if (offeredWatch()) forgetOfferedWatch();
  return { keys: restored.length, watch, withheld, watchKeyStayed: kit.watch_key_stayed === true || withheld.includes('watch_secret') };
}

/** Restores from a bare recovery code — who you are, without what you held. */
export function restoreCode(code: string): void {
  const clean = code.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new RestoreError('A recovery code is 64 hexadecimal characters.');
  if (get<string>('accruing', 'secret')) {
    throw new RestoreError('This phone already has an identity. Burn it first if you mean to replace it.');
  }
  // Shape-valid is not the same as usable: found in robustness audit that a hex string this
  // wrong (all zeros, or any other value outside the curve's valid scalar range) passed the
  // regex above, was written to storage, and only failed later, silently, inside
  // loadIdentity()'s own catch -- the screen said "Your callsign is back" to an operator who
  // had no callsign at all.
  try {
    publicKeyOf(secretFromHex(clean));
  } catch {
    throw new RestoreError('That is not a usable recovery code — check it was copied in full.');
  }
  set('accruing', 'secret', clean);
}
