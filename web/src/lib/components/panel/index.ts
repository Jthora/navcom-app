/**
 * The panel vocabulary, in one import.
 *
 * See `docs/design/panel.md`. These are the pieces a converted screen is built from, and the
 * point of them is that a screen cannot improvise around the rules: `Slot` always renders,
 * `Readout` marks itself when it has become a sentence, and `Why` is where prose goes rather
 * than being deleted.
 */
export { default as Panel } from './Panel.svelte';
export { default as Slot } from './Slot.svelte';
export { default as Readout } from './Readout.svelte';
export { default as Why } from './Why.svelte';
export { default as Action } from './Action.svelte';
export { default as Window } from './Window.svelte';
export { default as Elapsed } from './Elapsed.svelte';
export { default as Heartbeat } from './Heartbeat.svelte';
export { default as Board } from './Board.svelte';
