/**
 * Invites — pairing with somebody you have not met.
 *
 * ## Nothing arrives here uninvited that you did not make reachable
 *
 * There are two inboxes, and the difference is the whole safety story:
 *
 * - The **contact key**, which only exists if you published a card. This is the public
 *   address, and anybody may write to it. Withdrawing the card discards the key and the
 *   inbox with it
 * - The **operational key**, which only people you handed it to can write to — peers, and
 *   anybody you sent an invite to. It is not published anywhere
 *
 * So an operator who never publishes a card has no public inbox at all, and one who
 * withdraws stops having one. Being reachable is a thing you switch on.
 *
 * ## Accepting, and the fact that declining sends nothing
 *
 * Accepting pairs them and sends your own key back, which is just an invite in the other
 * direction. Declining is **ignoring**: no message leaves this device, so a sender never
 * learns their invite was read, refused, or even that the key is live.
 *
 * That asymmetry is deliberate. Somebody who owes a refusal is somebody who accepts to
 * avoid an awkward one — the same reason `unpair` tells nobody.
 *
 * Held in memory only. An invite lives on the relay that stored it until it is acted on, so
 * there is no local queue to expire, migrate, or leak into a wipe.
 */

import type { Event } from 'nostr-tools/core';
import { buildInvite, KIND_INVITE, readInvite, type Invite } from '@navcom/core';
import { contactKey, contactPubkey } from './card';
import { loadIdentity } from './identity';
import { pair, peerPubkeys } from './peers';
import { relays } from './relays';
import { pool } from './pool';
import { subscribeLive } from './subscribe';
import { kemKeys } from './pq.svelte';

export interface Waiting extends Invite {
  /** The event id, so accepting the same invite twice is not possible. */
  id: string;
}

/**
 * How many pairing requests are held at once.
 *
 * An operator's address is published — that is what a card is for — so **anybody can write
 * into this list**, and nothing about an invite is expensive to produce. Unbounded, five
 * thousand of them cost twelve and a half million property copies and four seconds on a
 * laptop, because each arrival copied the whole map. On the device floor the screen is
 * simply gone, and the peers list goes with it.
 *
 * Fifty is far more pairing requests than a real person receives, and small enough that the
 * screen stays usable while somebody works out what is happening.
 */
const MAX_WAITING = 50;

let waiting = $state<Record<string, Waiting>>({});
let flooded = $state(false);
let closer: { close(): void } | null = null;

export const invites = {
  /**
   * Invites you have not acted on, oldest first.
   *
   * Anybody already paired is filtered out rather than shown as a duplicate — a relay may
   * still be holding the invite that led to a pairing, and offering to accept somebody
   * twice would read as though the first one had not worked.
   */
  get waiting(): Waiting[] {
    const known = new Set(peerPubkeys());
    return Object.values(waiting)
      .filter((w) => !known.has(w.from))
      .sort((a, b) => a.at - b.at);
  },

  /**
   * Whether requests are arriving faster than this list will hold.
   *
   * Said plainly on the screen rather than hidden, because the operator is the only one who
   * can tell a flood from a busy week, and because an invite they were expecting may be the
   * one being turned away.
   */
  get flooded(): boolean {
    return flooded;
  },

  /**
   * Clears every waiting request at once.
   *
   * Local, silent, and tells nobody — the same as ignoring one. This exists because a capped
   * list that can only be emptied fifty taps at a time is a list an operator cannot recover,
   * which would make the cap the attack rather than the defence.
   */
  ignoreAll(): void {
    waiting = {};
    flooded = false;
  },

  /** Starts listening on whichever inboxes this operator actually has. */
  start(): void {
    const identity = loadIdentity();
    const urls = relays();
    if (!identity || urls.length === 0) return;

    const contact = contactPubkey();
    const addresses = contact ? [identity.pubkey, contact] : [identity.pubkey];

    closer?.close();
    /*
     * One subscription per key, never both in one filter [audit: relay paths, F16]. A single
     * `#p` naming the operational key beside the contact key handed every relay the link between
     * them, in writing. Two subscriptions on one connection still come from one phone — a relay
     * can see that, and `what-leaves.md` now says so — but the filter no longer states it.
     */
    const handle = (event: Event) => {
      // Tried against both keys, because the two inboxes are the same kind and a relay
      // does not say which address matched.
      const secret = contactKey();
      const read =
        readInvite(identity.secretKey, event) ?? (secret ? readInvite(secret, event) : null);
      if (!read) return;
      if (read.from === identity.pubkey) return;
      if (event.id in waiting) return;

      /*
       * Full: the ones already here are kept and this one is refused.
       *
       * Evicting the oldest instead would let a flood push out the invite the operator is
       * actually waiting for. Neither direction is free — a flood that arrives first does
       * block a later real invite — so the answer is not a cleverer rule but telling the
       * operator and letting them clear it. `ignoreAll` is the other half of this, and
       * without it the cap would be worse than the flood.
       */
      if (Object.keys(waiting).length >= MAX_WAITING) {
        flooded = true;
        return;
      }
      waiting = { ...waiting, [event.id]: { ...read, id: event.id } };
    };
    const subs = addresses.map((address) =>
      subscribeLive(urls, { kinds: [KIND_INVITE], '#p': [address] }, { onevent: handle })
    );
    closer = { close: () => subs.forEach((s) => s.close()) };
  },

  /**
   * Pairs them, and sends your key back so they can pair you.
   *
   * `callsign` is what *you* will call them — yours to set, never sent anywhere, and
   * defaulting to what they call themselves.
   */
  async accept(invite: Waiting, callsign: string): Promise<boolean> {
    const identity = loadIdentity();
    const urls = relays();
    if (!identity?.callsign) return false;

    // Idempotent, because a failed reply leaves this invite on the screen to be tapped
    // again — and the second tap must not be refused for a pairing the first one made.
    if (!peerPubkeys().includes(invite.from)) {
      pair(invite.from, callsign.trim() || invite.payload.callsign);
    }

    const back = buildInvite(
      identity.secretKey,
      invite.from,
      { callsign: identity.callsign },
      Math.floor(Date.now() / 1000),
      kemKeys()[invite.from]
    );

    /*
     * Whether the reply actually left, rather than whether we tried.
     *
     * **Pairing is two halves and only one of them is local.** This result was discarded, so
     * an operator accepting with no signal — which is the ordinary state of a field terminal
     * — added the peer to their own list, sent nothing, and was told nothing. They see the
     * peer; the peer never hears. For a buddy that means **nobody is watching while they
     * believe somebody is**, which is invariant 4's mistake made one person at a time.
     *
     * There is deliberately no retry queue: invites are held in memory precisely so there is
     * nothing to expire, migrate or leak into a wipe. Instead the invite stays on the screen
     * and the operator can tap Accept again when they have signal.
     */
    const results = await Promise.allSettled(pool().publish(urls, back));
    const reached = results.some((r) => r.status === 'fulfilled');
    if (!reached) return false;

    waiting = Object.fromEntries(Object.entries(waiting).filter(([id]) => id !== invite.id));
    return true;
  },

  /**
   * Takes it off this screen. **Sends nothing.**
   *
   * Local only, and named `ignore` rather than `decline` because there is no such message
   * and there must never be one. The sender learns nothing.
   */
  ignore(invite: Waiting): void {
    waiting = Object.fromEntries(Object.entries(waiting).filter(([id]) => id !== invite.id));
    flooded = false;
  },

  stop(): void {
    closer?.close();
    closer = null;
  }
};

/**
 * Asks somebody with a card to pair.
 *
 * This is the one moment an operator's operational key leaves the device to somebody they
 * have not met — a deliberate act, aimed at one person, and the reason a card carries a
 * contact key instead.
 */
export async function invite(contact: string, note: string): Promise<boolean> {
  const identity = loadIdentity();
  const urls = relays();
  if (!identity?.callsign || urls.length === 0) return false;

  const event = buildInvite(
    identity.secretKey,
    contact,
    { callsign: identity.callsign, note },
    Math.floor(Date.now() / 1000),
    kemKeys()[contact]
  );
  // Reported rather than assumed. The screen used to mark this sent whatever happened.
  const results = await Promise.allSettled(pool().publish(urls, event));
  return results.some((r) => r.status === 'fulfilled');
}
