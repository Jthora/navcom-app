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
  import encodeQR from '@paulmillr/qr';
  import { declineIsValid, RESPONSE_WINDOW } from '@navcom/core';
  import { board, type Waiting } from '$lib/terminal/board.svelte';
  import { createWatch, foundedHere, joinWatch, leaveWatch, watchKey, watchPubkey, watchSecretHex, WatchKeyError } from '$lib/terminal/watch-key';
  import { watchCode } from '$lib/terminal/watch-code';
  import { watchRelays } from '$lib/terminal/relays';
  import { endorsersFor } from '$lib/terminal/standing';
  import { Panel, Slot, Readout, Why, Heartbeat, Action, Board, Window, Elapsed } from '$lib/components/panel';
  import PickACallsign from '$lib/components/PickACallsign.svelte';
  import { loadIdentity } from '$lib/terminal/identity';
  import { loadConfig } from '$lib/terminal/config';
  import { update } from '$lib/terminal/update.svelte';
  import { sending } from '$lib/terminal/sending.svelte';

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
    // Asks whether a newer build is waiting while this screen is open, and only this one: it is the
    // only screen that answers as the watch, so the only place an older board's answers are made.
    const stopAsking = update.start();
    return () => {
      board.stop();
      stopAsking();
    };
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

  /**
   * Giving up the watch.
   *
   * **Deliberately not awaited.** Removing a key from this phone has to work with no signal —
   * an operator handing the device over, or leaving a squad, cannot be told to find a relay
   * first — so this never blocks on the network.
   *
   * What changed is the retry behind it. `standDown` used to re-read the watch key on every
   * tick and this function deletes that key in the next statement, so from the first failed
   * publish the retry returned immediately and Dark never landed at all. It holds the key it
   * captured now, and keeps trying while this page is open. A `station` nobody retracted is
   * read as Dark by every client after `STALE_AFTER_SECONDS` regardless, so the window this
   * closes is five minutes rather than forever — worth closing, not worth blocking for.
   */
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

  /** What a reload would clear, said before the hold that does it. */
  const heardOut = $derived(board.entries.length);
  const heardWaiting = $derived(board.distress.length + board.waiting.length + board.restock.length);

  const blocks = $derived(address ? (address.match(/.{1,8}/g) ?? []) : []);
  /** `21:04`, on this phone's clock: when operators stop reading a stale claim as somebody here. */
  const clockOf = (s: number) => new Date(s * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const configured = $derived(loadConfig() !== null);

  /*
   * The watch, handed to operators whole [core: events/watch-code.ts].
   *
   * This screen gave operators the address alone, and a watch held on phones cannot be reached by
   * it: an operator seals what they send to the holders, each holder's own key, and with none named
   * it went sealed to the address, which no phone reads the board with. Every sign-on timed out and
   * no question or `Distress` reached the board [journey, 2026-10-28]. The code names this phone as a
   * holder, any other holder's key added here, and the relays this board listens on, signed by the
   * watch key, so Setup fills all of it from one scan and refuses a code anybody else made.
   */
  /** This phone's own key: the one it reads the board with, so the one operators seal to. */
  const holderKey = $derived(address ? (loadIdentity()?.pubkey ?? null) : null);
  const holderBlocks = $derived(holderKey ? (holderKey.match(/.{1,8}/g) ?? []) : []);
  let others = $state('');
  const otherHolders = $derived(
    [...new Set((others.toLowerCase().match(/[0-9a-f]{64}/g) ?? []).filter((k) => k !== holderKey))]
  );
  const code = $derived.by(() => {
    const secret = address ? watchKey() : null;
    if (!secret || !address || !holderKey) return null;
    try {
      return watchCode({ pubkey: address, relays: watchRelays(), holders: [holderKey, ...otherHolders] }, secret);
    } catch {
      return null;
    }
  });
  const codeQr = $derived(code ? encodeQR(code, 'svg', { ecc: 'medium', border: 2 }) : '');
  let codeCopied = $state(false);
  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      codeCopied = true;
    } catch {
      codeCopied = false;
    }
  }
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
  <p><strong>This app does not watch anybody. You do.</strong></p>
</section>

{#if !callsign}
  <section class="act">
    <PickACallsign />
  </section>
{:else if !address}
  <section class="act">
    <h2>Start a watch</h2>
    <button data-start-watch onclick={start}>Start a watch on this phone</button>
  </section>

  <section class="act">
    <h2>Or join one</h2>
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
        <!--
          No "published as the watch" under the name: a take while this phone heard nothing
          publishes nothing, and Published below says which is true [review: relay paths].
        -->
        <Slot k="Holder"><Readout value={callsign} verbatim tone="good" /></Slot>
        <Slot k="Published">
          {#if board.unannounced}
            <span class="error"><Heartbeat label="Not reaching a relay" /></span>
          {:else if board.deaf}
            <!--
              "Yes" here was the board's subscription existing, not it hearing anything: relays that
              refused it, or held it without a word, left a named human announced while nothing on
              this phone could hear a Distress [review: relay paths].
            -->
            <span class="error"><Heartbeat label="Not hearing on any relay" /></span>
          {:else if board.announced}
            <Readout value="Yes" tone="good" />
          {:else}
            <!-- No claim of this holder's has reached a relay in the last five minutes. -->
            <span data-not-yet-announced><Readout value="Not yet" tone="warn" /></span>
          {/if}
        </Slot>
        {#if board.unannounced}
          <!-- On the glass: it will not resolve unless the holder stays on signal. -->
          <p class="error" data-unannounced>
            Nobody can see this watch. Operators signing on now will read Dark. Still trying.
          </p>
        {/if}
        {#if board.deaf}
          <p class="error" data-not-hearing>
            Not hearing on any relay: a Distress sent here would not reach you.
          </p>
        {/if}
      {:else}
        <Slot k="Published">
          {#if board.stillAdvertised || board.orphaned}
            <Readout value="Still advertised" tone="alarm" sub="operators read you as here" />
          {:else}
            <Readout value="Nobody" tone="cold" sub="operators signing on read Dark" />
          {/if}
        </Slot>
        {#if board.orphaned}
          <!--
            Holding lives in this page, so a reload or a discarded tab ends it with nothing said,
            and the last claim stays on the relays until it goes stale [live check, 2026-10-28].
          -->
          <div class="orphaned" data-orphaned>
            <Readout value="Not holding" tone="alarm" sub={`this page reloaded · named until ${clockOf(board.orphaned.until)}`} />
            <Action label="Stand down" tone="warn" onfire={() => board.standDown()} />
          </div>
        {:else if board.stillAdvertised}
          <!-- A watch that is lying about itself: one of the two states the alarm channel is for. -->
          <p class="error" data-still-advertised>
            Standing down did not reach a relay, so operators still read you as here. Stay on
            signal until this clears.
          </p>
        {/if}

        <!--
          The read-back, before the threshold: who this phone has heard and by whose word you may
          hold it, above the control that commits you.
        -->
        <Slot k="Taking on">
          {#if board.entries.length === 0 && board.deaf}
            <!-- Before the hold, not after it: nobody here can hear, so the empty board is unknown. -->
            <span data-board-unknown><Readout value="Unknown" tone="warn" sub="not hearing on any relay" /></span>
          {:else if board.entries.length === 0}
            <Readout value="No contact" tone="cold" sub="nothing heard by this phone yet" />
          {:else}
            <Readout
              value={board.entries.map((e) => e.callsign).join(', ')} verbatim
              tone="neutral"
              sub="out now, that this phone has heard"
            />
          {/if}
        </Slot>
        <Slot k="Gate">
          {#if founded}
            <Readout value="Founded here" tone="good" sub="you started this watch" />
          {:else if vouchers.length > 0}
            <span data-vouchers>
              <Readout
                value={vouchers.map((v) => v.endorser).join(', ')} verbatim
                tone="good"
                sub="{vouchers.length === 1 ? 'says' : 'say'} you can take a watch"
              />
            </span>
          {:else}
            <span data-ungated><Readout value="Not vouched" tone="warn" /></span>
          {/if}
        </Slot>

        {#if !qualified}
          <!-- A refusal keeps its route: together they say what to do. -->
          <p class="cost">
            Ask somebody who already holds this watch for a <code>can take watch</code>
            credential, then claim it on <a href="/terminal/standing/">Standing</a>.
          </p>
        {/if}
    {/if}

    <!--
      The last slot in either post, so it is in the same place whichever one the holder is in.
      Nothing else says it: no notification, no badge, no sound, no vibration -- a holder is expected
      to look, and this is where they look.

      **Always here, and always the same height** [review: board reload]. It appeared when a newer
      build was found, which is a moment nobody chooses -- often just as the screen is shown again,
      when a holder who has just unlocked the phone is reaching for an answer below -- and everything
      under the panel moved down by its height. Both readings are laid in the same cell and only one
      is visible, so the cell is the height of the taller whichever shows: a flip changes words, not
      layout. Its control is at the foot of the screen, below everything anybody is waiting on.
    -->
    <Slot k="Build">
      <span class="build">
        <span class="build-reading" data-shown={update.waiting ? undefined : 'true'} aria-hidden={update.waiting ? 'true' : undefined}>
          <Readout value="Nothing newer" tone="cold" sub="that this phone has heard" />
        </span>
        <span
          class="build-reading"
          data-update-ready={update.waiting ? '' : undefined}
          data-shown={update.waiting ? 'true' : undefined}
          aria-hidden={update.waiting ? undefined : 'true'}
        >
          <Readout value="Older build" tone="warn" sub="reload it at the foot" />
        </span>
      </span>
    </Slot>
  </Panel>

  <section class="act" data-watch-code>
    <h2>Code for operators</h2>
    {#if code}
      <!-- Held up to their camera, as a peer's code is: the in-person path, through nobody's server. -->
      <div class="qr" data-code-qr>{@html codeQr}</div>
      <button onclick={copyCode}>{codeCopied ? 'Copied' : 'Copy the code'}</button>
      <Why summary="Other holders">
        <label for="other-holders">Their holder keys</label>
        <textarea id="other-holders" bind:value={others} rows="2" placeholder="64 hex characters each"></textarea>
        {#if otherHolders.length > 0}
          <Readout value={`${otherHolders.length + 1} holders`} tone="neutral" sub="in the code above" />
        {/if}
      </Why>
      <Why summary="This phone's holder key">
        <p class="blocks" data-holder-key>{#each holderBlocks as b, i (i)}<span>{b}</span>{/each}</p>
      </Why>
    {/if}
    <Why summary="Watch address">
      <p class="blocks" data-watch-address>{#each blocks as b, i (i)}<span>{b}</span>{/each}</p>
    </Why>
    {#if !configured}
      <Slot k="Your terminal">
        <Readout value="Under no watch" tone="cold" sub="you can hold one without being under one" />
      </Slot>
    {/if}
  </section>

  <section class="act">
    <h2>Hand this watch to somebody</h2>
    <p class="cost">Whoever has the key can answer as this watch. It can't be taken back.</p>
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
        {#if board.deaf}
          <!-- Blank reads unknown [invariant 7]: a phone hearing on no relay cannot say nobody is out. -->
          <span data-board-unknown><Readout value="Unknown" tone="warn" sub="not hearing on any relay" /></span>
        {:else}
          <span data-empty-board><Readout value="No contact" tone="cold" sub="nothing heard by this phone" /></span>
        {/if}
      </Slot>
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
            {#if w.before !== undefined}
              <!-- Kept by a relay and handed to this screen when it opened: not new [live check, 2026-10-28]. -->
              <span data-earlier><Readout value="Earlier" tone="cold" sub="sent before you opened this" /></span>
            {/if}
            {#if w.answered}
              <span data-distress-answered><Readout value="Answered" tone="good" sub="from this watch" /></span>
            {/if}
            {#if w.type === 'distress'}
              <Elapsed since={w.before ?? w.at} label="Raised" />
            {:else if RESPONSE_WINDOW[w.type] !== null}
              <Window sentAt={w.before ?? w.at} seconds={RESPONSE_WINDOW[w.type] ?? 60} label={w.type} />
            {/if}
            {#if answering === w.id}
              <label for="a-{w.id}">Your answer</label>
              <textarea id="a-{w.id}" bind:value={text} rows="3"></textarea>
              <div class="row">
                <button onclick={() => send(w.id)} disabled={busy}>Send</button>
                <button onclick={() => (answering = null)}>Cancel</button>
              </div>
              {#if unsent === w.id}
                <!-- Sent counts only where they were heard: they publish there, and listen there. -->
                <p class="error" data-answer-unsent>
                  Did not reach a relay they were heard on. Try again when you have signal.
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
        <p class="cost" data-distress-dropped>More Distress is arriving than this board will hold.</p>
      {/if}
      <ul class="board asks">
        {#each board.distress as w (w.id)}{@render ask(w)}{/each}
      </ul>
    </section>
  {/if}

  <section>
    <h2>Waiting on you</h2>
    {#if board.routineDropped}
      <p class="cost" data-routine-dropped>Too much is arriving: some routine traffic is hidden. Distress never is.</p>
    {/if}
    {#if board.waiting.length === 0}
      <Slot k="Waiting">
        {#if board.deaf}
          <Readout value="Unknown" tone="warn" sub="not hearing on any relay" />
        {:else}
          <Readout value="Nothing waiting" tone="cold" />
        {/if}
      </Slot>
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
      <Slot k="Restock">
        {#if board.deaf}
          <Readout value="Unknown" tone="warn" sub="not hearing on any relay" />
        {:else}
          <Readout value="Nothing has run out" tone="cold" />
        {/if}
      </Slot>
    {:else}
      <ul class="board asks">
        {#each board.restock as w (w.id)}
          <li>
            <div class="who"><span class="name">{w.callsign}</span></div>
            {#if w.text}<p class="said">{w.text}</p>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="act">
    <h2>Give up this watch</h2>
    <p class="cost">
      Removes the key from this phone. It does not end the watch for anyone else who holds it.
    </p>
    {#if confirmLeave}
      <button class="danger" onclick={leave}>Remove it from this phone</button>
      <button onclick={() => (confirmLeave = false)}>Keep it</button>
    {:else}
      <button onclick={() => (confirmLeave = true)}>Give up this watch</button>
    {/if}
  </section>

  {#if update.waiting || update.phase === 'fetching'}
    <!--
      Its own section rather than a second control in the panel: the panel's one lit action is the
      watch itself, and two held amber controls one above the other is how the wrong one gets held.

      **At the foot, below everything** [review: board reload]. It appears at a moment nobody
      chooses, and anywhere above the Distress section it pushed the answer controls down under the
      thumb reaching for them -- "Tell them you are awake" landing on the "Nobody can come" above it.
      Nothing that appears by itself sits above anything somebody is waiting on.

      The cost before the hold, as the wipe screen says its own: everything on this board lives in
      this page, and a reload is the board being cleared.
    -->
    <section class="act" data-reload>
      <h2>Reload this board</h2>
      {#if sending.distress}
        <!-- A reload stops a Distress this phone is sending, so it is not offered until that ends. -->
        <Slot k="Reload">
          <span data-reload-held>
            <Readout value="Not now" tone="warn" sub="this phone is sending a Distress, and a reload would stop it" />
          </span>
        </Slot>
      {:else if update.phase === 'fetching'}
        <!-- The board is untouched until the newer build has arrived: reloading before would load this one again. -->
        <Slot k="Reload">
          <span data-reload-fetching>
            <Heartbeat label="Fetching the newer build" />
          </span>
        </Slot>
      {:else}
        {#if update.phase === 'failed'}
          <Slot k="Reload">
            <span data-reload-failed>
              <Readout value="Not loaded" tone="warn" sub="the newer build did not arrive; nothing was cleared" />
            </span>
          </Slot>
        {/if}
        <div data-reload-cost>
          <Slot k="Clears">
            <Readout value="{heardOut} out, {heardWaiting} waiting" tone="warn" sub="what this phone has heard" />
          </Slot>
          {#if board.onStation}
            <p class="cost">Take the watch again after it.</p>
          {/if}
          {#if update.fetchFirst}
            <p class="cost">The newer build is fetched first; nothing clears until it arrives.</p>
          {/if}
        </div>
        <Action
          label="Hold to reload"
          holdingLabel="Keep holding…"
          hold={1200}
          tone="warn"
          onfire={() => void update.reload()}
        />
      {/if}
    </section>
  {/if}
{/if}

<style>
  .act { gap: .6rem; }
  .orphaned { display: flex; flex-direction: column; gap: .5rem; }
  .qr {
    background: #fff; padding: .7rem; align-self: flex-start; line-height: 0;
    /* White ground regardless of theme: a scanner needs the contrast the format assumes. */
  }
  .qr :global(svg) { width: min(62vw, 15rem); height: auto; display: block; }
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
  /* Both readings in one cell, one visible: the slot is the same height whichever shows. */
  .build { display: grid; }
  .build-reading { grid-area: 1 / 1; visibility: hidden; }
  .build-reading[data-shown] { visibility: visible; }
</style>
