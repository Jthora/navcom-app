/**
 * Com's missions entry, loaded the first time somebody opens one of its screens [docs/design/com.md
 * §6]: first paint never needs it, and the landing page's script budget has no room to carry it
 * there. One host draws every screen of the entry [$lib/com/screens].
 */
export { default as Host } from './MissionsHost.svelte';
