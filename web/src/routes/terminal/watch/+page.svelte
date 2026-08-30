<script lang="ts">
  /**
   * The watch, as a mode of the same app.
   *
   * The hardest problem on this screen is wording rather than mechanism. Everything here
   * looks like a safety monitor — a board, statuses, somebody marked overdue — and it is
   * not one. A phone in a pocket with the screen off observes nothing, and no interface can
   * change that.
   *
   * So the copy states, before anything else and without softening it, that **taking watch
   * is a promise a person makes and keeps by looking.** An operator in the field is told a
   * named human is watching; if that sentence is not true, invariant 4 has failed and
   * somebody went out believing something false.
   */
  import { onMount } from 'svelte';
  import { declineIsValid, RESPONSE_WINDOW } from '@navcom/core';
  import { board, type Waiting } from '$lib/terminal/board.svelte';
  import { createWatch, foundedHere, joinWatch, leaveWatch, watchPubkey, watchSecretHex, WatchKeyError } from '$lib/terminal/watch-key';
  import { endorsersFor } from '$lib/terminal/standing';
  import { Panel, Slot, Readout, Why, Heartbeat, Action, Board, Window, Elapsed } from '$lib/components/panel';
  import { loadIdentity } from '$lib/terminal/identity';
  import { loadConfig } from '$lib/terminal/config';

  let address = $state<string | null>(null);
  let callsign = $state<string | null>(null);
  let joining = $state('');
  let error = $state<string | null>(null);
  let answering = $state<string | null>(null);
  let text = $state('');
  let busy = $state(false);
  let confirmLeave = $state(false);
  /** Deliberate: a secret does not appear on a screen because somebody opened the screen. */
  let showingKey = $state<string | null>(null);
  /**
   * 7.3. `the-watch.md` specifies `can take watch` as the qualification and the watch
   * shipped with no gate at all.
   *
   * 7.2 is why it does not brick a new squad: founding is self-evident. Whoever started this
   * watch can always hold it; anybody handed the key needs somebody who already holds it to
   * say so.
   */
  let founded = $state(false);
  let vouchers = $state<{ endorser: string; at: string }[]>([]);
  const qualified = $derived(founded || vouchers.length > 0);

  onMount(() => {
    founded = foundedHere();
    vouchers = endorsersFor('can-take-watch').map((e) => ({ endorser: e.endorser, at: e.at }));
    address = watchPubkey();
    callsign = loadIdentity()?.callsign ?? null;
    board.start();
    return () => board.stop();
  });

  /** Re-read after anything that changes what this device holds. */
  function refresh() {
    address = watchPubkey();
    founded = foundedHere();
    vouchers = endorsersFor('can-take-watch').map((e) => ({ endorser: e.endorser, at: e.at }));
  }

  function start() {
    createWatch();
    refresh();
    board.start();
  }

  function join() {
    error = null;
    try {
      joinWatch(joining);
      refresh();
      joining = '';
      board.start();
    } catch (e) {
      error = e instanceof WatchKeyError ? e.message : 'Could not join that watch.';
    }
  }

  function leave() {
    void board.standDown();
    leaveWatch();
    refresh();
    confirmLeave = false;
  }

  /** The answer that did not reach a relay, if any. */
  let unsent = $state<string | null>(null);

  async function send(id: string, declining = false) {
    // Both lists. Distress moved into its own section so it cannot be buried, and looking
    // only at `waiting` would have made the one signal that matters unanswerable.
    const item = board.distress.find((w) => w.id === id) ?? board.waiting.find((w) => w.id === id);
    if (!item || busy) return;
    busy = true;
    unsent = null;
    try {
      // Reported rather than assumed. An answer that reached no relay used to clear the
      // item anyway: the watch believed they had replied and the operator got nothing.
      if (await board.answer(item, text, declining)) {
        answering = null;
        text = '';
      } else {
        unsent = id;
      }
    } finally {
      busy = false;
    }
  }

  const blocks = $derived(address ? (address.match(/.{1,8}/g) ?? []) : []);
  const configured = $derived(loadConfig() !== null);
</script>

<svelte:head>
  <title>Watch · Field Terminal</title>
  <meta name="description" content="Holding the board." />
</svelte:head>

<header>
  <p class="eyebrow"><a href="/terminal/">← Status</a></p>
  <h1>Watch</h1>
</header>

<section>
  <!--
    Two sentences stay on the glass and the rest goes one tap down [docs/design/panel.md P3].

    Not by length. **"This app does not watch anybody. You do."** is the whole thesis of the
    screen and everything below it looks like a monitor, so it cannot be behind anything. And a
    `Distress` not being closed by an acknowledgement is a thing that will not happen unless
    somebody acts — which is the one class of prose this doctrine never hides.
  -->
  <p><strong>This app does not watch anybody. You do.</strong></p>
  <p>
    <strong>A <code>Distress</code> is not closed by answering it.</strong> Acknowledging
    tells the operator a person is awake. It stays on this board until a human has actually
    ended it, and there is no button here that clears one.
  </p>
  <Why summary="What taking the watch means">
    <p>
      Taking watch means <strong>you are the person answering tonight</strong>. Operators who
      sign on will see your callsign and go out believing somebody is reading what they send.
    </p>
    <p class="cost">
      <!--
        4.3, and the reason this screen exists as text before it exists as a board. Everything
        below LOOKS like a monitor and is not one.
      -->
      Nothing here runs in the background, nothing wakes you, and a phone in your pocket with
      the screen dark is not reading a board. It shows you what you took on —
      <strong>keeping it means looking</strong>.
    </p>
    <p class="cost">
      Somebody past their time is <strong>marked, and nothing else happens</strong>. No page,
      no ladder, no contact. People are late for ordinary reasons far more often than
      dangerous ones, and an alarm that cries wolf destroys the one mechanism where failure
      means somebody is hurt.
    </p>
    <p class="cost">
      <!--
        Governs how to read the board, and somebody deciding whether to take a watch needs to
        know what it does not tell them.
      -->
      <strong>An empty board is not the same as nobody being out.</strong> It shows what this
      phone has heard, which after a handover is less than what is true — operators already
      out re-announce themselves a minute or two after their phones notice the watch changed
      hands. Nobody hands you a board, because nobody holds anybody else's picture.
    </p>
  </Why>
</section>

{#if !callsign}
  <section class="act">
    <p>Pick a callsign first — <a href="/terminal/setup/">it takes one screen</a>.</p>
  </section>
{:else if !address}
  <section class="act">
    <h2>Start a watch</h2>
    <p class="cost">
      This phone becomes the watch. You give the address to the operators who will sign on
      under it, in person — <strong>nothing discovers a watch</strong>, because a list of
      them would be a list of where operators are.
    </p>
    <button data-start-watch onclick={start}>Start a watch on this phone</button>
  </section>

  <section class="act">
    <h2>Or join one</h2>
    <p class="cost">
      A squad shares one watch key, handed over in person like everything else here. Holding
      it means you can answer, and <strong>it does not expire when somebody removes you</strong>
      — a squad-held watch is only for people who already know each other.
    </p>
    <label for="key">Watch key</label>
    <textarea id="key" bind:value={joining} rows="2" autocomplete="off" spellcheck="false"
      placeholder="64 hex characters"></textarea>
    {#if error}<p class="error">{error}</p>{/if}
    <button onclick={join}>Join</button>
  </section>
{:else}
  <!-- The state IS the heading here, which is what the section was titled before. -->
  <Panel label={board.onStation ? 'On station' : 'Off watch'} data-watch-post>
    {#snippet action()}
      {#if board.onStation}
        <Action label="Stand down" tone="warn" onfire={() => board.standDown()} />
      {:else if qualified}
        <Action
          label="Hold to take the watch"
          holdingLabel="Keep holding…"
          hold={1200}
          tone="warn"
          onfire={() => board.takeWatch()}
        />
      {/if}
    {/snippet}

      {#if board.onStation}
        <Slot k="Holder"><Readout value={callsign} tone="good" sub="published as the watch" /></Slot>
        <Slot k="Published">
          {#if board.unannounced}
            <!--
              Being on station is a claim made to other people. Nothing was published, so this
              operator is covering nobody and would not otherwise find out.
            -->
            <span class="error"><Heartbeat label="Not reaching a relay" /></span>
          {:else}
            <Readout value="Yes" tone="good" />
          {/if}
        </Slot>
        {#if board.unannounced}
          <!-- The marker stays on the sentence it names: a state that will not resolve unless
               the operator stays on signal is not something to put behind a tap. -->
          <p class="error" data-unannounced>
            Nothing has reached a relay, so nobody can see this watch. Operators signing on now
            will read Dark. It will keep trying.
          </p>
        {/if}
        <Why summary="What standing down does">
          <p class="cost">
            You are published as the watch, under <strong>{callsign}</strong>. Standing down
            says so — it publishes Dark rather than going quiet, so nobody is left reading a
            stale claim that a human is here.
          </p>
        </Why>
      {:else}
        <Slot k="Published">
          {#if board.stillAdvertised}
            <Readout value="Still advertised" tone="alarm" sub="operators read you as here" />
          {:else}
            <Readout value="Nobody" tone="cold" sub="operators signing on read Dark" />
          {/if}
        </Slot>
        {#if board.stillAdvertised}
          <!--
            The worse direction, and the one standDown exists to prevent: watch state is
            replaceable, so a Dark that never landed leaves the previous state on the relay and
            everybody goes on believing a human is here.

            One of the two states permitted the alarm channel: a watch that is lying about
            itself. It stays visible, because it is a thing that will not resolve unless the
            operator stays on signal.
          -->
          <p class="error" data-still-advertised>
            You are still published as the watch. Standing down did not reach a relay, so
            operators are reading a claim that somebody is here. It will keep trying — stay on
            signal until this clears.
          </p>
        {:else}
          <Why summary="What Dark means for them">
            <p class="cost">
              Nobody is published as watching. Operators signing on now will read Dark, which is
              a supported state and an honest one.
            </p>
          </Why>
        {/if}

        <!--
          The read-back, before the threshold.

          A bridge handover is a read-back: the oncoming watch states the conditions before
          accepting them. What you are taking on is who this phone has heard and by whose word
          you may hold it, so both are on the screen above the control that commits you.

          The roster proposed *arming* the control after a staged reveal. Rejected: a delay
          that exists only to make an act feel weighty is ceremony with no mechanism under it,
          and the hold below is already a real threshold you can abandon by letting go.
        -->
        <Slot k="Taking on">
          {#if board.entries.length === 0}
            <Readout value="No contact" tone="cold" sub="nothing heard by this phone yet" />
          {:else}
            <Readout
              value={board.entries.map((e) => e.callsign).join(', ')}
              tone="neutral"
              sub="out now, that this phone has heard"
            />
          {/if}
        </Slot>
        <Slot k="Gate">
          {#if founded}
            <Readout value="Founded here" tone="good" sub="you started this watch — yours to hold" />
          {:else if vouchers.length > 0}
            <!--
              7.4, and the reason the limit is in the same readout rather than one tap down:
              **the claim and its limit in one breath.** Splitting them put somebody's word on
              the glass and the caveat behind a disclosure, which is the half that matters.
            -->
            <span data-vouchers>
              <Readout
                value={vouchers.map((v) => v.endorser).join(', ')}
                tone="good"
                sub="{vouchers.length === 1 ? 'says' : 'say'} you can take a watch — it is not a promise that you will stay awake tonight"
              />
            </span>
          {:else}
            <span data-ungated><Readout value="Not vouched" tone="warn" /></span>
          {/if}
        </Slot>

        {#if qualified}
          <Why summary="What that is, and is not">
            {#if founded}
              <p class="cost">
                Anybody you hand the key to will need somebody who already holds it to say they
                can.
              </p>
            {:else}
              <p class="cost">
                That is somebody's word about how you have worked before. Only you can make the
                promise about tonight.
              </p>
            {/if}
          </Why>
        {:else}
          <!-- A refusal and its route stay visible: this tells the operator what to do. -->
          <p class="cost">
            <strong>Nobody has said you can take a watch.</strong> Holding a board means
            operators go out believing a named human is reading what they send, so it is not
            something to take on your own say-so when the watch is somebody else's.
          </p>
          <p class="cost">
            Ask somebody who already holds this watch for a <code>can take watch</code>
            credential, and claim it on <a href="/terminal/standing/">your standing</a>. If you
            are starting your own watch instead, that needs nobody's permission.
          </p>
        {/if}
    {/if}
  </Panel>

  <section class="act">
    <h2>The address</h2>
    <p class="blocks">{#each blocks as b, i (i)}<span>{b}</span>{/each}</p>
    <Why summary="What this is for">
      <p class="cost">
        What operators put in their own setup, along with your relays. Handed over by a
        person; nothing here publishes it.
      </p>
    </Why>
    {#if !configured}
      <Slot k="Your terminal">
        <Readout value="Under no watch" tone="cold" sub="you can hold one without being under one" />
      </Slot>
    {/if}
  </section>

  <section class="act">
    <h2>Hand this watch to somebody</h2>
    <p class="cost">
      <!--
        The join box has always been here and there was nothing to put in it. A squad that
        cannot be formed is not a squad model, and Milestone 4 is "squad with no box".
      -->
      The <strong>key</strong>, not the address. Whoever holds it can answer as this watch and
      publish watch state under it, so it goes to somebody you already know, in person — and
      <strong>it does not come back</strong>. Removing them from the holders stops them reading
      new signals; nothing stops them claiming to be this watch.
    </p>
    {#if showingKey}
      <pre class="blob" data-watch-key>{showingKey}</pre>
      <button onclick={() => (showingKey = null)}>Hide it</button>
    {:else}
      <button onclick={() => (showingKey = watchSecretHex())}>Show the watch key</button>
    {/if}
  </section>

  <section>
    <h2>Who is out</h2>
    {#if board.entries.length === 0}
      <Slot k="Board">
        <span data-empty-board><Readout value="No contact" tone="cold" sub="nothing heard by this phone" /></span>
      </Slot>
      <Why summary="What that does and does not mean">
        <p class="cost">
          Nobody has signed on <em>that this phone has heard</em>. The board is built from
          signals this device received; it is not a history, and nothing stores one.
        </p>
        <p class="cost">
          If you have just taken over, operators already out re-announce themselves within a
          minute or two of their phones noticing the watch changed hands.
        </p>
      </Why>
    {:else}
      <!--
        The movement is the event: when somebody crosses their window they rise past the
        others, and peripheral vision reads that without reading anything. Ordering comes from
        the board the core already derives, so there is one definition of "overdue".
      -->
      <Board entries={board.entries} />
    {/if}
  </section>

  {#snippet ask(w: Waiting)}
    <li class={w.type === 'distress' ? 'distress' : ''}>
            <div class="who">
              <span class="name">{w.callsign}</span>
              <span class="badge">{w.type}</span>
            </div>
            {#if w.text}<p class="said">{w.text}</p>{/if}
            <!--
              A window that is running, or a Distress that is not.

              `RESPONSE_WINDOW.distress` is null: a Distress has no window and does not expire,
              so it must never get a depleting bar. A bar that empties says the signal resolves
              itself, and a Distress that appears to resolve itself is the silent failure
              invariant 2 forbids. It climbs instead, against an end it cannot reach.
            -->
            {#if w.type === 'distress'}
              <Elapsed since={w.at} label="Raised" />
            {:else if RESPONSE_WINDOW[w.type] !== null}
              <Window sentAt={w.at} seconds={RESPONSE_WINDOW[w.type] ?? 60} label={w.type} />
            {/if}
            {#if answering === w.id}
              <label for="a-{w.id}">Your answer</label>
              <textarea id="a-{w.id}" bind:value={text} rows="3"></textarea>
              <Why summary="Where this goes">
                <p class="cost">
                  Goes to them and nobody else. It is sent as a person's answer, never as a
                  looked-up one — say what you know and say what you do not.
                </p>
              </Why>
              <div class="row">
                <button onclick={() => send(w.id)} disabled={busy}>Send</button>
                <button onclick={() => (answering = null)}>Cancel</button>
              </div>
              {#if unsent === w.id}
                <p class="error" data-answer-unsent>
                  That did not reach a relay, so they have not received it. It is still on
                  your board — try again when you have signal.
                </p>
              {/if}
              {#if declineIsValid(w.type)}
                <!--
                  A separate button, not a phrasing of the answer. "Nobody is coming" has to
                  arrive as a fact the operator's screen can act on, not as text they have to
                  read carefully at 2am.
                -->
                <button class="danger" onclick={() => send(w.id, true)} disabled={busy}>
                  Nobody can come
                </button>
                <p class="cost">
                  Sends <strong>nobody is coming</strong>, plus whatever you wrote. Say it
                  when it is true — somebody who is told plainly can act, and somebody left
                  waiting on an acknowledgement cannot.
                </p>
              {/if}
            {:else}
              <button onclick={() => { answering = w.id; text = ''; }}>
                {w.type === 'distress' ? 'Tell them you are awake' : 'Answer'}
              </button>
            {/if}
    </li>
  {/snippet}

  <!--
    Its own section, above everything.

    `20911` is a separate kind precisely so a client can prioritise it independently of
    routine traffic [signals.spec.md]. This screen used to put it in one queue sorted by
    arrival, coloured red and otherwise equal — so a hundred queries arriving first put a
    Distress a hundred rows down the screen a watch reads when somebody is in trouble. Red is
    not prioritisation if you have to scroll to find it.
  -->
  {#if board.distress.length > 0}
    <section class="urgent">
      <h2>Distress</h2>
      {#if board.distressDropped}
        <p class="cost" data-distress-dropped>
          More Distress signals are arriving than this board will hold. Something
          extraordinary is happening, or somebody is flooding this watch.
        </p>
      {/if}
      <ul class="board asks">
        {#each board.distress as w (w.id)}{@render ask(w)}{/each}
      </ul>
    </section>
  {/if}

  <section>
    <h2>Waiting on you</h2>
    {#if board.routineDropped}
      <p class="cost" data-routine-dropped>
        More is arriving than this board will hold, so some routine traffic is not being
        shown. Distress signals are never dropped for it.
      </p>
    {/if}
    {#if board.waiting.length === 0}
      <Slot k="Waiting"><Readout value="Nothing waiting" tone="cold" /></Slot>
    {:else}
      <ul class="board asks">
        {#each board.waiting as w (w.id)}{@render ask(w)}{/each}
      </ul>
    {/if}
  </section>

  <section>
    <h2>Restock</h2>
    <!--
      Its own section, below everything anybody is waiting on, and with no badge or count.
      A resupply request is the least urgent thing in this system and the screen has to say
      so by where it puts it, not only in words.
    -->
    {#if board.restock.length === 0}
      <Slot k="Restock"><Readout value="Nothing has run out" tone="cold" /></Slot>
    {:else}
      <ul class="board asks">
        {#each board.restock as w (w.id)}
          <li>
            <div class="who"><span class="name">{w.callsign}</span></div>
            {#if w.text}<p class="said">{w.text}</p>{/if}
          </li>
        {/each}
      </ul>
      <Why summary="Why these are last">
        <p class="cost">
          Nobody is waiting on these. They are here so whoever keeps the stash knows what to
          buy — <strong>there is no count of what anyone handed out</strong>, here or anywhere.
        </p>
      </Why>
    {/if}
  </section>

  <section class="act">
    <h2>Give up this watch</h2>
    <p class="cost">
      Removes the key from this phone and publishes Dark. <strong>It does not end the
      watch</strong> — anybody else holding the same key still has it, and nothing here can
      reach their devices.
    </p>
    {#if confirmLeave}
      <button class="danger" onclick={leave}>Remove it from this phone</button>
      <button onclick={() => (confirmLeave = false)}>Keep it</button>
    {:else}
      <button onclick={() => (confirmLeave = true)}>Give up this watch</button>
    {/if}
  </section>
{/if}

<style>
  .act { gap: .6rem; }
  textarea { width: 100%; }
  .blocks {
    display: flex; flex-wrap: wrap; gap: .35rem .6rem; margin: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .95rem;
    color: var(--t-ink);
  }
  .blocks span { background: var(--t-sunk); padding: .2rem .4rem; }
  .board { list-style: none; margin: 0; padding: 0; }
  .board li {
    display: flex; align-items: center; gap: .8rem;
    border-bottom: 1px solid var(--t-line); min-height: 3.2rem;
  }
  .asks li { flex-direction: column; align-items: stretch; gap: .5rem; padding-block: .9rem; }
  .who { display: flex; align-items: center; gap: .7rem; }
  .name { color: var(--t-ink); font-weight: 650; flex: 1; }
  .said { margin: 0; color: var(--t-ink); font-size: .95rem; }
  .row { display: flex; gap: .6rem; }
  .badge {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .62rem; letter-spacing: .1em; text-transform: uppercase;
    color: var(--t-faint); border: 1px solid var(--t-line); padding: .1rem .3rem;
  }
  .board li.distress .badge { color: var(--t-alarm); border-color: var(--t-alarm); }
  .danger { border-color: var(--t-alarm); color: var(--t-alarm); }
</style>
