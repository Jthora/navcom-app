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
  import { burnCaches, burnConfirmed, panicWipe, tierSummary } from '$lib/terminal/storage';
  import { destroyPool } from '$lib/terminal/pool';
  import { loadIdentity } from '$lib/terminal/identity';
  import { operator } from '$lib/terminal/session.svelte';

  import { Slot, Readout } from '$lib/components/panel';
  const HOLD_MS = 800;

  let summary = $state<{ accruing: string[]; wipeable: string[] }>({ accruing: [], wipeable: [] });
  let callsign = $state<string | null>(null);
  let typed = $state('');
  let holding = $state(false);
  let progress = $state(0);
  let start: number | null = null;
  let frame: number | null = null;

  onMount(() => {
    summary = tierSummary();
    callsign = loadIdentity()?.callsign ?? null;
    return () => { if (frame !== null) cancelAnimationFrame(frame); };
  });

  /*
   * The fill is animation; the firing is a timer. `requestAnimationFrame` is throttled hard,
   * or paused outright, in a backgrounded or power-saving page — so a hold driven by frames
   * can fail to complete on exactly the phone this is written for.
   */
  let doneAt: ReturnType<typeof setTimeout> | null = null;

  function tick() {
    if (start === null) return;
    progress = Math.min((Date.now() - start) / HOLD_MS, 1);
    frame = requestAnimationFrame(tick);
  }

  function press() {
    holding = true;
    start = Date.now();
    frame = requestAnimationFrame(tick);
    doneAt = setTimeout(() => release(true), HOLD_MS);
  }

  function release(complete = false) {
    if (frame !== null) cancelAnimationFrame(frame);
    if (doneAt !== null) clearTimeout(doneAt);
    doneAt = null;
    frame = null;
    start = null;
    holding = false;
    progress = 0;
    if (!complete) return;
    panicWipe();
    operator.forget();
    // Straight back to an ordinary-looking terminal. No receipt, no confirmation.
    goto('/terminal/');
  }

  async function doBurn() {
    // The gate is enforced in storage, not here — this button being disabled is a courtesy.
    if (!burnConfirmed(typed, callsign)) return;
    operator.forget();
    // Every relay connection, not just the subscriptions. A burned device that is still
    // holding sockets open to relays is a live signal from a phone that is supposed to be
    // finished.
    destroyPool();
    // Awaited: an operator must not be shown a finished screen while bytes are still there.
    await burnCaches();
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
  </p>
  <p class="tier">
    <span class="tag keep">kept</span>
    {summary.accruing.length ? summary.accruing.join(' · ') : 'nothing'}
  </p>
</section>

<section class="act">
  <h2>Panic wipe</h2>
  <p>
    Destroys <strong>tonight</strong> and keeps your identity, your standing and the person
    you would call. You can carry on working straight afterwards — nobody has to
    re-provision you, and your safety net is still there the next night.
  </p>
  <button
    class="danger"
    style="--fill: {progress * 100}%"
    onpointerdown={press}
    onpointerup={() => release()}
    onpointerleave={() => release()}
    onpointercancel={() => release()}
  >
    <span>{holding ? 'Keep holding…' : 'Hold to wipe tonight'}</span>
  </button>
</section>

<!-- The limits, stated. An operator who believes a wipe is total is worse off than one who
     knows exactly where it stops. -->
<section class="limits">
  <h2>What this does not reach</h2>
  <p>
    <strong>The watch still has your board entry.</strong> This wipes the phone, not the
    watch. That entry is held in memory on the box and expires on its own; wiping here sends
    nothing and tells nobody.
  </p>
  <p>
    <strong>The accountability log is outside both tiers.</strong> It lives on the node and
    records actions, never positions. It is what makes the watch answerable to you, so it is
    not yours to delete.
  </p>
  <p class="cost">
    And two limits of the browser itself: there is no OS keystore here, so the secret sits in
    storage any script on this origin could read; and deleting a key unlinks it rather than
    scrubbing the pages underneath. Your browser history and this site's address survive
    both actions. A phone taken by someone patient and equipped is a phone taken.
  </p>
</section>

<section class="act burnsec">
  <h2>Burn</h2>
  <p>
    Destroys <strong>everything on this device, identity included</strong> — both storage
    tiers and the offline caches, so the cached directory goes too. Your standing goes with
    it and there is no recovery unless you set one up. For seizure or compulsion, not for a
    phone that might be glanced at.
  </p>
  {#if callsign}
    <label for="confirm">Type <strong>{callsign}</strong> to confirm</label>
    <input id="confirm" bind:value={typed} autocomplete="off" spellcheck="false" />
    <button class="danger burn" disabled={typed.trim() !== callsign} onclick={doBurn}>
      Burn this device
    </button>
  {:else}
    <Slot k="Identity"><Readout value="None" tone="cold" sub="nothing here to burn" /></Slot>
    <p class="cost">No identity on this device, so there is nothing to burn.</p>
  {/if}
</section>

<style>
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
    touch-action: none; user-select: none;
  }
  .danger::before {
    content: ''; position: absolute; inset: 0 auto 0 0; width: var(--fill, 0%);
    background: var(--t-dark); opacity: .28;
  }
  .danger span { position: relative; }
  /* Burn is typed, not held: no fill, and it stays inert until the callsign matches. */
  .burn::before { content: none; }

  .limits { border-inline-start: 3px solid var(--t-line-strong); padding-inline-start: .9rem; }
  .burnsec { border-top: 1px solid var(--t-line); padding-top: 1.1rem; }
</style>
