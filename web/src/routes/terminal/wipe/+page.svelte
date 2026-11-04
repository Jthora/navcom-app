<script lang="ts">
  /**
   * Panic wipe and burn.
   *
   * Two destructive actions with opposite shapes, on purpose:
   *
   *  - **Panic wipe** must work in seconds with one thumb. It takes tonight and leaves the
   *    decade, so the cost of a mistaken wipe is an evening — cheap enough that speed wins.
   *  - **Burn** takes identity and standing and cannot be undone. It asks the operator to
   *    type their callsign, because the cost of a mistaken burn is everything they have
   *    built and nothing about the situation makes typing impossible.
   *
   * After a wipe this screen does not congratulate anyone. A terminal that says "4 items
   * destroyed" tells whoever is holding the phone that there was something to destroy.
   */
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { burnArmed, burnCaches, burnConfirmed, panicWipe, tierSizes, tierSummary } from '$lib/terminal/storage';
  import { destroyPool } from '$lib/terminal/pool';
  import { loadIdentity } from '$lib/terminal/identity';
  import { forgetPaging } from '$lib/terminal/paging';
  import { operator } from '$lib/terminal/session.svelte';
  import { board } from '$lib/terminal/board.svelte';

  import { Slot, Readout, Action } from '$lib/components/panel';

  let summary = $state<{ accruing: string[]; wipeable: string[] }>({ accruing: [], wipeable: [] });
  let callsign = $state<string | null>(null);
  let typed = $state('');
  /**
   * How much each tier is holding.
   *
   * `tierSizes` was written "for telling an operator what is taking the room before they have to
   * guess" and then reached from nothing, while the storage-full banner told them to clear
   * something without saying what was large. Bytes of stored text, not a count of anything
   * anybody did.
   */
  let sizes = $state({ accruing: 0, wipeable: 0 });

  /** Rounded hard: the number is for choosing between two tiers, not for auditing a device. */
  const room = (n: number): string => (n < 1024 ? `${n} B` : `${Math.round(n / 1024)} kB`);

  onMount(() => {
    summary = tierSummary();
    sizes = tierSizes();
    callsign = loadIdentity()?.callsign ?? null;
  });

  function fireWipe() {
    panicWipe();
    // Also stops a Distress still sending, the public listing and position -- see `forget`.
    operator.forget();
    // And a watch this phone holds goes quiet, decided 2026-10-07 [audit: relay paths, F10].
    board.forget();
    // Straight back to an ordinary-looking terminal. No receipt, no confirmation.
    goto('/terminal/');
  }

  async function doBurn() {
    // The gate is enforced in storage, not here — this button being disabled is a courtesy.
    if (!burnConfirmed(typed, callsign)) return;
    operator.forget();
    // Before the sockets go: a held watch's timers would otherwise reopen them afterwards.
    board.forget();
    // Every relay connection, not just the subscriptions. A burned device that is still
    // holding sockets open to relays is a live signal from a phone that is supposed to be
    // finished.
    destroyPool();
    // Awaited: an operator must not be shown a finished screen while bytes are still there.
    // burn() above already ran, synchronously and irreversibly -- a rejection here (found in
    // robustness audit: no concrete browser path found, but nothing here should assume one
    // never exists) must not leave a stale confirmation screen showing. No message either
    // way: this screen's whole point is to show nothing at all, on success or failure alike.
    try {
      // A burned phone that can still be woken for on-call is not finished. Found by audit on
      // 2026-09-13: burn cleared storage and caches and left the push subscription standing.
      // Bounded, because unsubscribing asks the push service and a phone with no signal must
      // not be left looking at a burn that has not finished.
      await Promise.race([forgetPaging(), new Promise((resolve) => setTimeout(resolve, 2000))]);
    } catch {
      // Deliberately silent. See above.
    }
    try {
      await burnCaches();
    } catch {
      // Deliberately silent. See above.
    }
    goto('/terminal/');
  }
</script>

<svelte:head>
  <title>Wipe · Field Terminal</title>
  <meta name="description" content="Destroy what is on this device." />
</svelte:head>

<header>
  <p class="eyebrow"><a href="/terminal/">← Status</a></p>
  <h1>Wipe</h1>
</header>

<!-- Named, not counted. A number tells an operator nothing about what they are losing. -->
<section class="holding">
  <h2>On this device now</h2>
  <p class="tier">
    <span class="tag wipe">tonight</span>
    {summary.wipeable.length ? summary.wipeable.join(' · ') : 'nothing'}
    <span class="room" data-room-wipeable>{room(sizes.wipeable)}</span>
  </p>
  <p class="tier">
    <span class="tag keep">kept</span>
    {summary.accruing.length ? summary.accruing.join(' · ') : 'nothing'}
    <span class="room" data-room-accruing>{room(sizes.accruing)}</span>
  </p>
</section>

<section class="act">
  <h2>Panic wipe</h2>
  <p>
    Destroys <strong>tonight</strong>. Keeps your profile, your standing and the person you
    would call.
  </p>
  <!--
    The cost of stopping what is still sending, said before the hold rather than after: a wipe
    that left a Distress running kept transmitting from a phone its owner believed was quiet.
    "This tab", because another tab's Distress or held watch is the owner's to decide
    [wipe-two-tabs.spec.ts], and until it is, the sentence must not promise it.
  -->
  <p class="cost" data-wipe-stops>
    <strong>Also stops anything this tab is still sending</strong>, a Distress included.
  </p>
  <Action label="Hold to wipe tonight" holdingLabel="Keep holding…" hold={800} tone="alarm" onfire={fireWipe} />
</section>

<section class="act burnsec">
  <h2>Burn</h2>
  <p>
    Destroys <strong>everything on this device, your profile included</strong>. There is no
    recovery without a backup.
  </p>
  {#if callsign}
    <label for="confirm" class="confirm">Type <strong>{callsign}</strong> to confirm</label>
    <input id="confirm" bind:value={typed} autocomplete="off" spellcheck="false" />
    <!--
      Asked of `storage.ts`, never re-derived here. The raw comparison this replaces ignored the
      NFC normalisation the gate itself applies, so a callsign with combining characters left the
      button disabled forever while the gate behind it would have opened.
    -->
    <button class="danger burn" disabled={!burnArmed(typed, callsign)} onclick={doBurn}>
      Burn this device
    </button>
  {:else}
    <Slot k="Identity"><Readout value="None" tone="cold" sub="no identity on this device" /></Slot>
    <!--
      It said "nothing to burn", which was not true: cached pages and tonight's data can be here
      with no identity, and burn refuses to run without one. The browser can remove them.
    -->
    <p class="cost">Burn needs a profile. Clear this site's data in the browser instead.</p>
  {/if}
</section>

<style>
  .room { color: var(--t-faint); font-variant-numeric: tabular-nums; margin-inline-start: .4rem; }
  .holding { border: 2px solid var(--t-line-strong); padding: .9rem 1rem; gap: .4rem; }
  .tier { margin: 0; display: flex; gap: .6rem; align-items: baseline; flex-wrap: wrap;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9rem; }
  .tag {
    font-size: .66rem; letter-spacing: .1em; text-transform: uppercase;
    border: 1px solid var(--t-line-strong); padding: .1rem .4rem;
  }
  .tag.wipe { color: var(--t-dark); border-color: var(--t-dark); }
  .tag.keep { color: var(--t-station); border-color: var(--t-station); }

  .act { gap: .6rem; }
  .danger {
    position: relative; overflow: hidden; width: 100%;
    border-color: var(--t-dark); color: var(--t-dark); background: var(--t-sunk);
    touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
  }
  .danger::before {
    content: ''; position: absolute; inset: 0 auto 0 0; width: var(--fill, 0%);
    background: var(--t-dark); opacity: .28;
  }
  /* Burn is typed, not held: no fill, and it stays inert until the callsign matches. */
  .burn::before { content: none; }

  .burnsec { border-top: 1px solid var(--t-line); padding-top: 1.1rem; }
  /* The callsign as typed, which may be one long word: it breaks rather than push the hold off the screen. */
  .confirm strong { overflow-wrap: anywhere; }
</style>
