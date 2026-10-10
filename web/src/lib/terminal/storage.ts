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
/** Every key this app writes, in either storage, is under this name. */
const OURS = 'navcom';

/**
 * Removes the key `name` and every key under it (`name.…`), in one storage, without reading any.
 *
 * **Destroyed by name, not by list.** This was a fixed list of two keys per tier — the blob and
 * its salvage copy — and every later Wipeable thing (a crew roster, the log cache, a keyed store)
 * needs a key of its own that such a list cannot know about. A key under `navcom.wipeable.` is
 * tonight's by its name, and goes; nobody has to remember to add it here. Under it, not merely
 * starting with it: `navcom.wipeablex` would be somebody's new decade.
 *
 * Blind to content on purpose: no parsing and no decryption, so a damaged or unreadable value is
 * destroyed exactly like a good one. In name order, so `navcom.accruing` goes before
 * `navcom.wipeable` and another tab hears a burn as a burn first.
 */
function destroy(store: 'localStorage' | 'sessionStorage', name: string): void {
  let s: Storage | undefined;
  try {
    s = globalThis[store];
  } catch {
    // A browser refusing this page storage: there is nothing in it to destroy.
  }
  if (!s) return;
  const doomed: string[] = [];
  // Collected first: removing while counting would skip the key after each one removed.
  for (let i = 0; i < s.length; i++) {
    const key = s.key(i);
    if (key === name || key?.startsWith(name + '.')) doomed.push(key);
  }
  for (const key of doomed.sort()) s.removeItem(key);
}

export type Tier = 'accruing' | 'wipeable';
export const keyFor = (tier: Tier): string => (tier === 'accruing' ? ACCRUING : WIPEABLE);
export const TIERS: Tier[] = ['accruing', 'wipeable'];

/**
 * Calls each function with `x`, each one isolated.
 *
 * Found in robustness audit that a throwing storage-error watcher propagated straight through
 * report() -> write() -> set(), breaking the one guarantee this module exists to provide for every
 * other caller and watcher. A wipe watcher that threw would likewise stop every one after it from
 * forgetting what it holds.
 */
function each<T>(fns: Set<(x: T) => void>, x: T): void {
  for (const fn of fns) {
    try {
      fn(x);
    } catch (err) {
      console.error('[storage] a watcher threw:', err);
    }
  }
}

/**
 * How many times each tier has been destroyed, as far as this document knows.
 *
 * A writer that waits — a debounced save, a publish that records how it went — reads, goes away,
 * and comes back to write. One that began before a wipe and wrote after it put tonight straight
 * back: a second tab's missions copy recreated `navcom.wipeable` within two seconds. So a writer
 * takes `generation(tier)` when it starts and hands it to `set`, which refuses it once the tier has
 * been destroyed since. The board's own guard (`board.svelte.ts`), moved down to where any writer
 * can take it.
 *
 * **Only the missions copy (`live.ts`) takes it so far.** A claim, a release and a report each
 * write after awaiting a publish (`missions/claims.ts`, `missions/reports.ts`), and sign-on after
 * awaiting its send (`session.svelte.ts`): a wipe while one is in flight is still followed by what
 * it records. Each needs `since` taken before its first await.
 *
 * Per tier, so a panic wipe refuses nothing bound for the decade, which it does not touch. Kept in
 * memory only: a persistent "wiped" marker would tell whoever holds the phone there was something
 * to wipe.
 */
const gen: Record<Tier, number> = { accruing: 0, wipeable: 0 };

/**
 * A field in each tier's blob holding a random name, given to it when it is written without one.
 *
 * So a page can tell the blob it read from one made since: a wipe followed by a sign-on leaves a
 * `navcom.wipeable` on the phone again, and a page that only asked whether one was there missed
 * the wipe. Not a count and not a date, and it says nothing about whether anything was ever wiped.
 */
export const BORN = '~';
/** The name of each tier's blob as this document last read or wrote it: `true` for one with none yet, false for none. */
export const born: Partial<Record<Tier, unknown>> = {};
/** The name this document last gave a blob, so it can recognise one it made after another tab's destroy. */
export const made: Partial<Record<Tier, unknown>> = {};

export const generation = (tier: Tier): number => gen[tier];

export type Wiped = 'wipe' | 'burn';
const wipeWatchers = new Set<(what: Wiped) => void>();

/**
 * Subscribes to a wipe or a burn in this document, another tab, or while this page was in the
 * back-forward cache (`wiped-elsewhere.ts`). Returns the unsubscribe.
 *
 * For whatever holds tonight in memory and must let it go: a page can only clear what it imports,
 * and a crew handle or a card cache is not something the wipe screen may import [groups.md]. Called
 * after the tier is gone. A watcher writes nothing back: anything it would write began before.
 */
export const onWipe = (fn: (what: Wiped) => void): (() => void) => {
  wipeWatchers.add(fn);
  return () => wipeWatchers.delete(fn);
};

/**
 * A wipe or a burn happened, here or elsewhere: this tab's own storage goes, older writes are
 * refused from here on, and every watcher is told. Called by the two destroy paths below and by
 * `wiped-elsewhere.ts`, and by nothing else.
 *
 * Everything of ours in sessionStorage is tonight's whichever act it was — it ends with the tab, so
 * none of it can be the decade — and each tab's is its own: a wipe in another tab cannot reach this
 * one's, so this tab destroys it on hearing.
 */
export function wiped(what: Wiped): void {
  destroy('sessionStorage', OURS);
  for (const tier of what === 'burn' ? TIERS : (['wipeable'] as const)) {
    gen[tier]++;
    born[tier] = false;
  }
  each(wipeWatchers, what);
}

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
  born[tier] = raw !== null;
  if (raw === null) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    born[tier] = parsed[BORN] ?? true;
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
  // Each watcher isolated (`each`): a throwing one must not break the write for the caller.
  each(watchers, message);
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
/**
 * Set once this document is loading again after a wipe or a burn it heard (`wiped-elsewhere.ts`):
 * until the new page replaces it, everything it would write was drawn before, so it writes nothing.
 */
let sealed = false;
export const seal = (): void => {
  sealed = true;
};

function write(tier: Tier, data: Record<string, unknown>): boolean {
  if (sealed || typeof localStorage === 'undefined') return false;
  data[BORN] ??= made[tier] = Math.random().toString(36).slice(2);
  try {
    localStorage.setItem(keyFor(tier), JSON.stringify(data));
    born[tier] = data[BORN];
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

/**
 * Returns whether it was actually stored, so a caller can say so.
 *
 * `since` is `generation(tier)` as it was when the writer began: a write that began before a wipe
 * of this tier is refused, quietly — nothing failed that the operator could fix.
 */
export function set(tier: Tier, field: string, value: unknown, since?: number): boolean {
  if (since !== undefined && since !== gen[tier]) return false;
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
 * Destroys the Wipeable tier, and preserves the decade [invariant 5].
 *
 * Identity, standing and the Watchtower you belong to all survive — an operator who wipes
 * on a bad night should not have to find a person and be re-provisioned before they can
 * work again.
 *
 * **Every key under `navcom.wipeable` is the tier**, not just the blob. A damaged blob is kept
 * under `.damaged` so an operator can recover it by hand, and for two passes that copy sat
 * outside the wipe: the operator held the button down, watched it clear, and the thing they
 * destroyed was still on the device. A fixed list of keys is how that happened, so there is no
 * list: a key is tonight's by its name.
 *
 * **And everything of ours in this tab's sessionStorage.** It ends with the tab, so nothing in it
 * can be the decade — and the mission somebody left to take a callsign sat there through a wipe,
 * so Status went on offering "Back to" it on a phone that had just been wiped.
 *
 * Then every `onWipe` watcher in this document is told, and other open tabs hear it too.
 */
export function panicWipe(): void {
  if (typeof localStorage === 'undefined') return;
  destroy('localStorage', WIPEABLE);
  wiped('wipe');
}

/**
 * Destroys everything on this device, including identity: every key of ours, in both storages.
 *
 * Deliberate, harder to reach, and irreversible — there is no recovery unless the operator
 * set one up. Meant for compulsion or seizure with intent, not for a phone that might be
 * glanced at. Every other open tab of this app hears it and loads again, with nothing.
 */
export function burn(): void {
  if (typeof localStorage === 'undefined') return;
  destroy('localStorage', OURS);
  wiped('burn');
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

/**
 * Whether this confirmation matches — **with no side effect**, so a template can ask.
 *
 * Split out because the wipe screen could not ask. `sameName` is module-private and
 * `burnConfirmed` destroys the device as it answers, so the button re-derived the match with a
 * raw `typed.trim() !== callsign` — no normalisation, and no trim on the callsign either. That
 * is the exact bug normalising was added to fix, reintroduced one file over: an operator whose
 * callsign carries combining characters, or a stored trailing space, watched the button stay
 * disabled while `burnConfirmed` would have accepted them. A confirmation nobody can satisfy is
 * not a safeguard, and this one guards seizure and compulsion.
 *
 * The gate still lives here. What the template gets is the same question, asked safely.
 */
export const burnArmed = (typed: string, callsign: string | null): boolean =>
  // No identity means nothing to burn — and an empty confirmation must never match an
  // empty callsign into a successful destroy.
  !!callsign && sameName(typed.trim(), callsign.trim());

export function burnConfirmed(typed: string, callsign: string | null): boolean {
  if (!burnArmed(typed, callsign)) return false;
  burn();
  return true;
}

/** What a wipe would actually remove, so the operator can be told before it happens. */
export function tierSummary(): { accruing: string[]; wipeable: string[] } {
  // The blob's own name is not something the operator keeps.
  const fields = (t: Tier) => Object.keys(read(t)).filter((k) => k !== BORN);
  return { accruing: fields('accruing'), wipeable: fields('wipeable') };
}
