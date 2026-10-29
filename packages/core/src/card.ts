/**
 * A card, as a page that only shows cards reads it: `@navcom/core/card`.
 *
 * The same modules the package's index exports, by a path that reaches nothing else. Through the
 * index, a page took every module core has into its dependencies, and the bundler gave it the chunk
 * they share: the public roster loaded the whole mission reader to show a list of names
 * (boundaries.test.ts, measured 2026-10-10). A page that imports from here and from `./relays` alone
 * loads neither the reader nor anything else it never calls.
 */
export { KIND_CARD } from './events/kinds.js';
export { readCard, type Card, type PublishedCard } from './events/public.js';
export { AGENT_LABEL, PUBLIC_LABEL, does, isAgentCard } from './events/profile.js';
export { EARTH, readAreas, type CardArea } from './events/area.js';
export { platform } from './events/links.js';
export { keyPrint } from './crypto/keys.js';
