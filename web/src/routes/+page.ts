/**
 * The root console is an instrument, not a page — so client rendering is on here too,
 * same as `/terminal/`. `(site)` stays at zero JavaScript; this is the one other exception,
 * and the budget check enforces the split rather than trusting it [budget.mjs].
 */
export const prerender = true;
export const ssr = true;
export const csr = true;
export const trailingSlash = 'always';
