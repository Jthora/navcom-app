/**
 * Com's own code: the list of its screens and the one component that draws whichever is on top
 * [docs/design/com.md §6]. The landing page imports this as it mounts, beside the map and the
 * mission feed, and no entry's code: each entry loads from here the first time one of its screens
 * opens [scripts/lib/budget.mjs ROOT_MOUNT, COM_ENTRIES].
 */
export { default as ComScreen } from './ComScreen.svelte';
export { SCREENS, load } from '$lib/com/screens';
