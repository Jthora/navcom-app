import { BUILT_AT } from '$lib/built';

/**
 * The Field Terminal is an application, not a page — so client rendering is on here and
 * only here. Everything outside /terminal stays at zero JavaScript, and the budget check
 * enforces that split rather than trusting it.
 */
export const prerender = true;
export const ssr = true;
export const csr = true;
export const trailingSlash = 'always';

/**
 * The stamp every screen measures the device clock against.
 *
 * Evaluated at prerender, so it is the moment this build was made — and a phone cannot
 * legitimately predate the build it is running. That makes it proof of a wrong clock needing
 * no network, no relay and no permission, which is the only kind of proof available to the
 * operator working Alone. See `$lib/terminal/clock`.
 */
export const load = () => ({ built: BUILT_AT });
