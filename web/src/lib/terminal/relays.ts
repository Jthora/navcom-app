/**
 * Which relays this device uses.
 *
 * **Separate from the Watchtower config, and that separation is the point.** Peer presence
 * needs somewhere to publish and has nothing to do with a watch — an operator who has
 * paired with a friend and has no Watchtower at all was, until this existed, unable to use
 * the one feature built specifically for them.
 *
 * Relays are public message pipes run by strangers. They carry sealed envelopes they cannot
 * read, and using one reveals no Watchtower — which is why a default list is fine here and
 * a default *Watchtower* would not be. Nothing discovers a Watchtower; a relay is not one.
 *
 * The defaults are visible and editable, because every network call this app makes has to
 * be explainable to somebody pointing a proxy at it.
 */

import { DEFAULT_RELAYS } from '@navcom/core';
import { get, set } from './storage';
import { loadConfig } from './config';
import { refusedOf, usable, type Refused } from './relay-url';

/**
 * Where an operator starts.
 *
 * Defined in core rather than here, because `navcom-relay-check` needs the same answer and a
 * second copy would drift -- silently, since the checker is the copy nobody signs on to.
 */
export { DEFAULT_RELAYS };

const FIELD = 'relays_own';

/**
 * Where an operator publishes and reads: their watch's relays, if they have a watch, beside their
 * own list or else the shipped defaults. **Added, never substituted** [audit: relay paths, F15].
 *
 * A configured watch's relays used to replace the rest, to save a phone one connection. A watch
 * handed over on relays that left out both defaults then took everything else with it: presence,
 * invites, key bundles, the card, public presence, corrections, places, observations and
 * revocations went only where the watch listened — split, silently, from every Alone peer, from
 * the public roster and from the maintainer's intake. Missions had already been fixed the same way.
 */
export function relays(): string[] {
  const watch = loadConfig()?.relays ?? [];
  const own = usable(savedOwnRelays());
  return usable([...watch, ...(own.length ? own : DEFAULT_RELAYS)]);
}

/**
 * Where taking part in a mission goes: everywhere `relays()` does, and the shipped defaults beside
 * it, because that is where whoever posted it reads [mission-interchange spec §5.0]. The rule
 * `missions/claims.ts` sends by, here as well so the screen that lists where things go can name it.
 */
export function missionRelays(): string[] {
  return usable([...relays(), ...DEFAULT_RELAYS]);
}

/**
 * Where a watch is heard: its own relays, and nowhere else. The board, the watch's state and its
 * answers stay here — widening them would put a privately relayed watch's state on public relays.
 */
export function watchRelays(): string[] {
  return loadConfig()?.relays ?? relays();
}

/**
 * Only addresses this phone can reach, each once. A prefix check let `wss://` alone through, and
 * nostr-tools throws on that inside a promise that never settles — so a screen waiting on it said
 * "Checking" for as long as it was open [audit 11.E]. The rule itself lives in `relay-url.ts`,
 * where the watch config uses it too.
 */
export { usable } from './relay-url';

/** The part of the list an operator edits: their own relays, or the shipped defaults. */
export function ownRelays(): string[] {
  const own = usable(savedOwnRelays());
  return own.length ? own : [...DEFAULT_RELAYS];
}

/**
 * Whether the shipped defaults stand in for the operator's own list: nothing chosen, or nothing
 * chosen that this page can reach — `refusedOwnRelays` says which of the two.
 */
export function usingDefaults(): boolean {
  return usable(savedOwnRelays()).length === 0;
}

/** The operator's own list as saved, every line, whether or not this page can reach it. */
export function savedOwnRelays(): string[] {
  const raw = get<unknown>('accruing', FIELD);
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Lines of the operator's own list this page will not dial, each with why.
 *
 * Said, never swapped in silence [audit: relay paths, review]. A list saved before the check, all of
 * it `ws://` to a relay on the operator's own network, leaves nothing usable from https: the
 * shipped defaults then carried presence, the card and the key bundle to relays the operator had
 * left out, while the editor showed the defaults as though nothing had ever been chosen.
 */
export function refusedOwnRelays(): Refused[] {
  return refusedOf(savedOwnRelays());
}

export function setRelays(list: string[]): void {
  set('accruing', FIELD, usable(list));
}
