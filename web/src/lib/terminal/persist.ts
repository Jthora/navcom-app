/**
 * Asks the browser not to throw this device's data away.
 *
 * ## Why it is asked here and nowhere else
 *
 * `delivery.md` names eviction as the thing that decides whether the cached directory is
 * there at 2am, on a device floor of a prepaid Android 8 with 400MB free. The browser has an
 * API for exactly this and the app never called it.
 *
 * It is not called on load, and that is the whole design. **Firefox shows a permission prompt
 * for `persist()`**, and an unexpected prompt on a field terminal is the banner-shaped
 * interruption this project bans everywhere else — worst of all on the screen somebody
 * reaches for while something is happening. Chromium grants it silently.
 *
 * So it is asked once, at callsign creation: a deliberate, unhurried moment the operator
 * chose to be in, where a browser prompt reads as part of setting something up rather than as
 * an interruption. Nothing later in the app ever asks again, and nothing is withheld if the
 * answer is no.
 *
 * ## Why the result is discarded
 *
 * There is nothing useful to say about a refusal. The consequence — that a phone short of
 * space may throw this away — is already said in two places an operator will meet: the
 * backup screen ("a lost phone is a lost persona") and the home-screen panel on Status. A
 * third notice reporting a browser policy nobody can act on would be noise, and this app
 * spends everything else keeping that screen quiet.
 */
export async function askToKeep(): Promise<boolean> {
  try {
    const store = navigator?.storage;
    if (!store?.persist) return false;
    // Already granted on a return visit: asking again can prompt a second time.
    if (store.persisted && (await store.persisted())) return true;
    return await store.persist();
  } catch {
    // A browser that refuses to answer is a browser that has not granted it. Never throws
    // into whatever was creating an identity.
    return false;
  }
}
