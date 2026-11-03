<script lang="ts">
  /**
   * `@` resets the layout chain to the root, so the terminal does not inherit the site's
   * header, navigation or stylesheet.
   *
   * Not cosmetic. The Field Terminal is a different instrument for the opposite situation —
   * one hand, cold, dark — and a nav bar offering "Docs" is both wrong for that moment and
   * dead weight in a bundle sized for a prepaid Android 8.
   */
  import { onMount } from 'svelte';
  import '$lib/terminal/tokens.css';
  import '$lib/terminal/screen.css';
  import '$lib/terminal/panel.css';
  import { saving } from '$lib/terminal/saving.svelte';
  import { page } from '$app/state';
  import { notice } from '$lib/terminal/notice.svelte';
  import { overdue } from '$lib/terminal/overdue.svelte';
  import { get } from '$lib/terminal/storage';
  import { loadConfig } from '$lib/terminal/config';
  import { apply, setSignature, signature } from '$lib/terminal/signature';
  // Every terminal page hears a wipe or a burn in another tab, or one it slept through in the
  // back-forward cache, and lets go of tonight as the wiping page did [invariant 5].
  import '$lib/terminal/wiped-elsewhere';
  let { children } = $props();
  let sig = $state<'low' | 'document'>('document');

  /**
   * Marks the terminal as interactive.
   *
   * Every screen here is prerendered, so it is on the glass and tappable before its
   * JavaScript has run. That window is real on a prepaid Android 8, and it is where a tap
   * lands on a control that is drawn but not yet wired.
   *
   * The browser tests wait for this rather than racing it. They were racing it — several
   * specs failed intermittently under load, always as "the button did nothing", and each
   * one looked like a bug in whichever screen happened to lose. A test that waits for the
   * app to actually be interactive is testing the app; one that clicks a picture of a
   * button is testing nothing and failing at random.
   */
  onMount(() => {
    /**
     * A phone that cannot save has to say so on whatever screen the operator is looking at.
     *
     * It lives here rather than on each screen because every screen writes and none of them
     * checked — the failure is silent by construction, so the report cannot be opt-in.
     */
    /*
     * Applied before anything else on mount, so a device set to low signature never shows a
     * frame at full brightness. On a dark street that flash is the whole thing it avoids.
     */
    sig = signature();
    apply(sig);
    saving.start();
    /*
     * Signed on to a watch, this phone hears what it sends unasked on every screen [session
     * `signOn`], and a phone reloaded on any screen but Status did not until Status was opened: a
     * notice about a police line went unseen by somebody reading the directory (2026-11-02). Read
     * from tonight's sign-on itself, so the session's code stays out of every screen's first load.
     */
    if (get('wipeable', 'signon') !== null && loadConfig() !== null) overdue.start();
    document.documentElement.dataset.hydrated = 'true';
    return () => saving.stop();
  });
</script>

<svelte:head>
  <meta name="theme-color" content="#0B0E12" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <!-- iOS ignores the manifest's icons for Add to Home Screen and uses this instead.
       Without it the home screen gets a screenshot of the page. -->
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
</svelte:head>

<div class="terminal">
  <!--
    A first automated accessibility pass (axe-core) against this app, run this session,
    found every screen's content sitting outside any landmark region — nothing here was ever
    checked this way before. `<main>` is the minimal fix, not a redesign.
  -->
  <main>
    {#if saving.failure}
      <p class="saving-failed" role="status" data-storage-full>{saving.failure}</p>
    {/if}
    {@render children()}

    <!--
      On every screen, because a mode you can only reach from one page is a mode nobody finds
      at 2am — and because reading a directory record properly is a different job from
      watching a board, so getting back to document mode has to be one tap from wherever you
      are.
    -->
    <!--
      An action, not a state — and it must not claim to be both.

      This carried `aria-pressed={sig === 'low'}` while the label named the *destination*, so
      at rest in low signature a screen reader announced "DOCUMENT, toggle button, pressed":
      the label said one mode, the state said the other, and the two together said document
      mode was on when it was not. Both halves were individually valid, which is exactly why
      axe could not see it.

      Resolved toward the action, because the label naming where a tap goes is the deliberate
      choice recorded above — getting back to document mode has to be one tap from wherever
      you are. So the pressed state goes, and the accessible name says the whole thing rather
      than half of it. A button that only performs makes no claim about state to contradict.
    -->
    <button
      class="signature"
      data-signature-toggle
      aria-label={sig === 'low' ? 'Switch to document mode' : 'Switch to low signature'}
      onclick={() => {
        sig = sig === 'low' ? 'document' : 'low';
        setSignature(sig);
      }}
    >{sig === 'low' ? 'Document' : 'Low signature'}</button>

    <!--
      What the watch told everybody out, on every screen but Status, which shows it whole. Fixed in
      the strip the toggle already keeps clear at the foot of every screen, so arriving moves nothing
      under a thumb on its way to Distress. Silent: it is looked at, never announced.
    -->
    {#if notice.text && page.url.pathname !== '/terminal/'}
      <a class="watch-notice" href="/terminal/" data-notice-line>
        <span class="from">{notice.by ?? 'Watch'}</span><span class="said">{notice.text}</span>
      </a>
    {/if}
  </main>
</div>

<style>
  /* Stated plainly and kept out of the way. Nothing here is an alarm — the operator is
     mid-task, and this tells them one true thing about the phone. */
  .saving-failed {
    margin: 0;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--edge);
    border-inline-start: 3px solid var(--warn, var(--edge));
    background: var(--raised, transparent);
    font-size: 0.85rem;
    line-height: 1.4;
  }

  .watch-notice {
    position: fixed;
    inset-block-end: 0.5rem;
    inset-inline-start: 0.5rem;
    /* Clear of the signature toggle at the other end of the strip. */
    inset-inline-end: 8.5rem;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.75rem;
    padding: 0 0.7rem;
    font-size: 0.8rem;
    color: var(--t-ink);
    text-decoration: none;
    background: var(--t-raised);
    border: 1px solid var(--t-line);
    border-inline-start: 3px solid var(--t-station);
  }
  .watch-notice .said {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .watch-notice .from {
    flex: none;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--t-muted);
  }

  .terminal {
    /*
     * The bottom padding clears the fixed signature toggle, and that is what the number is.
     *
     * The toggle sits `inset-block-end: 0.5rem` and is `min-height: 2.75rem`, so it occupies
     * the viewport from 0.5rem to 3.25rem up. At 2rem of padding the last control on a page
     * came to rest underneath it: measured across twenty screens, ten of them clipped their
     * final button by 7% of its area with nowhere left to scroll.
     *
     * Never a centre — which is why the existing guard, written after a compact Add button
     * landed fully under the toggle, passed on all ten. It asserts the centre because that is
     * where a thumb goes, and it was right about that; a corner is a different defect and
     * needed a different measurement.
     *
     * 4rem is 3.25 plus clearance, so a control can always scroll above it.
     */
    padding: 1.1rem 1.1rem 4rem;
    max-width: 30rem;
    margin: 0 auto;
  }

  /* The flex/gap arrangement moved here with the new `<main>` wrapper — `.terminal` now
     sizes and centers the column, `main` arranges what's actually in it. Same result. */
  .terminal main {
    display: flex;
    flex-direction: column;
    gap: 1.4rem;
  }
</style>
