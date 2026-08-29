/**
 * Post-quantum keys: publishing your own, and collecting the ones you can use.
 *
 * ## Publishing
 *
 * Your ML-KEM public key is derived from your identity secret, so there is nothing to
 * generate or back up — but nobody can send you covered messages until they have it, and
 * they get it from a relay. Publishing is therefore something this device does quietly
 * whenever it is running, not something an operator has to know about.
 *
 * ## Collecting
 *
 * For every pubkey this device might send to: peers, and whoever holds the watch. Cached in
 * the accruing tier, because a bundle is derived from an identity and does not change —
 * refetching it nightly would be traffic for nothing.
 *
 * A cached key is only ever accepted if it was signed by the pubkey it claims to be for
 * [`readKeyBundle`], so a hostile relay cannot substitute one. What it **can** do is serve
 * nothing, and let the sender fall back to classical. That is why the fallback is reported.
 */

import type { Event } from 'nostr-tools/core';
import { buildKeyBundle, KIND_KEY_BUNDLE, readKeyBundle } from '@navcom/core';
import { loadIdentity } from './identity';
import { loadConfig } from './config';
import { contactPubkey } from './card';
import { peerPubkeys } from './peers';
import { relays } from './relays';
import { pool } from './pool';
import { get, set } from './storage';

const FIELD = 'kem_keys';

let known = $state<Record<string, string>>({});
let closer: { close(): void } | null = null;

/** Published keys this device has collected, by pubkey. */
export function kemKeys(): Record<string, string> {
  return known;
}

export const pq = {
  get known(): Record<string, string> {
    return known;
  },

  /**
   * Whether everybody we would send to has published a key.
   *
   * The honest summary for a screen: false the moment one recipient is missing, because a
   * message sealed for a group is only as covered as its weakest wrap.
   */
  covered(recipients: readonly string[]): boolean {
    return recipients.length > 0 && recipients.every((r) => typeof known[r] === 'string');
  },

  /**
   * Everybody this device would send to who has not published a key.
   *
   * Returned as a list rather than a boolean so a screen can say *how many*, and as pubkeys
   * rather than callsigns so this module needs to know nothing about naming.
   */
  uncovered(): string[] {
    const config = loadConfig();
    const all = [
      ...peerPubkeys(),
      ...(config ? config.holders.length ? config.holders : [config.pubkey] : [])
    ].filter((k, i, list) => list.indexOf(k) === i);
    return all.filter((k) => typeof known[k] !== 'string');
  },

  /** Publishes ours and fetches theirs. Safe to call repeatedly. */
  start(): void {
    known = get<Record<string, string>>('accruing', FIELD) ?? {};

    const identity = loadIdentity();
    const urls = relays();
    if (!identity || urls.length === 0) return;

    const config = loadConfig();
    const wanted = [
      ...peerPubkeys(),
      ...(config ? [config.pubkey, ...config.holders] : [])
    ].filter((k, i, all) => all.indexOf(k) === i);

    /*
     * Keys for people this device no longer sends to are dropped.
     *
     * Nothing removed them. `unpair` takes somebody out of the peer list — *"unilateral,
     * immediate, and nobody is told"* — and left their key here, so this map became a
     * **shadow copy of every relationship the device has ever had**, in the accruing tier,
     * which survives a panic wipe. An operator who unpaired somebody had done so everywhere
     * except the one place a seized phone would still show it.
     *
     * Pruned here rather than in `unpair`, because the same is true of leaving a watch or
     * withdrawing a card, and a rule that every caller has to remember is one that gets
     * missed — which is exactly how this happened.
     */
    const stale = Object.keys(known).filter((k) => !wanted.includes(k));
    if (stale.length > 0) {
      known = Object.fromEntries(Object.entries(known).filter(([k]) => wanted.includes(k)));
      set('accruing', FIELD, known);
    }

    /**
     * Nobody to talk to means nothing is published.
     *
     * An earlier version published the bundle unconditionally, so an operator who had paired
     * with nobody and configured no watch still put a signed event carrying their pubkey onto
     * two strangers' relays every time they opened the app. **That operator is the common
     * case**, and the design's whole position is that they generate nothing.
     *
     * A key bundle is only ever useful to somebody who might send to us, so it goes up when
     * such a person exists: a peer, a watch, or a published card that lets a stranger ask.
     * Caught by a browser test counting sockets, which is the only way this would ever have
     * been noticed.
     */
    if (wanted.length === 0 && !contactPubkey()) return;

    // Ours, so anybody who can reach us can cover their messages from the first one.
    void Promise.allSettled(
      pool().publish(urls, buildKeyBundle(identity.secretKey, Math.floor(Date.now() / 1000)))
    );

    if (wanted.length === 0) return;

    closer?.close();
    closer = pool().subscribeMany(
      urls,
      { kinds: [KIND_KEY_BUNDLE], authors: wanted },
      {
        onevent: (event: Event) => {
          // Checked against the pubkeys we already hold, so a relay answering with a key it
          // generated is refused rather than cached.
          const bundle = readKeyBundle(event, wanted);
          if (!bundle) return;
          if (known[bundle.pubkey] === bundle.kem) return;
          known = { ...known, [bundle.pubkey]: bundle.kem };
          set('accruing', FIELD, known);
        }
      }
    );
  },

  stop(): void {
    closer?.close();
    closer = null;
  }
};
