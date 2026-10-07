import { normalizeURL } from 'nostr-tools/utils';

import { MISSION_RELAYS, THE_RECORD } from './missions/package.js';

/**
 * Where an operator starts.
 *
 * Two, not one: a single relay is a single point of failure for presence, and these are free
 * services run by volunteers who owe nobody uptime.
 *
 * **In core because two things need the same answer.** The client picks these when an operator
 * has chosen nothing, and `navcom-relay-check` asks whether they can carry this app's traffic.
 * A second copy would drift, and the copy that drifted would be the checker -- because nobody
 * signs on to it, so nobody would notice it was testing relays the app no longer uses. The same
 * reasoning that put fixture-exclusion for the directory in exactly one place.
 *
 * Relays are public message pipes run by strangers. They carry sealed envelopes they cannot
 * read, and using one reveals no Watchtower -- which is why a default list is fine here and a
 * default *Watchtower* would not be.
 */
export const DEFAULT_RELAYS: readonly string[] = ['wss://relay.damus.io', 'wss://nos.lol'];

/**
 * The hosts of the mission relays: The Record and the mirrors that copy it.
 *
 * Compared by host, not by address, because a config can spell one relay many ways -- a trailing
 * slash, a port, `https://`, capitals, a trailing dot -- and the pool dials every one of them to
 * the same place.
 *
 * Worked out on first use rather than when the module loads, so a page that imports this module
 * for `DEFAULT_RELAYS` alone -- the root console, on its script budget -- carries none of it.
 *
 * **Entry by entry, and never a throw** [review: G3 phase 1]. The list is data in another module,
 * due to become a publisher's own list, and one entry the pool could not parse made every
 * `Distress` end before its first attempt and every signal fail. An entry that cannot be parsed
 * names no host the pool could dial, so it is passed over. Each entry is read exactly as a
 * candidate is, so one written with a trailing dot is not let through. The Record is on it however
 * the list changes: the rule names it.
 */
let missionHosts: ReadonlySet<string> | null = null;
function isMissionHost(host: string): boolean {
  if (!missionHosts) {
    const hosts = new Set<string>();
    const listed: readonly unknown[] = Array.isArray(MISSION_RELAYS) ? MISSION_RELAYS : [];
    for (const url of [THE_RECORD, ...listed]) {
      const one = hostOf(url);
      if (one) hosts.add(one);
    }
    missionHosts = hosts;
  }
  return missionHosts.has(host);
}

/**
 * The host the pool would dial for an address, as one spelling of it -- lower case, with no
 * trailing dot -- or null for anything that is not a parseable `ws` or `wss` address.
 */
function hostOf(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const parsed = new URL(normalizeURL(url.trim()));
    if (parsed.protocol !== 'wss:' && parsed.protocol !== 'ws:') return null;
    return parsed.hostname.toLowerCase().replace(/\.+$/, '') || null;
  } catch {
    return null;
  }
}

/**
 * Why an address may not carry operator traffic, in words an operator can act on; null when it may.
 *
 * **The mission relays never receive an operator's event, whatever a config, a list or a backup
 * says** (decided 2026-10-07, with the refusal *no-operator-traffic-on-a-private-relay*). The
 * Record takes writes only from its allowlist and keeps everything it is sent, for good; the Pi's
 * mirror takes no writes at all. A `Distress` sent there reaches nobody and, on The Record, would
 * be a permanent line with this operator's key on it. They are read for mission packages, and
 * nothing else goes near them.
 *
 * **And an address this pool cannot parse is not one either**, because nostr-tools refuses a whole
 * list for one bad entry [audit: relay paths, F01]. What can be dialled is decided here, once, so
 * the `Distress` loop, the signals and the listeners cannot drift apart.
 *
 * This is the narrow rule the code can keep today. Which public relays an operator should use is a
 * different question -- G3's relay lists, in `docs/build-order.md` -- and not this one.
 */
export function whyNotListable(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return 'not a relay address';
  let parsed: URL;
  try {
    parsed = new URL(normalizeURL(url.trim()));
  } catch {
    return 'not a relay address this phone can read';
  }
  if (parsed.protocol !== 'wss:' && parsed.protocol !== 'ws:') return 'not a relay address: a relay is wss://';
  const host = hostOf(url);
  if (!host) return 'names no relay';
  if (isMissionHost(host)) {
    return 'a mission relay: it keeps everything it is sent, for good, and takes no operator traffic, so nothing is sent there';
  }
  return null;
}

/**
 * Whether an address may receive operator traffic: false for the mission relays and for anything
 * this pool cannot parse. See {@link whyNotListable}, which says why.
 */
export function listable(url: unknown): boolean {
  return whyNotListable(url) === null;
}
