/**
 * A watch code, as this phone keeps and compares it.
 *
 * The format — making a code, reading one, and the watch key's signature over it — is the protocol
 * between whoever hands a watch over and this phone, so it lives in `@navcom/core`
 * (`events/watch-code.ts`), where a box's executor makes the same codes. What stays here is this
 * phone's: reading the escalation key back from a kept code, checked again every time
 * ({@link escalationOf}), and what saving a code would change about the watch already saved here
 * ({@link codeChanges}), which Setup lists before anything is saved.
 */

import { keyPrint, parseWatchCode, type WatchCode } from '@navcom/core';

export {
  KIND_WATCH_CODE_SIGNATURE,
  WATCH_CODE_VERSION,
  WatchCodeError,
  looksLikeWatchCode,
  parseWatchCode,
  watchCode,
  watchCodeSignatureEvent,
  type WatchCode,
  type WatchCodeFields
} from '@navcom/core';

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
