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
 * ## Why the script is shaped the way it is
 *
 * **Inline**, so it costs no request and cannot itself be the thing still downloading.
 * **Classic rather than a module**, so it is not deferred. **At the end of the body**, so
 * the markup it fills has already been parsed — and deliberately *not* on
 * `DOMContentLoaded`, which waits for deferred module scripts and would put it back behind
 * the very bundle it exists to get ahead of.
 *
 * It writes with DOM methods rather than `innerHTML`: the label is the operator's own text
 * on their own device, but building markup out of stored strings is a habit worth not
 * having.
 */

const BOOTSTRAP = `<script>
(function () {
  try {
    var raw = localStorage.getItem('navcom.accruing');
    if (!raw) return;
    var store = JSON.parse(raw);

    // Status: the way TO Distress, before the bundle arrives.
    //
    // The rest of this script solved being *on* the Distress screen early. Getting there was
    // still behind the bundle: the Distress action and the whole rail sit inside
    // \`{#if identity}\`, and identity is read from storage on mount, so for the first few
    // seconds Status offered two links -- the directory and setup. On the device floor that is
    // about three seconds, measured, and it is the screen somebody reaches for while something
    // is happening. Same trick, same file, a few hundred more bytes.
    var early = document.getElementById('distress-early');
    if (early && store.secret) early.hidden = false;

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

export const handle: Handle = async ({ event, resolve }) => {
  // Terminal only. The marker is removed everywhere else rather than left in place, so a
  // public page carries no trace of a script it is not allowed to have.
  const isTerminal = event.url.pathname.startsWith('/terminal');
  return resolve(event, {
    transformPageChunk: ({ html }) => html.replace(MARKER, isTerminal ? BOOTSTRAP : '')
  });
};
