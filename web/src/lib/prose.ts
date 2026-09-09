/**
 * How many words a screen asks a person to read before they open anything.
 *
 * ## Why this exists
 *
 * `docs/design/panel.md` carries two rules about text. One of them — a readout fits in five
 * words — has been enforced since the day it was written, by `panel.ts` and a browser test,
 * and it has **never been violated**. The other — no `<p>` outside a `Why` — had its gate
 * written as *"re-measure"*, a step a human performs. It is now violated 333 times across
 * 6,512 words.
 *
 * Same doctrine, same author, same year. The only difference between them is that one was
 * executable. This makes the second one executable too.
 *
 * ## Why it counts source rather than the built page
 *
 * Everywhere else this project prefers a test against the built artifact, and says so, because
 * three times it has shipped a rule the logic honoured and the output did not. Two things make
 * that the wrong instrument here.
 *
 * The terminal is client-rendered — its prerendered HTML is a shell, and *"Dark is not an
 * error"* appears nowhere in `build/terminal/index.html`. And what a rendered DOM contains
 * depends on the state it was rendered in: the clock panel exists only on a phone whose clock
 * is wrong, the breach readouts only after a log has been rewritten. A baseline measured that
 * way would record one arbitrary state per screen and move whenever the seed changed.
 *
 * Source measures **what a screen can put in front of somebody**, which is the quantity both
 * the panel budget and a translation catalogue actually care about.
 *
 * ## Why `<p>` and `<li>` and nothing else
 *
 * Rule 3 is about prose, not about labels. A heading, a slot key and a button say what a thing
 * is; a paragraph explains it, and explanation is the thing that belongs one layer down.
 */

export interface Prose {
  words: number;
  paragraphs: number;
}

/** A run of non-space containing at least one letter. Matches `wordCount` in `panel.ts`. */
const words = (text: string): number =>
  text
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w)).length;

/**
 * Strips a balanced element, including any nested copies of itself.
 *
 * A regex cannot do this and a wrong one fails quietly in the direction that flatters the
 * number: `<Why>[\s\S]*?</Why>` stops at the first close tag, so a `Why` containing another
 * one would leave the tail of the outer block counted as though it were on the screen.
 */
function stripElement(source: string, tag: string): string {
  const open = new RegExp(`<${tag}\\b`, 'g');
  let out = source;
  for (;;) {
    open.lastIndex = 0;
    const first = open.exec(out);
    if (!first) return out;

    let depth = 0;
    let i = first.index;
    const scan = new RegExp(`<${tag}\\b|</${tag}>`, 'g');
    scan.lastIndex = first.index;
    for (let m = scan.exec(out); m; m = scan.exec(out)) {
      depth += m[0].startsWith('</') ? -1 : 1;
      if (depth === 0) {
        i = m.index + m[0].length;
        break;
      }
    }
    // An unbalanced tag: drop from the open to the end rather than loop forever.
    out = out.slice(0, first.index) + out.slice(depth === 0 ? i : out.length);
  }
}

/** The prose one component puts on screen without anything being opened. */
export function proseIn(source: string): Prose {
  let body = source.split('</script>').pop() ?? source;
  body = body.split('<style').shift() ?? body;
  body = body.replace(/<!--[\s\S]*?-->/g, '');
  body = stripElement(body, 'Why');

  let total = 0;
  let paragraphs = 0;
  for (const tag of ['p', 'li']) {
    const block = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g');
    for (const m of body.matchAll(block)) {
      // Markup and `{...}` expressions are not words a person reads. The braces go first, so
      // that `{#if x}` disappears while the literal text inside the block does not.
      const text = m[1].replace(/\{[^{}]*\}/g, ' ').replace(/<[^>]+>/g, ' ');
      const n = words(text);
      if (n > 0) paragraphs += 1;
      total += n;
    }
  }
  return { words: total, paragraphs };
}
