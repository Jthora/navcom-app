<script lang="ts">
  /**
   * A state, named rather than described.
   *
   * Rules 1, 2 and 8. `DARK`, not "no watch is on station right now, and Distress will page
   * nobody" — the second one is true, and it is an explanation, and explanations live behind
   * `Why`.
   *
   * The word limit is checked here rather than trusted, and marked rather than thrown: a copy
   * edit must never take a screen down at 2am. A browser test asserts that no screen anywhere
   * renders a marked one, which is the same discipline as everything else in this project —
   * checked against the built artifact.
   *
   * ## `verbatim`, for a readout carrying somebody's name
   *
   * The uppercase is the terminal's register and it is right for a **state**: `DARK`, `ON
   * STATION`, `NO ADDRESSEE`. It is wrong for a **name**, because it does not merely restyle
   * one — it changes the letters.
   *
   * Found by rendering callsigns an operator can pick today. `straße` came back `STRASSE`,
   * seven letters where somebody typed six. `iyi` came back `IYI`, when the capital of a
   * Turkish `i` is `İ` and `I` is the capital of a different letter entirely. English is not
   * exempt: `McTavish` renders `MCTAVISH`.
   *
   * This is not really an internationalisation defect, which is why it survives the decision
   * not to translate the interface. NavCom holds no legal names and a callsign is the one
   * piece of identity a person chooses for themselves — so the terminal displaying something
   * other than what they typed is the wrong thing on its own terms.
   *
   * ## The mark beside the word
   *
   * Drawn from `tone`, which every call site already sets — so this adds no argument, no
   * decision at the call site, and **no translatable string**. `GLYPHS` in `panel.ts` carries
   * why these shapes and not a tick.
   *
   * Both shapes carry a stroke whether or not they are filled. Only the fill distinguishes
   * them, so a filled and a hollow mark occupy exactly the same space -- when the fill alone
   * was the difference and `stroke` was `none` on the filled ones, the four marks rendered at
   * three different sizes and the triangle read as the biggest thing in the panel.
   *
   * It is `aria-hidden` and it is an `<svg>`, both deliberately. The word is the accessible
   * name and the mark is a second rendering of it, so announcing it would make a screen reader
   * say everything twice. And an `<svg>` contributes nothing to `innerText` — eight browser
   * tests here read `body.innerText()` and assert on what an operator can see, so a mark drawn
   * with CSS `content:` would have quietly joined the text of every one of them.
   */
  import { glyphFor, isOverlong, type Tone } from '$lib/terminal/panel';

  let {
    value,
    tone = 'neutral',
    sub = null,
    verbatim = false
  }: {
    value: string;
    tone?: Tone;
    /** The qualifier that will not fit in five words. Still terse — not a sentence. */
    sub?: string | null;
    /**
     * Render the value exactly as it was given, with no case transform.
     *
     * For anything a person chose or an identifier that is compared by eye — a callsign, a
     * contact's name, an area, a commit. Never for a state word.
     */
    verbatim?: boolean;
  } = $props();

  const overlong = $derived(isOverlong(value));
  const mark = $derived(glyphFor(tone));
</script>

<span
  class="nc-readout"
  data-readout
  data-tone={tone}
  data-verbatim={verbatim ? 'true' : undefined}
  data-overlong={overlong ? 'true' : undefined}
  title={overlong ? 'This readout is longer than five words — it belongs in Why.' : undefined}
>{#if mark}<svg
    class="nc-readout-glyph"
    data-glyph={mark.shape}
    data-filled={mark.filled ? 'true' : 'false'}
    viewBox="0 0 16 16"
    aria-hidden="true"
    focusable="false"
  >{#if mark.shape === 'disc'}<circle
      cx="8"
      cy="8"
      r="4.7"
      fill={mark.filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      stroke-width="2"
    />{:else}<path
      d="M8 2.8 L14.2 13.2 L1.8 13.2 Z"
      fill={mark.filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      stroke-width="2"
      stroke-linejoin="round"
    />{/if}</svg>{/if}<span data-readout-value>{value}</span>{#if sub}<small class="nc-readout-sub">{sub}</small>{/if}</span>
