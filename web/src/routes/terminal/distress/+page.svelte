<script lang="ts">
  /**
   * Distress.
   *
   * Three rules shape this screen and none of them are negotiable:
   *
   *  - It is **always deliberate** [invariant 3]. Nothing here fires on a timer, a missed
   *    window or inactivity, which is why sending is a hold rather than a tap.
   *  - It **terminates in a human, or says it could not** [invariant 2]. Every attempt is
   *    on screen, including the ones that never left the phone.
   *  - An agent is **never the sole responder** [invariant 5]. An agent answering is shown
   *    as "getting through", not as help.
   */
  import { onDestroy } from 'svelte';
  import { operator } from '$lib/terminal/session.svelte';
  import { Slot, Elapsed } from '$lib/components/panel';
  import {
    callLink,
    distressMessage,
    loadContact,
    smsLink,
    type EmergencyContact
  } from '$lib/terminal/contact';
  import { onMount } from 'svelte';

  const HOLD_MS = 1200;

  let text = $state('');
  let holdStart = $state<number | null>(null);
  let progress = $state(0);
  let frame: number | null = null;
  /**
   * Whether there is anywhere to send this.
   *
   * Read after mount, and it never gates the button. A prerendered page must render some
   * default, and both are wrong: defaulting to "armed" briefly promises what it cannot do,
   * and defaulting to "disarmed" briefly refuses a real emergency during hydration. Letting
   * the press always register removes the choice — the operator's action is never swallowed,
   * and what actually happened is reported the instant they let go.
   */
  let hasWatch = $state(true);
  let contact = $state<EmergencyContact | null>(null);
  let callsign = $state<string | null>(null);

  onMount(() => {
    hasWatch = operator.hasWatch;
    contact = loadContact();
    // The early block has done its job. Svelte's version carries the written message and
    // the full wording; leaving both would show the same person twice.
    document.getElementById('reach-early')?.remove();
    callsign = operator.callsign;
  });

  /**
   * Rebuilt on every render rather than captured once, so the time in the message is the
   * time they tapped rather than the time the screen opened.
   */
  const personalMessage = $derived(
    distressMessage({ callsign, area: operator.session?.area ?? null, at: new Date() })
  );

  const phases = $derived(operator.distress);
  const acknowledged = $derived(
    phases.find((p) => p.phase === 'acknowledged') as
      | Extract<(typeof phases)[number], { phase: 'acknowledged' }>
      | undefined
  );

  /**
   * The device worked out that nobody is coming.
   *
   * This does not mean the sending stopped — it has not, and only the operator can stop it.
   * It means enough time has passed that a working watch would already have said so, and
   * the phone is the only thing left able to tell the operator that.
   */
  const nobodyAnswering = $derived(phases.some((p) => p.phase === 'nobody-answering'));

  function tick() {
    if (holdStart === null) return;
    progress = Math.min((Date.now() - holdStart) / HOLD_MS, 1);
    if (progress >= 1) {
      release(true);
      return;
    }
    frame = requestAnimationFrame(tick);
  }

  function press() {
    if (operator.distressRunning) return;
    holdStart = Date.now();
    frame = requestAnimationFrame(tick);
  }

  function release(complete = false) {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    holdStart = null;
    progress = 0;
    if (complete) operator.raiseDistress(text.trim());
  }

  onDestroy(() => {
    if (frame !== null) cancelAnimationFrame(frame);
    // Deliberately does NOT cancel a running Distress. Navigating away is not standing down,
    // and the send outlives this screen.
  });

  function describe(p: (typeof phases)[number]): string {
    switch (p.phase) {
      case 'sending': return `Attempt ${p.attempt} — sending`;
      case 'sent': return `Attempt ${p.attempt} — left the phone`;
      case 'unreachable': return `Attempt ${p.attempt} — never left the phone: ${p.error}`;
      case 'no-answer': return `Attempt ${p.attempt} — sent, no answer`;
      case 'agent-holding': return `Attempt ${p.attempt} — an agent answered. Still looking for a human`;
      case 'nobody-answering':
        return `${Math.round(p.elapsedMs / 60000)} minutes, no human. Still sending`;
      case 'acknowledged': return `${p.response.responder?.callsign ?? 'A human'} has it`;
    }
  }
</script>

<svelte:head>
  <title>Distress · Field Terminal</title>
  <meta name="description" content="Raise distress." />
</svelte:head>

<header>
  <p class="eyebrow"><a href="/terminal/">← Status</a></p>
  <h1>Distress</h1>
</header>

<!--
  Filled by the inline script in app.html, before the bundle arrives, and removed by
  `onMount` below once Svelte's own version is on the screen. Deliberately outside every
  `{#if}`: it has to be in the prerendered HTML, because the whole point is that it works
  when nothing has run yet.

  Two copies never show at once -- this one is `hidden` until the script finds a contact, and
  gone by the time the app can render its own.
-->
<section class="person" id="reach-early" hidden>
  <h2>Your person</h2>
  <div class="reach" id="reach-now"></div>
  <p class="cost">
    Opens your messages. <strong>You have to press send</strong> — a web app cannot do that
    for you.
  </p>
</section>

{#if contact}
  <!--
    First on the screen, always. For an operator with no watch this is the entire safety
    net, and for one with a watch it is still the fastest thing on the page — a person who
    already knows them, reachable in one tap, while the ladder does whatever it can.
  -->
  <section class="person" data-contact>
    <h2>Your person</h2>
    <div class="reach">
      <a class="action urgent" href={smsLink(contact, personalMessage)}>Text {contact.label}</a>
      <a class="action urgent" href={callLink(contact)}>Call {contact.label}</a>
    </div>
    <p class="cost">
      Opens your messages with it written. <strong>You have to press send</strong> — a web
      app cannot do that for you, and pretending otherwise would be the worst lie in here.
    </p>
  </section>
{/if}

{#if !hasWatch}
  <!-- Said before the button as well as after, because reading it first is better than
       finding out by holding it. The button still works: see the note on `hasWatch`. -->
  <section data-no-watch>
    <p class="error">
      <strong>There is nowhere to send this.</strong> Distress goes to a watch and you have
      not added one, so holding the button would raise nobody.
    </p>
    {#if !contact}
      <p class="cost">
        Nothing on this phone can reach anyone for you.
        <a href="/terminal/setup/">Add someone you would call</a> — it takes a name and a
        number, stays on this phone, and is the only thing that helps when there is no watch.
      </p>
    {/if}
  </section>
{/if}

{#if !operator.distressRunning && phases.length === 0}
  <section>
    <p>
      This wakes people up. It keeps sending until a human answers — <strong>not an
      agent</strong> — and only you can stop it.
    </p>
    <p class="cost">
      Calling your own person <strong>works before the rest of this screen does</strong>, and
      with no signal at all. Everything below needs the app to have finished loading; a phone
      call does not.
    </p>
    <label for="d">Anything you can say <span class="opt">optional</span></label>
    <textarea id="d" bind:value={text} placeholder="two of them, heading east"></textarea>
  </section>

  <!-- A hold rather than a tap: fast enough under stress, hard to do by accident in a pocket. -->
  <button
    class="raise"
    style="--fill: {progress * 100}%"
    onpointerdown={press}
    onpointerup={() => release()}
    onpointerleave={() => release()}
    onpointercancel={() => release()}
  >
    <span>{progress > 0 ? 'Keep holding…' : 'Hold to send'}</span>
  </button>
{/if}

{#if phases.length > 0}
  <section
    class="live nc-panel"
    class:acked={!!acknowledged}
    data-distress={acknowledged ? 'acknowledged' : operator.distressRunning ? 'running' : 'stopped'}
  >
    <header class="nc-panel-head">
      <h2 class="nc-panel-label">Distress</h2>
      <span class="nc-panel-post">
        {acknowledged ? 'Answered' : operator.distressRunning ? 'Sending' : 'Stopped'}
      </span>
    </header>
    <div class="nc-panel-slots">
      {#if operator.distressRaisedAt !== null}
        <!--
          The one readout this screen never had: how long this has been going.

          It climbs and never arrives, because `RESPONSE_WINDOW.distress` is null — a Distress
          has no window and does not expire. A bar that emptied would say the signal resolves
          itself, and a Distress that appears to resolve itself is the silent failure
          invariant 2 exists to forbid. Nothing closes this except a person.
        -->
        <Slot k="Running">
          <Elapsed since={Math.floor(operator.distressRaisedAt / 1000)} label="Raised" />
        </Slot>
      {/if}
      <ol>
        {#each phases as p, i (i)}
          <li class={p.phase}>{describe(p)}</li>
        {/each}
      </ol>
    </div>
  </section>

  <!--
    Above the attempt list and above the stand-down control, because it is the only thing on
    this screen that changes what the operator should do next.
  -->
  {#if nobodyAnswering && !acknowledged}
    <section class="nobody" data-nobody-answering>
      <h2>Nobody is coming</h2>
      <p>
        Long enough has passed that a working watch would have answered or told you it
        couldn't. <strong>Assume no one is on their way</strong> and act on that.
      </p>
      <p class="cost">
        This phone worked that out on its own — it is not a message from the watch, and it
        does not mean the sending stopped. It hasn't. Only you can stop it.
      </p>
    </section>
  {/if}

  {#if acknowledged}
    <section class="answered">
      <p><strong>{acknowledged.response.responder?.callsign ?? 'A human'}</strong> has it.</p>
      {#if acknowledged.response.text}<p>{acknowledged.response.text}</p>{/if}
    </section>
  {:else if operator.distressRunning}
    <section>
      <p class="cost">
        Still going. It will not stop on its own — if nothing is answering, that is what the
        list above is telling you, and it is worth acting on directly.
      </p>
      <button class="stand-down" onclick={() => operator.standDownDistress()}>
        Stand down — I am safe
      </button>
    </section>
  {:else}
    <section>
      <p class="error" data-stopped>
        <strong>Stopped without a human.</strong> Nobody acknowledged this. Nothing is
        still trying.
      </p>
      <button class="raise small" onclick={() => operator.raiseDistress(text.trim())}>
        Send again
      </button>
    </section>
  {/if}
{/if}

{#if operator.error}
  <p class="error">{operator.error}</p>
{/if}

<style>
  .opt { color: var(--t-faint); font-size: .8rem; }
  textarea { margin-top: .4rem; }

  .raise {
    position: relative; overflow: hidden;
    min-height: 6rem; font-size: 1.3rem; letter-spacing: .04em;
    border-color: var(--t-dark); color: var(--t-dark); background: var(--t-sunk);
    text-transform: uppercase; touch-action: none; user-select: none;
  }
  .raise.small { min-height: 3.5rem; font-size: 1.05rem; }
  /* Fills as the hold completes, so the operator can see how much longer to press. */
  .raise::before {
    content: ''; position: absolute; inset: 0 auto 0 0; width: var(--fill, 0%);
    background: var(--t-dark); opacity: .28;
  }
  .raise span { position: relative; }

  .live { border: 2px solid var(--t-dark); padding: 1rem; }
  .live.acked { border-color: var(--t-station); }
  ol {
    list-style: none; margin: 0; padding: 0;
    display: flex; flex-direction: column; gap: .35rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .88rem;
    color: var(--t-muted); line-height: 1.4;
  }
  li.unreachable { color: var(--t-dark); }
  li.agent-holding { color: var(--t-oncall); }
  li.nobody-answering { color: var(--t-dark); font-weight: 650; }

  .person { border: 2px solid var(--t-station); background: var(--t-raised); padding: 1rem 1.1rem; }
  .person h2 { color: var(--t-station); }
  .reach { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; margin-bottom: .6rem; }
  .reach :global(.action) { width: 100%; }
  .urgent { border-color: var(--t-station); color: var(--t-station); }

  .nobody { border: 2px solid var(--t-dark); background: var(--t-sunk); padding: 1rem 1.1rem; }
  .nobody h2 { color: var(--t-dark); font-size: 1.1rem; letter-spacing: .02em; }
  li.acknowledged { color: var(--t-station); font-size: 1rem; }

  .answered p { color: var(--t-ink); font-size: 1.1rem; }
  .stand-down { margin-top: .6rem; width: 100%; }
</style>
