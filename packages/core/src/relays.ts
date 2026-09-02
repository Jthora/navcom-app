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
