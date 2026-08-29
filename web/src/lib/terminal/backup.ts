/**
 * Everything an operator would need on another phone.
 *
 * The accruing tier and nothing else. That is not a shortcut — the tiers already encode
 * exactly this distinction: **accruing is the decade, wipeable is tonight.** A backup that
 * carried tonight would carry the thing a panic wipe exists to destroy, and restoring it
 * would undo a wipe somebody meant.
 */

import { openBackup, publicKeyOf, sealBackup, secretFromHex } from '@navcom/core';
import { get, set } from './storage';

/** Keys that are this device's business rather than this operator's. */
const DEVICE_ONLY = ['relays_own'];

/**
 * The most keys a real backup carries, with room to spare.
 *
 * A restore writes into the tier holding the identity, the standing and the patrol record,
 * and a full phone stops saving [1.E]. A blob is pasted rather than fetched, so nothing else
 * bounds it.
 */
const MAX_RESTORED_KEYS = 64;

export interface Kit {
  v: 1;
  at: string;
  /** Every accruing key except the ones that describe this handset. */
  accruing: Record<string, unknown>;
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

/** Seals what an operator would need. Throws on an empty passphrase. */
export function makeBackup(passphrase: string): string {
  const all = accruing();
  const kept = Object.fromEntries(Object.entries(all).filter(([k]) => !DEVICE_ONLY.includes(k)));
  // A blob that looks like a backup and holds nothing is worse than no backup, because the
  // operator stops worrying about it.
  if (Object.keys(kept).length === 0) {
    throw new BackupError('There is nothing on this phone to back up yet.');
  }

  const blob = sealBackup(passphrase, {
    v: 1,
    at: new Date().toISOString().slice(0, 10),
    accruing: kept
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
export function restore(passphrase: string, blob: string): { keys: number } {
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
   * `DEVICE_ONLY` was enforced on the way out and not on the way in.
   *
   * The same list, twelve lines above, describes these as *"this device's business rather
   * than this operator's"* — and `relays_own` is the list of relays this phone talks to. A
   * crafted backup could set it, which routes everything this operator sends through relays
   * somebody else chose. Excluded from a backup we write, accepted from one we read.
   */
  const restored = entries.filter(([k]) => !DEVICE_ONLY.includes(k));
  for (const [key, value] of restored) set('accruing', key, value);

  /*
   * The new phone adopts the date the kit was sealed.
   *
   * `MADE` is written after sealing, so it never travels inside a backup — which left an
   * operator who had just restored being told they had never made one. The kit already
   * records when it was made, and that is the more useful truth: **how old the safety net
   * they are now standing on actually is.**
   */
  if (restored.length === 0) {
    // "Restored 0 things" read as a success. It is not one, and an operator told it worked
    // stops looking for the backup that would have.
    throw new RestoreError('That backup holds nothing. Whatever it was made from, it did not have anything on it.');
  }

  if (typeof kit.at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(kit.at)) {
    set('accruing', MADE, kit.at);
  }
  return { keys: restored.length };
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
