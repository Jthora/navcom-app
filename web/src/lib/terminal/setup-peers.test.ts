/**
 * What Setup and Peers do around a save, checked in their source.
 *
 * Setup put every saved relay line in its watch form, and a save checks each line it is given: a
 * working watch carrying one line from before the check refused every later edit, removing a holder
 * who had left the squad among them. The reason went to the top of the page, two sections above the
 * button and off a phone's screen, and the readout under the button still said Saved. On Peers,
 * "Where this goes" opened while part of the list was set aside, and closed when the save that
 * fixed it emptied that list — over the line saying what the save had done [audit: relay paths,
 * review of the fix].
 *
 * Source rather than the rendered page for the reason `prose.ts` gives: the terminal is
 * client-rendered, and nothing here can mount a screen. The rule Setup opens with is held in
 * `config.test.ts`; the browser tests in `unreachable-watch.spec.ts` and `relays.spec.ts` drive
 * both screens.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const SETUP = () => read('../../routes/terminal/setup/+page.svelte');
const PEERS = () => read('../../routes/terminal/peers/+page.svelte');
const script = (src: string) => src.slice(src.indexOf('<script'), src.indexOf('</script>'));
const markup = (src: string) => src.slice(src.indexOf('</script>')).replace(/<!--[\s\S]*?-->/g, '');
/** From the first `open` to the `close` after it. */
const between = (src: string, open: string, close: string) => {
  const at = src.indexOf(open);
  expect(at, `no ${open}`).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf(close, at));
};

describe('Setup’s watch form', () => {
  it('opens from `watchForm`, the rule config.test.ts holds', () => {
    expect(script(SETUP())).toMatch(/=\s*watchForm\(\)/);
  });

  it('says why a save was refused inside the watch’s own form, above its button', () => {
    const form = between(markup(SETUP()), '<form onsubmit={connect}>', '</form>');
    expect(form).toMatch(/data-watch-error/);
    expect(form.indexOf('data-watch-error')).toBeLessThan(form.indexOf('<button type="submit"'));
  });

  it('does not go on saying Saved after an update was refused', () => {
    const slot = between(markup(SETUP()), '<Slot k="Watch config">', '</Slot>');
    expect(slot).toMatch(/Not updated/);
    expect(slot.indexOf('Not updated')).toBeLessThan(slot.indexOf('value="Saved"'));
  });
});

describe('Peers’ “Where this goes”', () => {
  it('decides whether it opens by itself once, when the screen opens', () => {
    const src = PEERS();
    const open = /<Why summary="Where this goes" open=\{(\w+)\}>/.exec(src);
    expect(open, 'opened by a value set on mount, not by an expression a save changes').not.toBeNull();
    const name = open![1]!;
    const s = script(src);
    const mount = s.indexOf('onMount(');
    const mounted = s.slice(mount, s.indexOf('\n  });', mount));
    const elsewhere = s.replace(mounted, '');
    const assigned = (text: string) => [...text.matchAll(new RegExp(`\\b${name}\\s*=(?!=)`, 'g'))].length;
    expect(assigned(mounted), 'set when the screen opens').toBe(1);
    expect(assigned(elsewhere), 'and nowhere else but its declaration').toBe(1);
    expect(elsewhere).toMatch(new RegExp(`let ${name} = \\$state\\(false\\)`));
  });
});
