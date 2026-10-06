/**
 * The grid's proving ground [build-order 11.2].
 *
 * The map runs here, alone, on real phones, before 11.3 rebuilds the landing page around it —
 * the riskier change, and the one that should not also be the first time the map meets a cheap
 * Android. Not linked from anywhere, not indexed, and absorbed into the landing page by 11.3.
 */
export const prerender = true;
export const ssr = true;
export const csr = true;
export const trailingSlash = 'always';
