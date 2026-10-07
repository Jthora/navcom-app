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
import { clearField, get, set } from './storage';
import { refusedOf, usable, whyNotReachable, type Refused } from './relay-url';

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

/** The watch as saved on this phone, with the relay lines this page will not dial named. */
export interface StoredWatch extends WatchtowerConfig {
  /** Every relay line as saved, so a screen can show the one that is wrong. */
  lines: string[];
  /** The lines left out of `relays`, each with why. */
  refused: Refused[];
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/**
 * The watch this phone was given, whether or not this page can reach any of its relays.
 *
 * For the screens, never for sending. A watch whose every relay is refused here was still
 * added by somebody — before the check existed, or as `ws://` to a relay the browser will not
 * open from https — and reading it as no watch told that operator they had never added one,
 * while Setup opened blank with the key and the holders they needed to repair it hidden
 * [audit: relay paths, review]. Kept, and the refused lines named, so it can be fixed in one edit.
 */
export function storedWatch(): StoredWatch | null {
  const pubkey = get<unknown>('accruing', 'watchtower');
  if (typeof pubkey !== 'string' || !pubkey) return null;
  const lines = strings(get<unknown>('accruing', 'relays'));
  return {
    pubkey,
    relays: usable(lines),
    holders: strings(get<unknown>('accruing', 'watch_holders')),
    lines,
    refused: refusedOf(lines)
  };
}

/**
 * The watch this phone belongs to, with only the relay addresses it can reach.
 *
 * Filtered here, on the way out, as well as checked on the way in: a config saved before the
 * check existed, or restored from a backup, could hold an address nostr-tools throws on — and
 * every Distress, signal and watch-state read goes through this one function [audit: relay
 * paths, F01]. A watch with no reachable relay sends nowhere, so it is null here; what it is,
 * and which lines are wrong, is `storedWatch`, for the screens that say so.
 */
export function loadConfig(): WatchtowerConfig | null {
  const watch = storedWatch();
  if (!watch || watch.relays.length === 0) return null;
  return { pubkey: watch.pubkey, relays: watch.relays, holders: watch.holders };
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

/** What a backup says about a watch, before anything is done with it. */
export interface NamedWatch {
  pubkey: string;
  relays: string[];
  holders: string[];
}

const OFFERED = 'watch_offered';

/**
 * A watch a restored backup named, held until the operator adds it or forgets it.
 *
 * It lived in the backup screen's memory, and the screen's own next line said to reopen the
 * terminal: doing that lost it, and a second restore is refused once the identity is back
 * [audit: relay paths, review]. Kept now under a name nothing that sends ever reads, so it
 * routes nowhere until the operator adds it [audit: relay paths, F02] — and in the wipeable
 * tier, so a panic wipe takes the association with it.
 */
export function offerWatch(watch: NamedWatch): void {
  set('wipeable', OFFERED, watch);
}

export function offeredWatch(): NamedWatch | null {
  const w = get<Partial<NamedWatch>>('wipeable', OFFERED);
  if (!w || typeof w !== 'object' || typeof w.pubkey !== 'string') return null;
  return { pubkey: w.pubkey, relays: strings(w.relays), holders: strings(w.holders) };
}

export function forgetOfferedWatch(): void {
  clearField('wipeable', OFFERED);
}

/** What Setup's watch form opens with. */
export interface WatchForm {
  /** Saved on this phone, or named by a backup and not added until it is saved. */
  from: 'saved' | 'backup';
  pubkey: string;
  /** The relay field, one line each. */
  relays: string[];
  holders: string[];
  /** Lines this page will not dial, each with why: left out of the field, or in it to be fixed. */
  refused: Refused[];
  /** How many of the watch's relays this page can reach. */
  reachable: number;
}

/**
 * The watch Setup's form opens with: the one saved here, or else the one a backup named.
 *
 * The relays this page can reach fill the field, and the rest are named beside it as left out.
 * Every saved line went into the field for a while, and a save checks each line it is given — so
 * a working watch carrying one line from before the check refused every later edit, removing a
 * holder who had left the squad among them, while the readout under the button still said Saved
 * [audit: relay paths, review]. Only a watch with nothing reachable opens with every line as
 * saved, because the line to fix is then all there is to work with.
 */
export function watchForm(): WatchForm | null {
  const stored = storedWatch();
  const offer = stored ? null : offeredWatch();
  const w = stored
    ? { from: 'saved' as const, pubkey: stored.pubkey, lines: stored.lines, holders: stored.holders }
    : offer
      ? { from: 'backup' as const, pubkey: offer.pubkey, lines: offer.relays, holders: offer.holders }
      : null;
  if (!w) return null;
  const reachable = usable(w.lines);
  return {
    from: w.from,
    pubkey: w.pubkey,
    relays: reachable.length > 0 ? reachable : w.lines.filter((l) => l.trim()),
    holders: w.holders,
    refused: refusedOf(w.lines),
    reachable: reachable.length
  };
}

/**
 * Adds a watch a backup named, by the rule every other read of a relay list follows: the relays
 * this page can reach, and the rest left out — named on the screen before the operator agreed.
 *
 * It went through the strict check meant for a line somebody just typed, so one address the old
 * phone had long since stopped dialling refused the whole watch, on a screen with no field to
 * fix it in [audit: relay paths, review]. Refused only when nothing is left.
 */
export function addOfferedWatch(watch: NamedWatch): WatchtowerConfig {
  const reachable = usable(watch.relays);
  if (reachable.length === 0) {
    throw new ConfigError(
      'None of this watch’s relays can be reached from this page. Fix them on the setup screen, where the watch is filled in.'
    );
  }
  const saved = saveConfig(watch.pubkey, reachable.join('\n'), watch.holders.join('\n'));
  forgetOfferedWatch();
  return saved;
}
