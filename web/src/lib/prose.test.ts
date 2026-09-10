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

describe('a disclosure names itself in a phrase, not a sentence', () => {
  /**
   * The longest summary that exists, held so it cannot get worse.
   *
   * Written after one at eleven words wrapped onto a second line on a phone and left its
   * little disclosure triangle stranded on the right of a line with nothing else on it. This
   * is a ratchet rather than a measurement: nine is what the codebase's worst already was, not
   * a width anybody has proved fits.
   *
   * It matters more than it looks. The summary is set uppercase with letter-spacing, which
   * costs width before a translator has touched it — and German and Finnish run about a third
   * longer than the English these were written in.
   */
  const LIMIT = 9;

  const summaries = (): { file: string; text: string }[] =>
    screens().flatMap((f) => {
      const src = readFileSync(join(ROOT, f), 'utf8');
      return [...src.matchAll(/summary="([^"]*)"/g)].map((m) => ({ file: f, text: m[1] }));
    });

  it('finds the summaries at all', () => {
    // A regex that matches nothing passes every assertion under it.
    expect(summaries().length).toBeGreaterThan(20);
  });

  it('keeps every one of them short enough not to wrap', () => {
    const long = summaries()
      .filter((s) => s.text.trim().split(/\s+/).filter(Boolean).length > LIMIT)
      .map((s) => `${s.file}: "${s.text}"`);
    expect(long, `longer than ${LIMIT} words:\n  ${long.join('\n  ')}`).toEqual([]);
  });
});

describe('a disclosure holds what was moved, not a second copy of what stayed', () => {
  /**
   * Written after it broke a test rather than after it looked wrong.
   *
   * Converting a screen tempts you to leave the claim on the glass **and** keep the whole
   * original paragraph behind the `Why`, so that nothing is lost. What that actually produces
   * is the same sentence twice in one page — and Playwright's `getByText` is strict, so
   * `backup.spec` went from asserting a sentence is visible to failing with *"resolved to 2
   * elements"* on the sentence it was guarding.
   *
   * Rule 3 says prose is relocated rather than deleted, and a claim that is still on the
   * screen has not been deleted. The `Why` carries the remainder.
   */
  const strip = (src: string): string => {
    let out = src;
    for (;;) {
      const open = /<Why\b/.exec(out);
      if (!open) return out;
      let depth = 0;
      let end = out.length;
      const scan = /<Why\b|<\/Why>/g;
      scan.lastIndex = open.index;
      for (let m = scan.exec(out); m; m = scan.exec(out)) {
        depth += m[0].startsWith('</') ? -1 : 1;
        if (depth === 0) {
          end = m.index + m[0].length;
          break;
        }
      }
      out = out.slice(0, open.index) + out.slice(end);
    }
  };

  const sentences = (markup: string): string[] => {
    const text = markup
      .replace(/<[^>]+>/g, ' ')
      .replace(/\{[^{}]*\}/g, ' ')
      .replace(/\s+/g, ' ');
    return text
      .split(/(?<=[.!?])\s+/)
      .map((x) => x.trim())
      .filter((x) => x.split(' ').length >= 5);
  };

  it('never says the same sentence on both sides of a disclosure', () => {
    const offenders: string[] = [];
    for (const f of screens()) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const markup = (src.split('</script>').pop() ?? '')
        .split('<style')
        .shift()!
        .replace(/<!--[\s\S]*?-->/g, '');
      const visible = new Set(sentences(strip(markup)));
      const hidden = sentences((markup.match(/<Why[\s\S]*?<\/Why>/g) ?? []).join(' '));
      for (const h of hidden) if (visible.has(h)) offenders.push(`${f}: "${h.slice(0, 70)}"`);
    }
    expect(
      offenders,
      `said both on the screen and inside its own Why:\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });
});
