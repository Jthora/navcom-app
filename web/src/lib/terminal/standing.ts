/**
 * Endorsements this operator holds, and what they qualify them for.
 *
 * Held here and **indexed nowhere**. Nothing publishes them, nothing looks them up, and no
 * server knows they exist — which is why no social graph of this network exists to breach,
 * sell or subpoena.
 *
 * One qualification, because the sentence above was written as an absolute and is not quite
 * one: watching for withdrawals discloses this operator's endorser set to the relay it asks.
 * See `start()`, where it is priced.
 *
 * Accruing tier. Standing is the thing an operator builds over years; a panic wipe takes
 * tonight and must not take that.
 *
 * ## Standing survives a new key, for free
 *
 * A credential names nobody and a claim is a local signature over its id, so re-binding
 * every held credential to a new persona is `claimCredential(newSecret, credential, now)`
 * per stored pair — no network, no endorser's involvement, nobody's permission. That falls
 * out of the design rather than being built, and it is the answer to *"a lost phone must not
 * erase years of standing"* for the half a backup does not cover.
 *
 * **There is no button for it**, because there is no key-rotation flow to hang it on at all
 * (`bootstrap.spec.md`: *"There is no key rotation story yet"*). By this project's own rule
 * that makes it unbuilt — recorded here so that whoever builds rotation knows this half is
 * already free, rather than designing around a problem that does not exist.
 */

import {
  claimCredential,
  isRevokedBy,
  KIND_REVOCATION,
  readEndorsement,
  revoke,
  type Endorsement,
  type Scope
} from '@navcom/core';
import type { Event } from 'nostr-tools/core';
import { loadIdentity } from './identity';
import { pool } from './pool';
import { relays } from './relays';
import { get, set } from './storage';

const FIELD = 'endorsements';
/** Credentials this operator wrote for other people, so they can be withdrawn later. */
const WRITTEN = 'endorsements_written';
/** Revocations seen, cached because standing is checked offline as often as on. */
const REVOKED = 'revocations';

let closer: { close(): void } | null = null;

/** A presented pair, as stored: the credential somebody wrote, and this persona's claim. */
interface Held {
  credential: Event;
  claim: Event;
}

export class StandingError extends Error {}

/**
 * Endorsements this operator can stand on, with withdrawn ones removed.
 *
 * **Withdrawal existed on paper and nowhere else.** `revoke` and `isRevokedBy` were both in
 * core, `identity.md` said *"endorsers publish a revocation, checked when online"*, and the
 * client neither published one nor ever looked. An endorser who vouched for somebody and
 * later learned they were unsafe had no way to take it back — and `can-take-watch` is the
 * gate on who may hold a board, so a withdrawn endorsement went on opening it forever.
 *
 * Checked against the cached revocations rather than the network, because standing is
 * checked offline at least as often as on — in person, with two phones and no signal.
 */
export function held(): Endorsement[] {
  const stored = get<Held[]>('accruing', FIELD) ?? [];
  const revocations = get<Event[]>('accruing', REVOKED) ?? [];
  return stored
    .map((h) => readEndorsement(h.credential, h.claim))
    .filter((e): e is Endorsement => e !== null)
    // `isRevokedBy` checks the revocation was signed by the key that wrote the credential,
    // so a stranger cannot strip somebody's standing by publishing one.
    .filter((e) => !revocations.some((r) => isRevokedBy(e, r)));
}

/**
 * Endorsements this operator held that have since been taken back.
 *
 * Shown rather than silently dropped. Standing is the thing an operator builds over years,
 * and one of these is the gate on holding a board — so somebody who could take the watch
 * yesterday and cannot today must find that out **on a screen they open**, not at the moment
 * they try. It names who withdrew it, because that is who they can ask.
 */
export function withdrawn(): Endorsement[] {
  const stored = get<Held[]>('accruing', FIELD) ?? [];
  const revocations = get<Event[]>('accruing', REVOKED) ?? [];
  return stored
    .map((h) => readEndorsement(h.credential, h.claim))
    .filter((e): e is Endorsement => e !== null)
    .filter((e) => revocations.some((r) => isRevokedBy(e, r)));
}

/**
 * Credentials this operator has written for other people.
 *
 * Kept so they can be withdrawn. Nothing about the holder is recorded — a credential names
 * nobody, which is the whole design — so this is a list of things *written*, not of people
 * vouched for, and it stays that way.
 */
export function written(): Event[] {
  const stored = get<Event[]>('accruing', WRITTEN) ?? [];
  return Array.isArray(stored) ? stored : [];
}

/** Records a credential this operator wrote, so withdrawing it is possible later. */
export function recordWritten(credential: Event): void {
  set('accruing', WRITTEN, [...written(), credential]);
}

/**
 * Withdraws a credential this operator wrote.
 *
 * Published, unlike the credential itself, because a reader has to be able to find it — and
 * a revocation names only the credential, so publishing one still reveals nobody.
 *
 * **This is an endorser retracting their own claim, not an appeal.** Nobody adjudicates
 * between two operators here and nobody is asked to.
 */
export async function withdraw(credentialId: string): Promise<boolean> {
  const secret = loadIdentity()?.secretKey;
  const urls = relays();
  if (!secret) return false;

  const event = revoke(secret, credentialId, Math.floor(Date.now() / 1000));
  // Held locally first: the endorser has decided, and that decision must not depend on
  // signal. Their own device stops honouring it immediately.
  set('accruing', REVOKED, [...(get<Event[]>('accruing', REVOKED) ?? []), event]);
  set('accruing', WRITTEN, written().filter((c) => c.id !== credentialId));

  if (urls.length === 0) return false;
  const results = await Promise.allSettled(pool().publish(urls, event));
  return results.some((r) => r.status === 'fulfilled');
}

/**
 * Starts listening for withdrawals of the credentials this operator holds.
 *
 * Filtered to the endorsers whose credentials are actually held, so this asks for the few
 * revocations that could matter rather than every one on the network.
 *
 * ## The one place standing is not private, stated rather than implied
 *
 * **This filter is a disclosure.** `authors: endorsers` hands the relay the exact set of
 * pubkeys that vouched for this operator — so a relay operator who logs subscription
 * filters learns who endorsed you, even though no credential is ever published and no
 * revocation names a subject.
 *
 * It does not reach the network: it is one relay, chosen by this operator, learning one
 * device's endorser set — not a graph anybody can query, which is the thing
 * `identity.md` refuses and which remains true. But it is the seam where "indexed nowhere"
 * stops being literal, and it was undocumented until an audit found it.
 *
 * **Why it is not simply widened.** Dropping `authors` and filtering client-side would
 * close it, at a cost that is not obviously payable: revocations would arrive for the whole
 * network, unbounded, and the obvious bound — `since` — is the exact mistake
 * `transport.ts` documents at length, where a fast client clock silently drops real events
 * server-side. Missing a revocation here means honouring an endorsement its author took
 * back, and `can-take-watch` is the gate on holding a board. Correctness and this
 * disclosure pull opposite ways, and picking between them is a decision rather than a
 * patch — so it is written down here and left open rather than quietly resolved.
 */
export function start(): void {
  const urls = relays();
  const endorsers = held().map((e) => e.endorserKey);
  if (urls.length === 0 || endorsers.length === 0) return;

  closer?.close();
  closer = pool().subscribeMany(urls, { kinds: [KIND_REVOCATION], authors: endorsers }, {
    onevent: (event: Event) => {
      const seen = get<Event[]>('accruing', REVOKED) ?? [];
      if (seen.some((r) => r.id === event.id)) return;
      // Only revocations that actually withdraw something this device holds are kept, so a
      // flood of them cannot fill the tier that holds an operator's standing.
      const stored = get<Held[]>('accruing', FIELD) ?? [];
      const mine = stored
        .map((h) => readEndorsement(h.credential, h.claim))
        .filter((e): e is Endorsement => e !== null);
      if (!mine.some((e) => isRevokedBy(e, event))) return;
      set('accruing', REVOKED, [...seen, event]);
    }
  });
}

export function stop(): void {
  closer?.close();
  closer = null;
}

/** The pair, for presenting to somebody who wants to check it themselves. */
export function presentable(): Held[] {
  return get<Held[]>('accruing', FIELD) ?? [];
}

/**
 * Takes up a credential somebody handed over.
 *
 * Needs no account, no approval and no network — the whole exchange happens between two
 * people and two devices.
 */
export function claim(credentialJson: string): Endorsement {
  const identity = loadIdentity();
  if (!identity) throw new StandingError('Pick a callsign first — a credential binds to one.');

  let credential: Event;
  try {
    credential = JSON.parse(credentialJson.trim()) as Event;
  } catch {
    throw new StandingError('That is not a credential.');
  }

  let claimEvent: Event;
  try {
    claimEvent = claimCredential(identity.secretKey, credential, Math.floor(Date.now() / 1000));
  } catch {
    throw new StandingError('That credential is not signed by anybody.');
  }

  const endorsement = readEndorsement(credential, claimEvent);
  if (!endorsement) throw new StandingError('That credential is not one this version understands.');

  const stored = presentable();
  if (stored.some((h) => h.credential.id === credential.id)) {
    throw new StandingError('You already hold that one.');
  }

  /*
   * A credential its author has already taken back.
   *
   * Without this, claiming one **succeeded**: it was stored, the screen said it had been
   * taken up, and `held` then filtered it straight back out — so the operator was shown a
   * success for standing they do not have. Refusing it says the true thing, and says it at
   * the moment they can still ask the person why.
   */
  const revocations = get<Event[]>('accruing', REVOKED) ?? [];
  if (revocations.some((r) => isRevokedBy(endorsement, r))) {
    throw new StandingError(
      `${endorsement.endorser} has taken that one back, so it no longer stands. Ask them about it.`
    );
  }
  set('accruing', FIELD, [...stored, { credential, claim: claimEvent }]);
  return endorsement;
}

/** Puts one down. Nobody is told — the same rule as unpairing. */
export function drop(credentialId: string): void {
  set('accruing', FIELD, presentable().filter((h) => h.credential.id !== credentialId));
}

/**
 * Whether this operator holds a given scope.
 *
 * **Provenance by name, never a count.** Callers that need to show something show *who*
 * vouched; this only answers whether anybody did.
 */
export function holds(scope: Scope): boolean {
  return held().some((e) => e.scope === scope);
}

/** Who vouched for a scope, so a screen can name them rather than total them. */
export function endorsersFor(scope: Scope): Endorsement[] {
  return held().filter((e) => e.scope === scope);
}
