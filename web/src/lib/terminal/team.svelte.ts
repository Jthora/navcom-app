/**
 * Pairing a whole team in one scan (2026-11-04).
 *
 * Five people pairing each with each is twenty scans, and a crew meeting on a corner before a patrol
 * does four and stops. Here one phone shows a **team code**; everybody scans it once; every phone then
 * lists the others, each under the name they gave themselves, and pairs with whoever its holder
 * accepts. Pairing stays something each person did, on their own phone [peers.ts].
 *
 * ## How it travels
 *
 * The code carries a fresh key, good for {@link TEAM_CODE_SECONDS}. Each phone that holds it sends
 * an ordinary invite to that key [core `invite.ts`]: its own operational key, proven by the inner
 * signature, and the callsign it chose, sealed to the team key under a throwaway signer, with an
 * expiry a relay honouring NIP-40 deletes it at. Every phone holding the code reads every invite. A
 * relay sees a handful of sealed events to one fresh address within a few minutes: that a group met,
 * not who.
 *
 * **The code is a secret for its ten minutes**: anybody who photographs it can read who answered it
 * and can answer it too. So it is shown, not posted, and every name arrives with its key's print, so
 * a second "Raven" shows as a second print. Nothing is kept: the session is memory and the code's own
 * link, and it ends with the screen.
 *
 * This is pairing, not a crew [crews.spec.md]: no roster, no epoch, nothing shared afterwards but
 * what peers already share.
 */

import type { Event } from 'nostr-tools/core';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { buildInvite, KIND_INVITE, readInvite, secretFromHex, secretToHex } from '@navcom/core';
import { loadIdentity } from './identity';
import { pair, peerPubkeys } from './peers';
import { missionRelays } from './relays';
import { pool } from './pool';
import { subscribeLive } from './subscribe';

/** How long a team code is good for: a meeting, not a standing address. */
export const TEAM_CODE_SECONDS = 600;
/** How many answers one code holds: more than a team, few enough that a flood cannot bury one. */
export const TEAM_MAX = 15;

export interface TeamCode {
  /** The team key's secret, hex: whoever holds the code can read and answer it. */
  secret: string;
  /** Unix seconds after which the code is no good. */
  expiresAt: number;
}

export interface TeamMember {
  pubkey: string;
  /** The name they gave themselves. */
  callsign: string;
  at: number;
}

const PREFIX = 'https://navcom.app/terminal/peers/#team=';

export function newTeamCode(now = Math.floor(Date.now() / 1000)): TeamCode {
  return { secret: secretToHex(generateSecretKey()), expiresAt: now + TEAM_CODE_SECONDS };
}

export function teamLink(code: TeamCode): string {
  return `${PREFIX}${code.secret}.${code.expiresAt}`;
}

/** A team code from a scanned or pasted link, or from the `team=...` of this page's own address. */
export function readTeamLink(text: string): TeamCode | null {
  const m = /(?:^|#)team=([0-9a-f]{64})\.(\d{9,11})$/.exec(text.trim());
  if (!m) return null;
  return { secret: m[1]!, expiresAt: Number(m[2]) };
}

let code = $state<TeamCode | null>(null);
let members = $state<Record<string, TeamMember>>({});
/** Whether this phone's own answer reached a relay: false until it has, null before trying. */
let sent = $state<boolean | null>(null);
let full = $state(false);
let closer: { close(): void } | null = null;

export const team = {
  get code(): TeamCode | null {
    return code;
  },
  get link(): string | null {
    return code ? teamLink(code) : null;
  },
  /** Everybody who answered, but this phone and anybody already paired, in the order they came. */
  get others(): TeamMember[] {
    const me = loadIdentity()?.pubkey;
    const known = new Set(peerPubkeys());
    return Object.values(members)
      .filter((m) => m.pubkey !== me && !known.has(m.pubkey))
      .sort((a, b) => a.at - b.at);
  },
  get sent(): boolean | null {
    return sent;
  },
  get full(): boolean {
    return full;
  },
  expired(now = Math.floor(Date.now() / 1000)): boolean {
    return code !== null && now >= code.expiresAt;
  },

  /**
   * Opens a team code, this phone's own or one it scanned: answers it with this phone's key and
   * name, and listens for everybody else's. Needs a callsign: the others pair under it.
   */
  async open(next: TeamCode): Promise<boolean> {
    const identity = loadIdentity();
    if (!identity?.callsign) return false;
    const now = Math.floor(Date.now() / 1000);
    if (now >= next.expiresAt) return false;
    this.close();
    code = next;
    members = {};
    full = false;
    sent = null;

    const secret = secretFromHex(next.secret);
    const address = getPublicKey(secret);
    const urls = missionRelays();
    const handle = (event: Event) => {
      const read = readInvite(secret, event);
      if (!read || read.from in members) return;
      // Answers to this code only, made inside its time.
      if (read.at < next.expiresAt - TEAM_CODE_SECONDS - 60 || read.at > next.expiresAt) return;
      if (Object.keys(members).length >= TEAM_MAX) {
        full = true;
        return;
      }
      members = { ...members, [read.from]: { pubkey: read.from, callsign: read.payload.callsign, at: read.at } };
    };
    closer = subscribeLive(
      urls,
      { kinds: [KIND_INVITE], '#p': [address], since: next.expiresAt - TEAM_CODE_SECONDS - 60 },
      { onevent: handle }
    );

    const mine = buildInvite(identity.secretKey, address, { callsign: identity.callsign }, now, undefined, next.expiresAt);
    const results = await Promise.allSettled(pool().publish(urls, mine));
    sent = results.some((r) => r.status === 'fulfilled');
    return sent;
  },

  /** Sends this phone's answer again: for a phone that answered with no signal. */
  async resend(): Promise<boolean> {
    return code ? this.open(code) : false;
  },

  /**
   * Pairs with the ones accepted, each under the name they gave themselves. Anybody already paired
   * is passed over rather than refused, so a second tap after a partial pairing finishes it.
   */
  accept(pubkeys: string[]): number {
    let added = 0;
    for (const key of pubkeys) {
      const m = members[key];
      if (!m || peerPubkeys().includes(key)) continue;
      pair(m.pubkey, m.callsign);
      added++;
    }
    return added;
  },

  close(): void {
    closer?.close();
    closer = null;
    code = null;
    members = {};
    sent = null;
    full = false;
  }
};
