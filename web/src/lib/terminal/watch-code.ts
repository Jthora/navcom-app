/**
 * A watch code: the whole of a watch, handed over in one piece, **signed by the watch it names**.
 *
 * Until this existed a watch reached an operator as three fields typed by hand — the address, the
 * relays, and for a squad the holders. A fourth arrives with G3: **the escalation executor's own
 * key**, the only key whose answer ends a `Distress` on a box [`escalation.spec.md`, *The executor
 * has a key of its own*]. That one MUST NOT be typed. A key off the curve — about half of all
 * mistyped ones — is read as none, and the watch quietly keeps the old rule; a key on the curve that
 * nobody holds cannot be told from a real one, and then no answer could ever end a `Distress`.
 *
 * ## Signed, or not a watch code
 *
 * Unsigned, a code was a way for anybody to change who can end an operator's `Distress`. The
 * watch's address and relays are public, so a stranger could post a link naming the operator's own
 * watch and a key of the stranger's as its escalation key; Setup opened filled in, and one tap made
 * the stranger's answer the one that ends that operator's `Distress` — while the real executor's
 * answers went unheard [review: live hole, phone]. A holder added the same way is just as bad: under
 * the holder rule a holder's own signature ends a `Distress` too.
 *
 * So a code carries the watch key's signature over everything in it, and the date it was signed
 * (G3: *a new holder key, an executor key, or a new watch … arrives in a signed, dated watch code*).
 * A code that is not signed by the watch it names, or was changed after it was signed, fills in
 * nothing. That stops anybody who does not hold the watch key. It cannot stop somebody who does —
 * the daemon beside the agent holds it, and so does every former squad member — which is why a code
 * is still handed over in person, and why Setup asks before a code changes the escalation key of a
 * watch already saved here.
 *
 * ## The format
 *
 * A link, so a phone's camera opens it and a messaging app keeps it whole:
 *
 * ```
 * https://navcom.app/terminal/setup/#watch=1&w=<watch>&r=<relay>&r=<relay>&h=<holder>&x=<executor>&t=<signed at>&s=<signature>
 * ```
 *
 * `watch` is the version and comes first. `w` is the watch's address, 64 lower-case hex. `r` is a
 * relay, once each, URL-encoded. `h` is a holder, once each, absent for a box. `x` is the
 * executor's own key, absent on a watch that names none. `t` is when it was signed, in unix
 * seconds. `s` is the signature, 128 hex, and comes last. Anything else is ignored, so a later
 * version can add a field an older phone passes over (and that field is not signed). Only the part
 * from `watch=` on is read, so the bare fragment, or the link with a messaging app's words and
 * punctuation around it, both work.
 *
 * ## The signature
 *
 * Normative, because the box has to build the same bytes: a nostr event (NIP-01) that is never
 * published, of kind `20916` (`KIND_WATCH_CODE_SIGNATURE`), `pubkey` the watch's address, `created_at`
 * the `t` above, no tags, and `content` the JSON array, as `JSON.stringify` writes it:
 * `"navcom-watch-code-v1"`, the watch's address, the relays (each once, sorted), the holders (each
 * once, lower-case, sorted), and the executor's key or `null`. `s` is that event's signature by the
 * watch key, so any nostr library checks it. Built once, in `@navcom/core`
 * (`watchCodeSignatureEvent`), which the box's executor uses too.
 *
 * Shown and filled in, never saved by being pasted: the operator still saves it on the setup
 * screen, exactly as with a watch a backup named. And kept whole when it is saved
 * ({@link escalationOf}), so wherever the escalation key is read back, the signature is checked
 * again, and a key that reached storage any other way — an older build restoring a backup, say —
 * is read as none.
 */

import { finalizeEvent, getEventHash, verifyEvent } from 'nostr-tools/pure';
import { isCurveKey, isPubkey, keyPrint, watchCodeSignatureEvent, type WatchCodeFields } from '@navcom/core';

export { KIND_WATCH_CODE_SIGNATURE, watchCodeSignatureEvent, type WatchCodeFields } from '@navcom/core';

/** A code as read: what it names, when it was signed, and the code itself, to be kept whole. */
export interface WatchCode extends WatchCodeFields {
  /** When the watch signed it, in unix seconds, by the clock of whatever signed it. */
  issuedAt: number;
  /** The code from `watch=` on, exactly as signed: what is stored, so it can be checked again. */
  text: string;
}

export class WatchCodeError extends Error {}

/** The version this phone writes and reads. */
export const WATCH_CODE_VERSION = '1';

/** More than any real watch, and few enough that a paste cannot fill the screen with fields. */
const MAX_ENTRIES = 32;

const SIG_HEX = /^[0-9a-f]{128}$/;

/** Punctuation a sentence or a messaging app leaves stuck to the end of a link. */
const TRAILING = /[.,;:!?)\]}>'"’”»]+$/;

/**
 * A watch as a signed code, for a watch that hands itself over and for the tests that read one back.
 * `watchSecret` is the watch's own key: whoever holds the watch, and nobody else, can make one.
 */
export function watchCode(
  fields: WatchCodeFields,
  watchSecret: Uint8Array,
  issuedAt: number = Math.floor(Date.now() / 1000)
): string {
  const executor = fields.executor?.toLowerCase();
  if (executor !== undefined && (!isCurveKey(executor) || executor === fields.pubkey.toLowerCase())) {
    throw new WatchCodeError('That escalation key is not a key, so no code was made.');
  }
  const signed = finalizeEvent(watchCodeSignatureEvent(fields, issuedAt), watchSecret);
  if (signed.pubkey !== fields.pubkey.toLowerCase()) {
    throw new WatchCodeError('Only the watch’s own key can sign its code.');
  }
  const params = new URLSearchParams();
  params.set('watch', WATCH_CODE_VERSION);
  params.set('w', signed.pubkey);
  for (const r of fields.relays) params.append('r', r);
  for (const h of fields.holders) params.append('h', h.toLowerCase());
  if (executor) params.set('x', executor);
  params.set('t', String(issuedAt));
  params.set('s', signed.sig);
  return `https://navcom.app/terminal/setup/#${params.toString()}`;
}

/** Whether this text carries a watch code at all, without saying whether it is a good one. */
export function looksLikeWatchCode(text: string): boolean {
  return /(?:^|[#?&\s])watch=/.test(text.trim());
}

/**
 * The watch a code names, or a refusal that says what is wrong with it.
 *
 * All of it or none of it: a code with one bad part is not half a watch, and a screen filled from
 * it would invite somebody to save what is left. A code the watch did not sign is a bad part.
 */
export function parseWatchCode(text: string): WatchCode {
  const found = text.trim().match(/(?:^|[#?&\s])(watch=\S*)/);
  if (!found) throw new WatchCodeError('That is not a watch code.');
  const code = found[1]!.replace(TRAILING, '');
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(code);
  } catch {
    throw new WatchCodeError('That watch code is damaged. Ask for it again.');
  }
  const version = params.get('watch') ?? '';
  if (version !== WATCH_CODE_VERSION) {
    throw new WatchCodeError(
      /^\d{1,6}$/.test(version) && Number(version) > Number(WATCH_CODE_VERSION)
        ? 'That watch code was made by a newer version of NavCom than this one. Open this page again with signal to update it.'
        : 'That watch code is damaged. Ask for it again.'
    );
  }

  const pubkey = (params.get('w') ?? '').trim().toLowerCase();
  if (!isPubkey(pubkey)) throw new WatchCodeError('That watch code has no address in it. Ask for it again.');

  const relays = [...new Set(params.getAll('r').map((r) => r.trim()).filter(Boolean))];
  if (relays.length === 0) throw new WatchCodeError('That watch code names no relay. Ask for it again.');

  const holders = [...new Set(params.getAll('h').map((h) => h.trim().toLowerCase()).filter(Boolean))];
  if (holders.some((h) => !isPubkey(h))) {
    throw new WatchCodeError('That watch code names a holder that is not a key. Ask for it again.');
  }
  if (relays.length > MAX_ENTRIES || holders.length > MAX_ENTRIES) {
    throw new WatchCodeError('That watch code names far more than a watch has. Nothing was filled in.');
  }

  const named = params.getAll('x').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (named.length > 1) {
    throw new WatchCodeError('That watch code names two escalation keys. Nothing was filled in. Ask for it again.');
  }
  const executor = named[0];
  // Refused rather than dropped: read as none, the watch would keep the old rule, and nothing on the
  // screen would say the code had asked for anything else.
  if (executor !== undefined && (!isCurveKey(executor) || executor === pubkey)) {
    throw new WatchCodeError(
      'That watch code names an escalation key that is not a key, so nothing was filled in. Ask for it again: one wrong character is enough.'
    );
  }

  const t = params.get('t') ?? '';
  const sig = (params.get('s') ?? '').trim().toLowerCase();
  const issuedAt = /^\d{1,12}$/.test(t) ? Number(t) : null;
  const fields: WatchCodeFields = { pubkey, relays, holders, ...(executor ? { executor } : {}) };
  if (issuedAt === null || !SIG_HEX.test(sig) || !signedBy(fields, issuedAt, sig)) {
    throw new WatchCodeError(
      'That watch code is not signed by the watch it names, or was changed after it was signed, so nothing was filled in. Take a watch code only from whoever runs the watch.'
    );
  }

  return { ...fields, issuedAt, text: code };
}

/** Whether `sig` is the watch key's signature on these fields, signed at `issuedAt`. Never throws. */
function signedBy(fields: WatchCodeFields, issuedAt: number, sig: string): boolean {
  try {
    const event = watchCodeSignatureEvent(fields, issuedAt);
    return verifyEvent({ ...event, id: getEventHash(event), sig });
  } catch {
    return false;
  }
}

/** Codes already checked, by their text: storage is read on every render, a signature check is not free. */
const checked = new Map<string, WatchCode | null>();

/**
 * The escalation key a kept watch code gives the watch `pubkey`, and when it was signed, or null.
 *
 * Checked again here, wherever it is read: a code that is not one, is not signed by its watch, or
 * names another watch gives nothing — so a key cannot reach a watch except inside a code that watch
 * signed, however it got into storage.
 */
export function escalationOf(stored: unknown, pubkey: string): { key: string; issuedAt: number } | null {
  if (typeof stored !== 'string' || !stored) return null;
  let code = checked.get(stored);
  if (code === undefined) {
    try {
      code = parseWatchCode(stored);
    } catch {
      code = null;
    }
    if (checked.size > 16) checked.clear();
    checked.set(stored, code);
  }
  if (!code || !code.executor || code.pubkey !== pubkey.trim().toLowerCase()) return null;
  return { key: code.executor, issuedAt: code.issuedAt };
}

/** The watch saved on this phone, as a code filling Setup's form is compared with it. */
export interface SavedWatch {
  pubkey: string;
  relays: string[];
  holders: string[];
  executor: string | null;
  /** When the watch signed the code that key came in. */
  executorAt: number | null;
}

/** What saving a form filled from a code would change about the watch saved here. */
export interface CodeChanges {
  /** How the escalation key would change, or null: not this watch, or the same key. */
  key: 'added' | 'replaced' | 'dropped' | null;
  /** The code was signed before the one saved here, so saving it would undo a newer one. */
  older: boolean;
  /** Each change, in words, for the screen to list before anything is saved. */
  lines: string[];
}

/**
 * What saving the form — filled from `code`, perhaps edited since — would change about the watch
 * saved here. Nothing, for a code naming another watch: that is a new watch, not a change to this one.
 *
 * **An escalation key added counts as much as one replaced** [review: live hole, phone]. Every box's
 * operators have none saved today, so a code naming one for their own watch is where a key that is not
 * the watch's would arrive. A signature stops strangers, not the daemon beside the agent or a former
 * squad member, who hold the watch key too; what makes a code safe is who handed it over, and only the
 * operator knows that. So Setup lists every change and asks before a key changes.
 */
export function codeChanges(
  saved: SavedWatch | null,
  form: { pubkey: string; relays: string[]; holders: string[] },
  code: { pubkey: string; executor: string | null; executorAt: number | null }
): CodeChanges {
  const watch = form.pubkey.trim().toLowerCase();
  if (!saved || saved.pubkey.toLowerCase() !== watch || code.pubkey.toLowerCase() !== watch) {
    return { key: null, older: false, lines: [] };
  }
  const key: CodeChanges['key'] =
    code.executor === saved.executor
      ? null
      : code.executor && saved.executor
        ? 'replaced'
        : code.executor
          ? 'added'
          : 'dropped';
  const older = key !== null && saved.executorAt !== null && code.executorAt !== null && code.executorAt < saved.executorAt;
  const relays = form.relays.map((r) => r.trim()).filter(Boolean);
  const holders = form.holders.map((h) => h.trim().toLowerCase()).filter(Boolean);
  const savedHolders = saved.holders.map((h) => h.toLowerCase());
  const lines: string[] = [];
  for (const r of relays) if (!saved.relays.includes(r)) lines.push(`Adds the relay ${r}`);
  for (const r of saved.relays) if (!relays.includes(r)) lines.push(`Removes the relay ${r}`);
  for (const h of holders) if (!savedHolders.includes(h)) lines.push(`Adds the holder ${keyPrint(h) ?? h}`);
  for (const h of savedHolders) if (!holders.includes(h)) lines.push(`Removes the holder ${keyPrint(h) ?? h}`);
  if (key === 'added') lines.push('Adds an escalation key, the one key whose answer ends your Distress');
  if (key === 'replaced') lines.push('Replaces the escalation key, the one key whose answer ends your Distress');
  if (key === 'dropped') lines.push('Drops the escalation key: then anything holding the watch key can tell you a person has it');
  if (older) lines.push('The code is older than the one this phone already has');
  return { key, older, lines };
}
