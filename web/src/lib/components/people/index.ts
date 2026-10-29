/**
 * Com's people entry: anybody's profile, your own, and Find [docs/design/groups.md §3, §4].
 *
 * Loaded the first time one of its screens opens, never at first paint or mount, and charged to its
 * own line in `scripts/lib/budget.mjs` [MAP_LINES `people`]. Opening a mission never loads it.
 */
export { default as Host } from './PeopleHost.svelte';
