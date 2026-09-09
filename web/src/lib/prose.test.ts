/**
 * The prose budget, as a ratchet.
 *
 * `prose.ts` says why this is measured from source. This says what is done with the number:
 * it may fall, and it may not rise.
 *
 * A cap alone would freeze 6,512 words in place as though they were the intended design. A
 * ratchet cannot: when a screen is converted the slack has to be recorded, so the baseline
 * tracks the work rather than trailing behind it, and the diff of every conversion carries the
 * number it moved. Running `npm run prose:baseline` rewrites the file.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { proseIn } from './prose';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BASELINE = fileURLToPath(new URL('./prose-baseline.json', import.meta.url));

/** Every screen and every component that can put prose in front of somebody. */
function screens(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.svelte')) out.push(relative(ROOT, full).split('\\').join('/'));
    }
  };
  walk(join(ROOT, 'src/routes'));
  walk(join(ROOT, 'src/lib/components'));
  return out.sort();
}

const measured = new Map(
  screens().map((f) => [f, proseIn(readFileSync(join(ROOT, f), 'utf8')).words] as const)
);

if (process.env.UPDATE_PROSE_BASELINE) {
  writeFileSync(BASELINE, JSON.stringify(Object.fromEntries(measured), null, 2) + '\n');
}

const baseline: Record<string, number> = JSON.parse(readFileSync(BASELINE, 'utf8'));

describe('the prose budget only goes down', () => {
  /**
   * How far below its recorded number a screen may sit before the number has to be rewritten.
   *
   * 40 words, which is `panel.md`'s own target for a whole screen. Anything smaller would make
   * the baseline churn on a copy edit; anything larger lets a converted screen keep quoting a
   * budget it no longer needs, which is how the first gate rotted.
   */
  const SLACK = 40;

  it('has a recorded budget for every screen, and no screen it has forgotten', () => {
    const unrecorded = [...measured.keys()].filter((f) => !(f in baseline));
    expect(
      unrecorded,
      `not in prose-baseline.json — a new screen records its budget deliberately:\n  ${unrecorded.join('\n  ')}`
    ).toEqual([]);

    const stale = Object.keys(baseline).filter((f) => !measured.has(f));
    expect(stale, `in prose-baseline.json but gone from the tree:\n  ${stale.join('\n  ')}`).toEqual(
      []
    );
  });

  it('lets no screen grow', () => {
    const grown: string[] = [];
    for (const [file, words] of measured) {
      const was = baseline[file];
      if (was === undefined || words <= was) continue;
      grown.push(`${file}: ${was} → ${words} (+${words - was})`);
    }
    expect(
      grown,
      `these screens gained prose outside a Why. Put it behind one, or record the rise:\n  ${grown.join('\n  ')}`
    ).toEqual([]);
  });

  it('makes a screen that shrank record it', () => {
    const slack: string[] = [];
    for (const [file, words] of measured) {
      const was = baseline[file];
      if (was === undefined || was - words <= SLACK) continue;
      slack.push(`${file}: ${was} → ${words} (−${was - words})`);
    }
    expect(
      slack,
      `these screens are well under budget. Run \`npm run prose:baseline\` so the ratchet holds the gain:\n  ${slack.join('\n  ')}`
    ).toEqual([]);
  });
});

describe('what counts as prose', () => {
  it('does not count what is behind a Why, however nested', () => {
    const src = `
      <p>One two three.</p>
      <Why summary="x"><p>not counted</p><Why summary="y"><p>nor this</p></Why><p>nor this either</p></Why>
      <p>Four five.</p>`;
    expect(proseIn(src)).toEqual({ words: 5, paragraphs: 2 });
  });

  it('ignores the script block, the style block and comments', () => {
    const src = `
      <script lang="ts">const a = 'one two three four';</script>
      <!-- five six seven -->
      <p>Eight nine.</p>
      <style>.x { content: 'ten eleven'; }</style>`;
    expect(proseIn(src).words).toBe(2);
  });

  it('counts the literal text inside a block, and not the braces around it', () => {
    // `{#if}` and `{value}` are not words anybody reads; the text between them is.
    expect(proseIn('<p>{#if x}Call first{/if} {name} today.</p>').words).toBe(3);
  });

  it('counts a list item, because a list of sentences is prose with bullets on', () => {
    expect(proseIn('<li>One two.</li><li>Three.</li>').words).toBe(3);
  });

  it('does not count headings, slot keys or buttons', () => {
    // Rule 3 is about explanation. A label says what a thing is and stays on the screen.
    expect(proseIn('<h1>Distress</h1><button>File it</button><span>Owl</span>').words).toBe(0);
  });
});
