import type { Handle } from '@sveltejs/kit';

/**
 * The one script that runs before the application does — and only where it is allowed to.
 *
 * ## What it is for
 *
 * Every terminal screen is prerendered, so it is readable in about half a second. Its
 * controls are wired by a bundle that takes three seconds on a congested cell and ten on a
 * throttled plan (measured — `docs/research/device-floor.md`). For most screens that gap is
 * an inconvenience. On `Distress` it meant the page said *"Hold to send"* and holding did
 * nothing, with no working `tel:` link either, because the operator's own contact is read
 * from `localStorage` like everything else.
 *
 * This closes the gap for the part that matters: the person they would call.
 *
 * ## Why it lives in a hook rather than in `app.html`
 *
 * `app.html` is the shell for **every** page, and the public site has a hard invariant of
 * **zero JavaScript** — a reader with scripting off, an old phone, or a proxy in front of
 * them still gets the directory. Putting this in the shell broke that immediately, and
 * `rendered.test.ts` caught it: a script tag on a public page is a failure whatever the
 * script does.
 *
 * So the shell stays universal and this is injected per route. The public site keeps its
 * zero and the terminal gets its bootstrap.
 *
 * ## Why the scripts are shaped the way they are
 *
 * **Inline**, so they cost no request and cannot themselves be the thing still downloading.
 * **Classic rather than modules**, so they are not deferred, and deliberately *not* on
 * `DOMContentLoaded`, which waits for deferred module scripts and would put them back behind
 * the very bundle they exist to get ahead of.
 *
 * **Each runs where its markup is parsed.** The bootstrap fills the Distress page's links, so
 * it ends the body, after that markup. The reveal is not in it: it sits inside the control it
 * shows [REVEAL]. It used to end the body too, and the landing page is 158 kB, the region
 * picker's 1,913 options before its end. On a slow connection the browser paints what has
 * arrived, so the map and the search were on screen for 2.4 s at the budget's design point with
 * no Distress on them [invariant 2; e2e/distress-before-hydration.spec.ts].
 *
 * The bootstrap writes with DOM methods rather than `innerHTML`: the label is the operator's own
 * text on their own device, but building markup out of stored strings is a habit worth not
 * having.
 */

const BOOTSTRAP = `<script>
(function () {
  try {
    var raw = localStorage.getItem('navcom.accruing');
    if (!raw) return;
    var store = JSON.parse(raw);
    var slot = document.getElementById('reach-now');
    var section = document.getElementById('reach-early');
    if (!slot || !section) return;
    var c = store.emergency_contact;
    if (!c || !c.number) return;
    var name = String(c.label || 'them');
    var link = function (href, text) {
      var a = document.createElement('a');
      a.className = 'action urgent';
      a.href = href;
      a.textContent = text;
      return a;
    };
    slot.appendChild(link('sms:' + c.number, 'Text ' + name));
    slot.appendChild(link('tel:' + c.number, 'Call ' + name));
    section.hidden = false;
  } catch (e) {
    /* No storage, or storage this version does not understand. Say nothing and let the
       application render it a moment later — a broken fallback must not also break the
       page it is standing in front of. */
  }
})();
</script>`;

const MARKER = '<!--navcom-bootstrap-->';

/**
 * The way TO Distress, before the bundle arrives: shows the prerendered `#distress-early` on a
 * device with an operator, and nowhere else.
 *
 * The bootstrap solved being *on* the Distress screen early. Getting there was still behind the
 * bundle: the terminal's Distress action sits inside `{#if identity}`, and identity is read from
 * storage on mount, so for the first few seconds Status offered two links, the directory and setup.
 * The landing page's Distress layer is revealed on mount the same way [com.md §4].
 *
 * **Inside the element, as its last child**, so it runs the moment the control is parsed and not
 * when the document ends. Hydration never walks it: both pages' copies are static markup, which
 * Svelte claims whole and does not descend into. Any storage it cannot read leaves the control
 * hidden, and the application shows it a moment later if it should.
 */
const REVEAL =
  "<script>try{if(JSON.parse(localStorage.getItem('navcom.accruing')).secret)document.getElementById('distress-early').hidden=false}catch(e){}</script>";
/** The prerendered early copy through its own closing tag: a section on `/`, a div on `/terminal/`. */
const EARLY = /(<(section|div)\b[^>]*\bid="distress-early"[^>]*>[\s\S]*?)(<\/\2>)/;

export const handle: Handle = async ({ event, resolve }) => {
  /*
   * The reveal goes wherever a page carries the early copy: the terminal, and the landing page,
   * which joined on 2026-10-06 when Com moved onto it, because Com carries Distress for an
   * operator in a layer nothing covers [com.md §4]. The root already ships script, so it has no
   * zero-JavaScript promise to break. The bootstrap goes to the terminal only, where the
   * Distress page it fills is.
   *
   * The marker is removed everywhere else rather than left in place, so a public page carries
   * no trace of a script it is not allowed to have.
   */
  const path = event.url.pathname;
  const terminal = path.startsWith('/terminal');
  const reveals = terminal || path === '/';
  return resolve(event, {
    transformPageChunk: ({ html }) => {
      const page = html.replace(MARKER, terminal ? BOOTSTRAP : '');
      return reveals ? page.replace(EARLY, (_, open: string, _tag, close: string) => open + REVEAL + close) : page;
    }
  });
};
