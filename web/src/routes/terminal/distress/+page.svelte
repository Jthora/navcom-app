<script lang="ts">
  /**
   * Distress.
   *
   * Three rules shape this screen and none of them are negotiable:
   *
   *  - It is **always deliberate** [invariant 3]. Nothing here fires on a timer, a missed
   *    window or inactivity, which is why sending is a hold rather than a tap.
   *  - It **terminates in a human, or says it could not** [invariant 2]. Every attempt is
   *    on screen, including the ones that never left the phone — and when the watch says
   *    nobody can be reached, that is shown the moment it arrives, in the watch's own words.
   *  - An agent is **never the sole responder** [invariant 5]. An agent answering is shown
   *    as "getting through", not as help. The watch's own escalation ladder is neither a
   *    person nor an agent, and is shown as the watch.
   */
  import { onDestroy } from 'svelte';
  import { operator } from '$lib/terminal/session.svelte';
  import { pulse } from '$lib/terminal/haptic';
  import { Slot, Elapsed, Why } from '$lib/components/panel';
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
  /** Added, and unreachable from this page: not the same thing as never added. */
  let stranded = $state(false);
  let contact = $state<EmergencyContact | null>(null);
  let callsign = $state<string | null>(null);

  onMount(() => {
    hasWatch = operator.hasWatch;
    stranded = operator.watchStranded;
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
   * A person answered an **earlier** Distress from this operator — not this one [#0].
   *
   * The watch holds a person's answer for a while and repeats it to a new Distress from the same
   * phone. A run that started after that answer — the app reopened or the phone wiped once that
   * ladder was over, or a new emergency — never sent, or joined, the one they answered. It used to
   * close this run under "Answered" and "Wren has it", though the watch had not escalated this
   * Distress. Shown as what it is, by name and in the watch's words, with the sending still going:
   * only a person answering this one ends it. The latest, because the watch's words say how long
   * ago. (A run started while that ladder was still paging is told it joined it, and ends on the
   * person's answer as its own — core's `sendDistressUntilAcknowledged`.)
   */
  const earlier = $derived.by(() => {
    for (let i = phases.length - 1; i >= 0; i--) {
      const p = phases[i];
      if (p.phase === 'acknowledged-earlier') return p;
    }
    return undefined;
  });

  /**
   * The watch said nobody can be reached — and once it has, that stays said.
   *
   * The ladder's own word, shown when it arrives. Until this existed it was filed under "an
   * agent answered" with its text thrown away, and an operator with nobody on call was told
   * something was still happening for ten minutes.
   *
   * It used to go by the latest report, so a fresh ladder paging again hid it. The phone now
   * sends again as soon as a ladder runs out, so the next ladder's "Paging Wren." arrives within
   * a second and took the panel with it. A watch that has already failed to raise anyone for one
   * whole ladder has not made anybody more likely to come by trying again; the list below says it
   * is trying.
   */
  const watchSaidNobody = $derived.by(() => {
    for (let i = phases.length - 1; i >= 0; i--) {
      const p = phases[i];
      if (p.phase === 'watch-exhausted') return p;
    }
    return undefined;
  });

  /**
   * The device worked out that nobody is coming.
   *
   * This does not mean the sending stopped — it has not, and only the operator can stop it.
   * It means enough time has passed that a working watch would already have said so, and
   * the phone is the only thing left able to tell the operator that.
   */
  const nobodyAnswering = $derived(phases.some((p) => p.phase === 'nobody-answering'));

  /**
   * Words from the watch, bounded.
   *
   * Anybody holding the watch key can put text here, and this is the screen nobody reads
   * calmly. Long enough for every sentence the ladder actually sends; short enough that a
   * paragraph cannot push the stand-down control off the screen.
   */
  const WATCH_TEXT_MAX = 280;
  const clip = (s: string | null | undefined): string | null =>
    s ? (s.length > WATCH_TEXT_MAX ? `${s.slice(0, WATCH_TEXT_MAX - 1)}…` : s) : null;

  /*
   * The fill is animation; the firing is a timer.
   *
   * Driving completion from `requestAnimationFrame` means the act only happens if frames are
   * delivered — and rAF is throttled hard, or paused outright, in a backgrounded or
   * power-saving page. **A hold that needs animation frames to complete can fail on a phone in
   * low power mode**, which is the phone this is written for. Found when a handover test
   * failed only under parallel load; it is not a test problem.
   */
  let doneAt: ReturnType<typeof setTimeout> | null = null;

  function tick() {
    if (holdStart === null) return;
    progress = Math.min((Date.now() - holdStart) / HOLD_MS, 1);
    frame = requestAnimationFrame(tick);
  }

  function press() {
    if (operator.distressRunning) return;
    pulse('tap');
    holdStart = Date.now();
    frame = requestAnimationFrame(tick);
    doneAt = setTimeout(() => release(true), HOLD_MS);
  }

  function release(complete = false) {
    if (frame !== null) cancelAnimationFrame(frame);
    if (doneAt !== null) clearTimeout(doneAt);
    frame = null;
    doneAt = null;
    holdStart = null;
    progress = 0;
    // It is away. Somebody holding a phone in the dark under stress should not have to look
    // at the screen to learn that the hold took.
    if (complete) pulse('committed');
    if (complete) operator.raiseDistress(text.trim());
  }

  onDestroy(() => {
    if (frame !== null) cancelAnimationFrame(frame);
    // Found in robustness audit: this cleared the animation frame but never doneAt, so a
    // hold interrupted by navigation before the threshold completed still fired release(true)
    // seconds later — starting a Distress the operator never actually held for, from a
    // screen they had already left. Distinct from the rule below: this is a hold that was
    // abandoned before completing, not a send already underway.
    if (doneAt !== null) clearTimeout(doneAt);
    // Deliberately does NOT cancel a running Distress. Navigating away is not standing down,
    // and the send outlives this screen.
  });

  /** A relay by its host, which is what a person can recognise. */
  const host = (url: string): string => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  };

  function describe(p: (typeof phases)[number]): string {
    switch (p.phase) {
      case 'sending': return `Attempt ${p.attempt} — sending`;
      case 'also-sending': return `Attempt ${p.attempt} — also sending to ${p.relays.map(host).join(', ')}`;
      case 'sent': return `Attempt ${p.attempt} — left the phone`;
      // "Never left the phone" was untrue of a relay that refused it, or took it and confirmed too
      // late; the attempt's account says which [G3 phase 1].
      case 'unreachable': return `Attempt ${p.attempt} — no relay took it: ${p.error}`;
      case 'accounted': {
        const of = p.took.length + p.refused.length + p.unconfirmed.length + p.unreached.length;
        const heard = p.heard ? `, the watch heard on ${p.heard.length}` : '';
        const unsure = p.unconfirmed.length > 0 ? `; ${p.unconfirmed.length} did not confirm and may have it` : '';
        return `Attempt ${p.attempt} — taken by ${p.took.length} of ${of} relays${heard}${unsure}`;
      }
      case 'no-answer': return `Attempt ${p.attempt} — sent, no answer`;
      // Not "no answer": nothing was listening, so an answer may have come and gone [G3 phase 1].
      case 'could-not-hear': return `Attempt ${p.attempt} — could not hear: no relay was listening for an answer`;
      case 'listening-nowhere':
        return `Listening on no relay: ${p.relays.map((r) => `${host(r.url)} (${clip(r.reason) ?? 'no reason'})`).join(', ')}`;
      case 'listening-again': return `Listening again on ${p.relays.map(host).join(', ')}`;
      case 'agent-holding': return `Attempt ${p.attempt} — an agent answered. Still looking for a human`;
      case 'watch-status':
      case 'watch-exhausted':
        return `Attempt ${p.attempt} — the watch: ${clip(p.response.text) ?? 'no detail'}`;
      case 'nobody-answering':
        return (
          `${Math.round(p.elapsedMs / 60000)} minutes, no human. Still sending` +
          (p.couldNotHear ? `; this phone could not hear for ${p.couldNotHear.attempts} of ${p.couldNotHear.of} attempts` : '')
        );
      case 'acknowledged-earlier':
        return `Attempt ${p.attempt} — ${p.response.responder?.callsign ?? 'A person'} answered an earlier Distress, not this one`;
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
      <strong>There is nowhere to send this.</strong>
      {#if stranded}Distress goes to your watch, and none of its relays can be reached from this
        page,{:else}Distress goes to a watch and you have not added one,{/if} so holding the button
      would raise nobody.{#if stranded}
        <a href="/terminal/setup/#relays">Fix them in setup</a>.{/if}
    </p>
    <!--
      Peers named, because "raise nobody" is true and the person most likely to read past it
      is the one who has paired with somebody. Pairing is mutual *visibility* — a peer sees
      that you are out and that you are past the time you gave. It is not a channel, and
      there is no way to reach one deliberately: the app holds no number for them.

      Stated whether or not this operator has peers yet, so the limit is known before
      somebody pairs rather than discovered after — the same reason unpairing is explained
      above the pairing form.

      The sentence stays on the screen and what pairing *is* moves behind the disclosure. A
      browser test reads this block with `toContainText`, which resolves `textContent` and so
      sees a closed `<details>` too — but it is here for the operator, not the test, and the
      part that changes what they should do next is the first line.
    -->
    <p class="cost"><strong>Peers you have paired with are not told either.</strong></p>
    {#if !contact}
      <p class="cost">
        Nothing on this phone can reach anyone for you.
        <a href="/terminal/setup/">Add someone you would call</a>.
      </p>
    {/if}
    <!--
      One disclosure for the block, not one per paragraph.

      The first version of this conversion gave each moved paragraph its own `Why`, which read
      on the screen as two collapsed accordions stacked with a heading's worth of space between
      them -- fewer words and a worse screen, on the one page nobody is reading calmly. The
      count is not the goal; what a person meets is.
    -->
    <Why summary="What that means">
      <p class="cost">
        Pairing lets somebody see that you are out and that you are past the time you gave —
        it does not carry this, and nothing here can reach them for you.
      </p>
      {#if !contact}
        <p class="cost">
          It takes a name and a number, stays on this phone, and is the only thing that helps
          when there is no watch.
        </p>
      {/if}
    </Why>
  </section>
{/if}

{#if !operator.distressRunning && phases.length === 0}
  <section>
    <!--
      "Keeps sending until a human answers" was true only while this page kept running: the
      retrying lives in timers in this page, so closing it ends it, and a locked iPhone or a
      backgrounded Android tab pauses or throttles it. Said here, before the hold, because it
      changes what somebody should do with the phone after sending.
    -->
    <p>
      This wakes people up. It keeps sending while this screen stays open and the phone stays
      awake, until a human answers — <strong>not an agent</strong>. Locking the phone can pause
      it and closing this screen stops it; otherwise only you can stop it.
    </p>
    <!--
      This paragraph is why `Why` belongs here and not around the person block above.

      The capability it backs is *"Your person, before the app loads"*, and `capabilities.test`
      reads the **prerendered** HTML for its claim. Moving it up beside the Text and Call
      buttons put it inside `{#if contact}`, which is null at prerender -- so the one sentence
      promising that calling works before the app does had itself stopped appearing until the
      app did. A `<details>` here still prerenders its contents, so the claim is in the page
      whether or not anybody opens it.
    -->
    <Why summary="What works before this screen does">
      <p class="cost">
        Calling your own person <strong>works before the rest of this screen does</strong>, and
        with no data connection — it still needs phone signal. Everything below needs the app to
        have finished loading; a phone call does not.
      </p>
    </Why>
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
  {#if (watchSaidNobody || nobodyAnswering) && !acknowledged}
    <section class="nobody" data-nobody-answering data-watch-exhausted={watchSaidNobody ? 'true' : undefined}>
      <h2>Nobody is coming</h2>
      {#if watchSaidNobody}
        <p>
          <strong>The watch said nobody could be reached.</strong> Assume no one is on their way
          and act on that.
        </p>
        {#if clip(watchSaidNobody.response.text)}
          <p class="cost">In the watch's words: <q>{clip(watchSaidNobody.response.text)}</q></p>
        {/if}
        <p class="cost">
          The sending has not stopped, and a human who answers later still counts. Only you can
          stop it.
        </p>
      {:else}
        <p>
          Long enough has passed that a working watch would have answered or told you it
          couldn't. <strong>Assume no one is on their way</strong> and act on that.
        </p>
        <p class="cost">
          This phone worked that out on its own — it is not a message from the watch, and it
          does not mean the sending stopped. It hasn't. Only you can stop it.
        </p>
      {/if}
    </section>
  {/if}

  <!--
    Not "has it", not "Answered", not the station colour: the person answered a Distress this one
    never sent or joined, and the watch has not escalated this one. The watch's own words say when
    the earlier answer was given and what happens next, and the sending below goes on.
  -->
  {#if earlier && !acknowledged}
    <section class="earlier" data-acknowledged-earlier>
      <p>
        <strong>{earlier.response.responder?.callsign ?? 'Someone'}</strong> acknowledged an earlier
        Distress from you, not this one.
      </p>
      {#if clip(earlier.response.text)}<p class="cost">{clip(earlier.response.text)}</p>{/if}
    </section>
  {/if}

  {#if acknowledged}
    <section class="answered">
      <p><strong>{acknowledged.response.responder?.callsign ?? 'A human'}</strong> has it.</p>
      {#if acknowledged.response.text}<p>{acknowledged.response.text}</p>{/if}
    </section>
  {:else if operator.distressRunning}
    <section>
      <!--
        The panel header directly above already reads `Sending`, so "still going" was the
        third thing on the screen saying so. What is left is the part a readout cannot carry:
        this does not time out — while this screen stays open and the phone stays awake.
      -->
      <p class="cost"><strong>It will not stop on its own while this screen stays open and awake.</strong></p>
      <Why summary="What to do while it sends">
        <p class="cost">
          Still going. It will not stop on its own while this screen stays open and the phone
          stays awake — locking the phone can pause it, and closing this screen stops it. If
          nothing is answering, that is what the list above is telling you, and it is worth
          acting on directly.
        </p>
      </Why>
      <button class="stand-down" onclick={() => operator.standDownDistress()}>
        Stand down — I am safe
      </button>
    </section>
  {:else}
    <section>
      <p class="error" data-stopped>
        <strong>Stopped without a human.</strong> Nobody acknowledged this. Nothing on this
        phone is still trying, and anyone already paged was not told it stopped.
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
  /*
   * The watch speaking, at full weight. Its reports include "every channel failed" and "nobody
   * could be paged", which escalation.spec requires the operator be told plainly -- not in the
   * muted grey of a routine attempt line.
   */
  li.watch-status { color: var(--t-ink); }
  li.watch-exhausted { color: var(--t-dark); font-weight: 650; }
  li.nobody-answering { color: var(--t-dark); font-weight: 650; }
  /* Somebody, about something else: the colour of "getting through", never of "has it". */
  li.acknowledged-earlier { color: var(--t-oncall); }
  .earlier { border: 2px solid var(--t-oncall); background: var(--t-raised); padding: 1rem 1.1rem; }
  .earlier p { color: var(--t-ink); }

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
