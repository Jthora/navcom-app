/**
 * A wipe or a burn in another document: a second tab, or this page while it sat in the back-forward
 * cache [invariant 5].
 *
 * A wipe ran in the document that wiped and nowhere else. A second tab went on holding tonight in
 * memory and writing it back — the map's missions copy recreated `navcom.wipeable` within two
 * seconds — and a page restored by Back showed what it had drawn before the wipe. Imported for its
 * effect: once loaded, this document hears both and runs `wiped` (`storage.ts`) as the wiping one did.
 *
 * Its own module rather than part of `storage.ts`, which is on the root page's first paint and has
 * no room for it. The root loads this with its missions copy (`missions/live.ts`), the one thing it
 * holds tonight in memory, and every terminal page with the terminal layout.
 */

import { BORN, TIERS, born, generation, keyFor, made, seal, wiped, type Tier, type Wiped } from './storage';

/** The name of a tier's blob as stored now: null for no blob, `true` for one with no name. */
function nameOf(tier: Tier): unknown {
  const raw = localStorage.getItem(keyFor(tier));
  try {
    return raw === null ? null : (JSON.parse(raw)[BORN] ?? true);
  } catch {
    return true;
  }
}

/**
 * Loads this page again. Until the new one replaces it this one still runs — a relay can still
 * deliver — so from here it writes nothing (`seal`), and nothing it hears is its to act on.
 */
let leaving = false;
const reload = () => {
  leaving = true;
  seal();
  location.reload();
};

if (typeof addEventListener === 'function') {
  const ACCRUING = keyFor('accruing');
  const WIPEABLE = keyFor('wipeable');

  /*
   * Another tab's wipe or burn. The event arrives once the key is gone. Nothing but a destroy path
   * removes either tier's blob, and `clear()` (key null) takes both tiers. **A limit:** a wipe that
   * found no blob sends no event, so Wipeable data kept only under its own key (a crew roster, a
   * keyed cache) needs a signal of its own before it exists. Keys under the name are not one:
   * a store evicting its own cache would read as a wipe.
   */
  addEventListener('storage', (e) => {
    const key = e.key;
    if (leaving || e.newValue !== null || !(key === null || key === ACCRUING || key === WIPEABLE)) return;
    const drew = born.accruing;
    const fresh = generation('accruing') === 0;
    /*
     * Which act, from storage as it is now and not from the key alone: a burn arrives as one
     * removal per key, and a watcher told "wipe" and then "burn" would keep an identity it was
     * about to drop. A burn removes the decade first (`destroy` goes in name order), so this hears
     * it first; and if the tonight event comes first anyway, the decade being gone says which.
     */
    const what: Wiped = key !== WIPEABLE || (drew && localStorage.getItem(ACCRUING) === null) ? 'burn' : 'wipe';
    wiped(what);
    /*
     * Something this document wrote after the other tab destroyed the tier and before this one
     * heard it: a blob under a name only this document gave. Only that one — a blob somebody made
     * after the destroy has its own name, and an event heard late, by a tab that was frozen, must
     * not take a sign-on made since.
     */
    for (const t of what === 'burn' ? TIERS : (['wipeable'] as const)) {
      if (made[t] && nameOf(t) === made[t]) localStorage.removeItem(keyFor(t));
    }
    /*
     * And after a burn this page loads again. Whatever holds the decade in memory — corrections for
     * a metro, places, other people's key bundles — wrote all of it back on its next event, so a
     * burn with a second tab open did not destroy everything. The burning tab stops everything it
     * was sending; a page loaded with no identity has nothing to send. Not a document that applied
     * a burn itself and has drawn no identity since: that is the burning tab hearing this clean-up,
     * part-way through its own, and a reload there would stop it before the offline copies go.
     */
    if (what === 'burn' && (drew || fresh)) reload();
  });

  /*
   * A page brought back by Back or Forward from the back-forward cache. It may have been frozen
   * through a wipe and heard nothing, and it shows what it drew before — a held count, a sign-on.
   * **Only when a blob it drew from is gone or was made again since**, which nothing but a wipe or
   * a burn does: running every forget on an ordinary Back would drop a watch and a Distress for
   * nothing. Made again, not only gone: a wipe followed by a sign-on leaves a blob on the phone. It
   * then loads again, because a frozen page cannot know which of what it drew came from the tier.
   */
  addEventListener('pageshow', (e) => {
    if (leaving || !e.persisted) return;
    const gone = TIERS.filter((t) => {
      const was = born[t];
      const now = nameOf(t);
      // A blob from before names can only be told apart by being gone.
      return was === true ? now === null : !!was && now !== was;
    });
    if (gone.length === 0) return;
    wiped(gone.includes('accruing') ? 'burn' : 'wipe');
    reload();
  });
}
