/**
 * Which Watchtower this terminal belongs to.
 *
 * Handed over out of band, by a person. **Nothing auto-discovers a Watchtower** — a list of
 * Watchtowers is a list of where operators are, so there is no directory of them and there
 * should not be one.
 *
 * Kept in the accruing tier, which is a real trade rather than an obvious call: the pubkey
 * is association data, and a searched phone carrying it reveals which watch you are on. But
 * putting it in the wipeable tier would mean a panic wipe leaves an operator unable to
 * reconnect without finding a person, on the night they were most likely to need to. Burn
 * destroys it; a wipe does not.
 */

import { isPubkey } from '@navcom/core';
import { get, set } from './storage';
import { usable, whyNotReachable } from './relay-url';

export interface WatchtowerConfig {
  pubkey: string;
  relays: string[];
  /**
   * Whose keys signals are sealed to.
   *
   * Empty for a box, which holds the Watchtower key itself and is its own holder. A squad
   * with no box lists one pubkey per phone — handed over in the same conversation that
   * hands over the address, because nothing here discovers anything.
   */
  holders: string[];
}

/**
 * The watch this phone belongs to, with only the relay addresses it can reach.
 *
 * Filtered here, on the way out, as well as checked on the way in: a config saved before the
 * check existed, or restored from a backup, could hold an address nostr-tools throws on — and
 * every Distress, signal and watch-state read goes through this one function [audit: relay
 * paths, F01]. A watch with no reachable relay is no watch at all, said as such.
 */
export function loadConfig(): WatchtowerConfig | null {
  const pubkey = get<string>('accruing', 'watchtower');
  const stored = get<string[]>('accruing', 'relays');
  const relays = Array.isArray(stored) ? usable(stored) : [];
  if (!pubkey || relays.length === 0) return null;
  return { pubkey, relays, holders: get<string[]>('accruing', 'watch_holders') ?? [] };
}

export class ConfigError extends Error {}

export function saveConfig(
  pubkey: string,
  relaysRaw: string,
  holdersRaw?: string
): WatchtowerConfig {
  const cleanKey = pubkey.trim().toLowerCase();
  if (!isPubkey(cleanKey)) {
    throw new ConfigError('A Watchtower pubkey is 64 hexadecimal characters.');
  }
  const relays = relaysRaw
    .split(/[\s,]+/)
    .map((r) => r.trim())
    .filter(Boolean);
  if (relays.length === 0) throw new ConfigError('At least one relay is needed.');
  // Named, never dropped: the line an operator typed wrong is the one they need to see.
  for (const r of relays) {
    const why = whyNotReachable(r);
    if (why) throw new ConfigError(why);
  }
  /*
   * Everything validated before anything is written.
   *
   * `holders()` threw on a mistyped key *after* the pubkey and relays were already on disk and
   * before the holder list was, so a single wrong character left a half-written config: the
   * screen said nothing was saved, and `loadConfig()` returned a watch with no holders. That
   * reads as configured everywhere — sign-on arms, Distress arms — and every signal is then
   * sealed to the watch key alone, so the squad members it was meant for decrypt nothing. The
   * operator believes a squad is behind them and their Distress lands on nobody's board.
   */
  const holderKeys = holders(holdersRaw);
  set('accruing', 'watchtower', cleanKey);
  set('accruing', 'relays', relays);
  set('accruing', 'watch_holders', holderKeys);
  return { pubkey: cleanKey, relays, holders: holderKeys };
}

/**
 * Who can read what this terminal sends.
 *
 * A box is its own holder, so an operator who was handed only a pubkey configures nothing
 * extra and nothing changes for them. A squad's members are listed, and a wrong entry here
 * means somebody silently cannot read signals — so it is validated rather than trusted.
 */
function holders(raw: string | undefined): string[] {
  const keys = (raw ?? '')
    .split(/[\s,]+/)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  for (const k of keys) {
    if (!isPubkey(k)) throw new ConfigError(`"${k}" is not a pubkey — expected 64 hex characters.`);
  }
  // Pure: the caller writes, once everything has passed. See `saveConfig`.
  return keys;
}
