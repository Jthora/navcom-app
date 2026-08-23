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
  let { children } = $props();

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
    saving.start();
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
  {#if saving.failure}
    <p class="saving-failed" role="status" data-storage-full>{saving.failure}</p>
  {/if}
  {@render children()}
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

  .terminal {
    display: flex;
    flex-direction: column;
    padding: 1.1rem 1.1rem 2rem;
    max-width: 30rem;
    margin: 0 auto;
    gap: 1.4rem;
  }
</style>
