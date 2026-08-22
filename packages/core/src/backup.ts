import { nip44 } from 'nostr-tools';
import { scrypt } from '@noble/hashes/scrypt';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';

/**
 * Carrying an identity to another phone, and getting it back after a dropped one.
 *
 * A lost phone must not erase years of standing. There is no account here and there is not
 * going to be — an account needs identifying information, which is the thing this system
 * refuses to hold — but *"we hold no account"* was never a reason to let somebody lose a
 * decade to a cracked screen.
 *
 * ## One mechanism, two situations
 *
 * A backup you can restore **is** how you move to a new phone. They are not two features,
 * and building them as two would have meant two formats, one of them less tested.
 *
 * ## What a passphrase has to survive
 *
 * The blob is meant to be kept wherever the operator chooses — a note app, a USB stick, a
 * printout in a drawer, a message to themselves. Every one of those is somewhere it can be
 * found by somebody who should not have it, so the passphrase is doing real work rather
 * than ceremonial work.
 *
 * **scrypt at N=2^15**, which costs about a second on the device floor and 32 MB of memory
 * while it runs. N=2^16 would be twice as hard to attack and would want 64 MB — on a prepaid
 * phone with ~400 MB free that is a meaningful fraction, and a restore that fails on the
 * phone somebody just bought is worse than a slightly cheaper KDF. Measured rather than
 * guessed: see `docs/research/device-floor.md`.
 *
 * The AEAD is NIP-44's, given a passphrase-derived key rather than a conversation key. Same
 * composition the group envelope already makes, and the same reason: this project does not
 * ship its own cryptography on a boundary protecting people at risk.
 *
 * ## What it deliberately is not
 *
 * Not automatic, not scheduled, not synced anywhere. Nothing here uploads, and there is no
 * server that could hold a copy — which means a backup that was never made does not exist,
 * and the app has to say so plainly rather than implying a safety net it is not providing.
 */

/**
 * Cost, chosen against the device floor rather than against a benchmark.
 *
 * Exported so it can be pinned by a test. A work factor is the one security parameter that
 * can be lowered by somebody with entirely good intentions — a slow test suite, a sluggish
 * restore on an old phone — and nothing about the code would look wrong afterwards. The
 * reasoning for this number is above; a test holds the number itself.
 */
export const BACKUP_KDF = { N: 2 ** 15, r: 8, p: 1, dkLen: 32 } as const;
const KDF = BACKUP_KDF;
const V = 1;

export class BackupError extends Error {}

interface Envelope {
  v: number;
  /** Random per backup, so two backups of the same data under the same passphrase differ. */
  salt: string;
  data: string;
}

/**
 * The passphrase, as the person who typed it would recognise it.
 *
 * **NFKC** because the same characters can be different bytes depending on which keyboard
 * produced them, and an operator who set up on one device and restores on another must not
 * be refused their own passphrase.
 *
 * **Trimmed** for the same reason, and it is the same decision rather than a second one. The
 * blob is meant to live *"a note app, a USB stick, a printout in a drawer"* — every one of
 * those is a place a passphrase gets **pasted**, and a paste carries a trailing newline or
 * space more often than not. Untrimmed, that made a backup permanently unopenable, and
 * because a wrong passphrase and a damaged blob are deliberately indistinguishable, the
 * operator could never learn that a space was the whole problem. A decade of standing, lost
 * to whitespace.
 *
 * The entropy given up is nil: nobody's passphrase is strong because it ends in a space.
 *
 * Both sealing and opening go through here, so the two cannot disagree about what a
 * passphrase is — which is the failure this module could least afford.
 */
const keyFrom = (passphrase: string, salt: Uint8Array): Uint8Array =>
  scrypt(passphrase.trim().normalize('NFKC'), salt, KDF);

/**
 * Seals everything an operator would need on another phone.
 *
 * Refuses an empty passphrase rather than producing a blob that is encrypted in name only.
 * A short one is the operator's own trade to make; nothing is one.
 */
export function sealBackup(passphrase: string, payload: unknown): string {
  if (!passphrase.trim()) {
    throw new BackupError('A backup needs a passphrase. Without one it is a copy of your key in the clear.');
  }
  const salt = randomBytes(16);
  return JSON.stringify({
    v: V,
    salt: bytesToHex(salt),
    data: nip44.encrypt(JSON.stringify(payload), keyFrom(passphrase, salt))
  } satisfies Envelope);
}

/**
 * Opens a backup, or throws.
 *
 * A wrong passphrase and a corrupted blob are **deliberately the same error**. Telling them
 * apart would tell somebody holding a stolen backup whether they were getting closer, and
 * an operator who has mistyped tries again either way.
 */
export function openBackup<T = unknown>(passphrase: string, blob: string): T {
  let envelope: Envelope;
  try {
    envelope = JSON.parse(blob.trim()) as Envelope;
  } catch {
    throw new BackupError('That is not a NavCom backup.');
  }
  if (!envelope || envelope.v !== V || typeof envelope.salt !== 'string' || typeof envelope.data !== 'string') {
    throw new BackupError('That is not a backup this version understands.');
  }

  try {
    const key = keyFrom(passphrase, hexToBytes(envelope.salt));
    return JSON.parse(nip44.decrypt(envelope.data, key)) as T;
  } catch {
    throw new BackupError('Wrong passphrase, or the backup is damaged.');
  }
}

/** Whether a string looks like a backup, so a screen can tell it from a recovery code. */
export const isBackup = (value: string): boolean => {
  const t = value.trim();
  return t.startsWith('{') && t.includes('"salt"');
};
