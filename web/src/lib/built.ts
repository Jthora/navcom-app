/**
 * When this build was made, as the client can actually know it.
 *
 * Injected by Vite's `define` (see `vite.config.ts`), so it is a literal in the bundle: it
 * survives being cached, works with no network, and cannot be recomputed on the device the
 * way a `load` return can.
 *
 * Two things depend on it and both were broken without it — the age of a cached copy of the
 * directory, and whether this phone's clock can be believed at all. A phone cannot
 * legitimately predate the build it is running, and that is the whole of the evidence.
 */
declare const __BUILT_AT__: string | undefined;

/**
 * Null rather than a guessed date when the constant is missing.
 *
 * Absent evidence is not evidence. Every reader here already treats null as "cannot
 * establish", which is the honest answer and the safe one; inventing an epoch or a `now`
 * would make one of the two failure directions invisible.
 */
export const BUILT_AT: string | null =
  typeof __BUILT_AT__ === 'string' && __BUILT_AT__.length > 0 ? __BUILT_AT__ : null;
