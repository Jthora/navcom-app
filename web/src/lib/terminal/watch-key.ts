/**
 * The Watchtower key, on a phone.
 *
 * A watch running on a box generates this on the box and never copies it off. A squad with
 * no box has no box to put it on, so it lives here instead — and *"a squad with no hardware
 * and no technical member"* is the common case, not the edge one.
 *
 * ## What this key is, and what it is not
 *
 * It is the watch's **identity**: the address operators send to, and the key that signs
 * watch state and answers. It is **not** what makes signals readable — those are sealed to
 * each member's own operator key [`@navcom/core`'s `crypto/group.ts`], which is what lets
 * somebody be removed from a squad without re-provisioning everyone.
 *
 * ## The consequence, stated rather than discovered
 *
 * Every member of a squad holds this key, because any of them may need to answer. So
 * **anybody who has ever been a member can publish watch state** — including somebody
 * removed from the holder list. Removing them stops them *reading* new signals; it does not
 * stop them claiming, on the public record, to be the watch.
 *
 * That is the key-rotation gap `bootstrap.spec.md` already records as a Mk1 requirement,
 * and it is why a squad-held watch is only for people who already know each other. It is
 * written here rather than left implicit, because the alternative is somebody discovering
 * it from an incident.
 *
 * Accruing tier. A panic wipe on a bad night must not take the watch's identity with it —
 * that would strand every operator signed on under it, at the worst possible moment.
 */

import { newSecretKey, publicKeyOf, secretFromHex, secretToHex, type SecretKey } from '@navcom/core';
import { clearField, get, set } from './storage';

const SECRET = 'watch_secret';
const FOUNDED = 'watch_founded';

/** The watch's secret, or null on a device that holds no watch. */
export function watchKey(): SecretKey | null {
  const hex = get<string>('accruing', SECRET);
  if (!hex) return null;
  try {
    return secretFromHex(hex);
  } catch {
    return null;
  }
}

/** The watch's address, or null. What operators are given, and what they send to. */
export function watchPubkey(): string | null {
  const secret = watchKey();
  return secret ? publicKeyOf(secret) : null;
}

/**
 * The watch's secret as hex, for handing to somebody joining this squad.
 *
 * **The other half of `joinWatch`, and it was missing.** The screen says a squad shares one
 * watch key *"handed over in person like everything else here"* and offers a box to paste one
 * into — with nowhere to get one out of. So a squad could be described and never formed: every
 * second member in every test was seeded straight into storage, because that was the only way
 * one could exist [`audit-tests.md` 7.S].
 *
 * Separate from `watchKey` on purpose. Reading the key to sign with it and putting it on a
 * screen are different acts, and only one of them should be possible by accident.
 */
export function watchSecretHex(): string | null {
  return get<string>('accruing', SECRET) ?? null;
}

/**
 * Starts a new watch on this device.
 *
 * Deliberate and separate from reading, so nothing brings a Watchtower into existence as a
 * side effect of opening a screen. Refuses to overwrite: replacing a live watch's identity
 * would silently strand every operator configured against the old address.
 */
export function createWatch(): SecretKey {
  const existing = watchKey();
  if (existing) return existing;
  const secret = newSecretKey();
  set('accruing', SECRET, secretToHex(secret));
  // Founding is self-evident, and this is what records it.
  set('accruing', FOUNDED, true);
  return secret;
}

/**
 * Whether this device founded the watch it holds.
 *
 * **The genesis route for the qualification gate.** `can take watch` is the endorsement that
 * lets somebody hold a board [`watch/the-watch.md`], and gating on it alone bricks a new
 * squad: nobody has standing, so nobody can take watch, so the watch is unusable and
 * Milestone 4 stops working.
 *
 * Founding needs nobody's permission because there is nobody to ask. Whoever starts a watch
 * can always hold it; everybody else needs an endorsement from somebody who already does.
 * The gate is real, the first holder needs no key cut for them, and a squad grows outward
 * from one person.
 */
export function foundedHere(): boolean {
  return get<boolean>('accruing', FOUNDED) === true;
}

/**
 * Joins a watch somebody else started, by its secret.
 *
 * Handed over in person, exactly as the address is. There is no discovery and no request
 * flow — a watch you can ask to join is a watch a stranger can ask to join.
 */
export class WatchKeyError extends Error {}

export function joinWatch(secretHex: string): SecretKey {
  let secret: SecretKey;
  try {
    secret = secretFromHex(secretHex);
  } catch {
    throw new WatchKeyError('That is not a watch key — expected 64 hexadecimal characters.');
  }

  /*
   * Refuses to overwrite, exactly as `createWatch` does.
   *
   * The two were asymmetric: founding was guarded against replacing a live watch's identity,
   * and joining — the one that takes a key from somebody else — was not. On a device holding
   * the only copy of a watch key, that is the watch ending and every operator configured
   * against it stranded, with nothing said.
   *
   * The screen happens to hide the join form while a watch is held, and that is not where
   * this belongs: a `maxlength` on a textarea stops the operator who typed it and nobody
   * else [`limits.ts`]. Giving up a watch is a deliberate act with its own control.
   */
  if (watchKey()) {
    throw new WatchKeyError(
      'This device already holds a watch. Give that one up first — joining would replace it, and anybody configured against the old address would be left with nothing.'
    );
  }

  set('accruing', SECRET, secretToHex(secret));
  // Joining is not founding. Somebody handed you this, so the gate applies.
  set('accruing', FOUNDED, false);
  return secret;
}

/**
 * Drops the watch key from this device.
 *
 * Stops this phone being able to answer or publish watch state. It does **not** end the
 * watch: other members still hold the same key, and nothing here can reach their devices.
 */
export function leaveWatch(): void {
  clearField('accruing', SECRET);
  clearField('accruing', FOUNDED);
}
