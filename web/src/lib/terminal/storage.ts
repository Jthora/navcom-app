/**
 * Device storage, in two tiers with opposite retention rules.
 *
 * **Accruing** — identity, standing, contributions. Losing it is the failure.
 * **Wipeable** — tonight's data. Retaining it is the failure.
 *
 * That split is not a nicety, it is what makes panic wipe meaningful: an operator under
 * duress should lose the evening and keep the decade. Two keys rather than one, so a wipe
 * cannot take the wrong half by accident.
 *
 * Honest limits, since a browser is what we have:
 *
 * - There is no OS keystore here. The secret sits in localStorage, readable by any script
 *   that runs on this origin. A native shell would do better, and that is one of the two
 *   things listed as justifying one
 * - `localStorage.removeItem` is not a secure erase. It unlinks; it does not scrub the
 *   underlying pages
 *
 * Both are stated rather than implied, because an operator who believes a wipe is total is
 * worse off than one who knows the boundary.
 */

const ACCRUING = 'navcom.accruing';
const WIPEABLE = 'navcom.wipeable';

/**
 * Every key one tier's data can occupy — the blob, and the salvage copy of a damaged one.
 *
 * One list, used by both destroy paths, so a new key cannot be added to storage and missed
 * by the wipe.
 */
const keysOf = (tierKey: string): string[] => [tierKey, `${tierKey}.damaged`];

export type Tier = 'accruing' | 'wipeable';
const keyFor = (tier: Tier) => (tier === 'accruing' ? ACCRUING : WIPEABLE);

/**
 * Tiers whose stored text would not parse.
 *
 * Reading corrupt storage as empty is right — a terminal that will not start because of a
 * bad key is worse than one that asks to be set up again — but it presented as a **first
 * run**, which is a different and much worse lie. An operator whose identity blob got
 * damaged saw "pick a callsign" and concluded they had been wiped.
 */
const corrupt = new Set<Tier>();

export const corruptTiers = (): Tier[] => [...corrupt];

function read(tier: Tier): Record<string, unknown> {
  if (typeof localStorage === 'undefined') return {};
  const raw = localStorage.getItem(keyFor(tier));
  if (raw === null) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    corrupt.delete(tier);
    return parsed;
  } catch {
    /*
     * Kept, not discarded.
     *
     * The next write would have overwritten the damaged text and destroyed the only copy —
     * and a damaged blob is JSON in localStorage, which somebody can often read by hand. A
     * decade of standing is worth a few kilobytes of salvage.
     *
     * Written once: a second failure must not overwrite the salvage with a copy of itself
     * after the first write has already replaced the original.
     */
    corrupt.add(tier);
    const salvageKey = `${keyFor(tier)}.damaged`;
    try {
      if (localStorage.getItem(salvageKey) === null) localStorage.setItem(salvageKey, raw);
    } catch {
      // No room to keep it. Nothing to be done, and losing the salvage must not also stop
      // the terminal starting.
    }
    return {};
  }
}

/**
 * Whether the last write failed, and why.
 *
 * A failed write is the one storage failure that must not be silent. Quota is finite —
 * typically 5–10 MB — and this device accumulates corrections for a whole metro, peers,
 * endorsements and a patrol record. **An operator whose storage is full silently stops
 * recording patrols**, which is the thing they rely on being there afterwards.
 */
let lastError: string | null = null;

/**
 * Who to tell when a write fails.
 *
 * `write` recorded the failure and returned it, and the comment there said *"the screens
 * that write ask."* **None of them did** — thirty-odd call sites discarded the boolean, and
 * the only screen that ever read the message was Status, once, at mount. So an operator
 * whose phone was full closed a patrol, saw it accepted, and learned nothing until they
 * happened to open a different screen.
 *
 * A caller that wants to react at the point of failure still can. This exists so that the
 * ones that do not still cannot fail silently.
 */
type Watcher = (message: string | null) => void;
const watchers = new Set<Watcher>();

const report = (message: string | null): void => {
  if (message === lastError) return;
  lastError = message;
  // Each watcher isolated: found in robustness audit that a throwing watcher propagated
  // straight through report() -> write() -> set(), breaking the one guarantee this module
  // exists to provide for every other caller and watcher. Latent today (the one production
  // subscriber is simple and safe), but a real hole a second watcher would reopen.
  for (const watcher of watchers) {
    try {
      watcher(message);
    } catch (err) {
      console.error('[storage] a storage-error watcher threw:', err);
    }
  }
};

/** Subscribes to write failures. Returns the unsubscribe. */
export const onStorageError = (watcher: Watcher): (() => void) => {
  watchers.add(watcher);
  return () => watchers.delete(watcher);
};

export const storageError = (): string | null => lastError;
export const clearStorageError = (): void => {
  report(null);
};

/**
 * Writes a tier, reporting failure rather than throwing into whichever handler was writing.
 *
 * Throwing would surface as a rejected click somewhere with no message, and the operator
 * would find out that nothing had been saved by looking for it later. So the failure is
 * recorded and returned, and every terminal screen shows it — through the layout, because
 * asking each of thirty call sites to remember is how it went unreported for two milestones.
 */
function write(tier: Tier, data: Record<string, unknown>): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(keyFor(tier), JSON.stringify(data));
    report(null);
    return true;
  } catch (e) {
    /*
     * Matched on the error's NAME, not its text.
     *
     * The first version tested `name + message` for "quota", which misclassified any other
     * failure whose message happened to mention it -- and the two need different words,
     * because only one of them is fixed by clearing an area. Private-browsing modes throw a
     * SecurityError here; Firefox has historically used its own quota name.
     */
    const name = e instanceof Error ? e.name : '';
    const outOfRoom = name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
    report(
      outOfRoom
        ? 'This phone is out of storage, so that was not saved. Clearing an area you no longer carry will free some.'
        : 'That could not be saved on this phone.'
    );
    return false;
  }
}

export function get<T>(tier: Tier, field: string): T | null {
  const v = read(tier)[field];
  return v === undefined ? null : (v as T);
}

/** Returns whether it was actually stored, so a caller can say so. */
export function set(tier: Tier, field: string, value: unknown): boolean {
  const data = read(tier);
  data[field] = value;
  return write(tier, data);
}

export function clearField(tier: Tier, field: string): void {
  const data = read(tier);
  delete data[field];
  write(tier, data);
}

/**
 * Roughly how much this device is holding, in bytes.
 *
 * For telling an operator what is taking the room before they have to guess. Not a
 * count of anything anybody did — a measurement of a device.
 */
export function tierSizes(): { accruing: number; wipeable: number } {
  if (typeof localStorage === 'undefined') return { accruing: 0, wipeable: 0 };
  return {
    accruing: (localStorage.getItem(ACCRUING) ?? '').length,
    wipeable: (localStorage.getItem(WIPEABLE) ?? '').length
  };
}

/**
 * Destroys tonight and preserves the decade.
 *
 * Identity, standing and the Watchtower you belong to all survive — an operator who wipes
 * on a bad night should not have to find a person and be re-provisioned before they can
 * work again.
 */
/**
 * Destroys the Wipeable tier [invariant 7].
 *
 * **The salvage copy is part of the tier.** A damaged blob is kept under `.damaged` so an
 * operator can recover it by hand, and for two passes that copy sat outside the wipe: a
 * phone whose wipeable storage had ever been corrupted kept a readable copy of it through a
 * panic wipe. The operator holds the button down, watches it clear, and the thing they
 * destroyed is still on the device.
 *
 * Anything holding tier data must be listed here. Adding a key elsewhere and forgetting this
 * function is exactly how it happened.
 */
export function panicWipe(): void {
  if (typeof localStorage === 'undefined') return;
  for (const key of keysOf(WIPEABLE)) localStorage.removeItem(key);
}

/**
 * Destroys everything on this device, including identity.
 *
 * Deliberate, harder to reach, and irreversible — there is no recovery unless the operator
 * set one up. Meant for compulsion or seizure with intent, not for a phone that might be
 * glanced at.
 */
export function burn(): void {
  if (typeof localStorage === 'undefined') return;
  for (const key of [...keysOf(WIPEABLE), ...keysOf(ACCRUING)]) localStorage.removeItem(key);
}

/**
 * Removes the offline caches: the app shell and the cached directory.
 *
 * `burn()` claims everything on this device, and until this existed that claim stopped at
 * localStorage — the service worker cache kept the directory and every terminal page.
 * Async because the Cache API is, and a burn that returns before the bytes are gone is the
 * same false confidence a wipe screen exists to avoid.
 */
export async function burnCaches(): Promise<void> {
  if (typeof caches === 'undefined') return;
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
}

/**
 * Burns only when the operator has typed their callsign exactly.
 *
 * The gate lives here rather than in a template so it cannot be bypassed by a second screen
 * that forgets it. Burn is the one action in the terminal with no recovery, and the check
 * belongs next to the thing it guards.
 *
 * Returns whether it burned, so a caller can tell "refused" from "done" without re-deriving
 * the rule.
 */
/**
 * Compared the way a person reads it, not the way it is stored.
 *
 * `José` can be one code point or two, depending on which keyboard produced it, and the two
 * render identically. Unnormalised, an operator who set up on one device and typed the
 * confirmation on another was refused their own callsign — the screen showing them a name
 * that looked exactly like what they had typed — while trying to destroy the device. A
 * confirmation nobody can satisfy is not a safeguard.
 *
 * **NFC, not NFKC.** Canonical equivalence only: two strings that are the same character.
 * NFKC also folds compatibility forms, which would let a visibly *different* callsign match,
 * and this gate ends in destroying everything on the phone.
 */
const sameName = (a: string, b: string): boolean => a.normalize('NFC') === b.normalize('NFC');

export function burnConfirmed(typed: string, callsign: string | null): boolean {
  // No identity means nothing to burn — and an empty confirmation must never match an
  // empty callsign into a successful destroy.
  if (!callsign) return false;
  if (!sameName(typed.trim(), callsign.trim())) return false;
  burn();
  return true;
}

/** What a wipe would actually remove, so the operator can be told before it happens. */
export function tierSummary(): { accruing: string[]; wipeable: string[] } {
  return { accruing: Object.keys(read('accruing')), wipeable: Object.keys(read('wipeable')) };
}
