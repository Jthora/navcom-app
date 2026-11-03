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
  import { codeTeams, declineIsValid, keyPrint, RESPONSE_WINDOW, sameTeam, TEXT_MAX } from '@navcom/core';
  import { setWatchTeams, watchTeams } from '$lib/terminal/teams';
  import { board, type Waiting } from '$lib/terminal/board.svelte';
  import { createWatch, foundedHere, joinWatch, leaveWatch, otherHolders as keptHolders, setOtherHolders, watchKey, watchPubkey, watchSecretHex, WatchKeyError } from '$lib/terminal/watch-key';
  import ScanKey from '$lib/components/watch/ScanKey.svelte';
  import { watchCode } from '$lib/terminal/watch-code';
  import { watchRelays } from '$lib/terminal/relays';
  import { endorsersFor } from '$lib/terminal/standing';
  import { Panel, Slot, Readout, Why, Heartbeat, Action, Board, Window, Elapsed } from '$lib/components/panel';
  import PickACallsign from '$lib/components/PickACallsign.svelte';
  import { loadIdentity } from '$lib/terminal/identity';
  import { loadConfig } from '$lib/terminal/config';
  import { update } from '$lib/terminal/update.svelte';
  import { sending } from '$lib/terminal/sending.svelte';
  import { askShown, floorDetail, floorNote, floorPin, nameKey, nearestTo, repeatedNames, shownFor, teamsOn } from '$lib/terminal/floor';
  import { coordinates, fixAge, mapLink, within } from '$lib/terminal/fix';
  import { awake, raise, setSound, soundOn } from '$lib/terminal/raise.svelte';
  import { placeLine, provenanceOf } from '$lib/terminal/lookup';
  import AnswerLookup from '$lib/components/watch/AnswerLookup.svelte';
  import PassOn from '$lib/components/watch/PassOn.svelte';
  import { night } from '$lib/terminal/watch-night.svelte';
  import type { Provenance, ResourceRecord } from '@navcom/core';

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

  /** The board's clock: who is due, and who has passed their time, move with it. */
  let nowS = $state(Math.floor(Date.now() / 1000));

  /** Whether this phone sounds a Distress while it holds the watch [raise.svelte.ts]. */
  let sound = $state(true);
  /** Distress this holder has silenced without answering: they still show, and stop sounding. */
  let silenced = $state<string[]>([]);
  /** Assists marked now that have chimed, so each chimes once. */
  const chimed = new Set<string>();

  const unanswered = $derived(board.distress.filter((w) => !w.answered));
  const ringing = $derived(board.onStation && sound && unanswered.some((w) => !silenced.includes(w.id)));

  // Sounds while there is a Distress nobody here has answered or silenced, and stops when there is not.
  $effect(() => raise.alarm(ringing));
  // The screen stays on while this phone holds the watch.
  $effect(() => awake.keep(board.onStation));
  $effect(() => {
    for (const w of board.waiting) {
      if (w.urgency !== 'now' || chimed.has(w.id)) continue;
      chimed.add(w.id);
      if (board.onStation && sound) raise.chime();
    }
  });

  function toggleSound() {
    sound = !sound;
    setSound(sound);
    raise.unlock();
  }

  onMount(() => {
    const ticking = setInterval(() => (nowS = Math.floor(Date.now() / 1000)), 15_000);
    sound = soundOn();
    others = keptHolders().join('\n');
    teamsTonight = watchTeams().join(', ');
    othersLoaded = true;
    // The first touch anywhere lets this browser play; until then it plays nothing.
    const unlock = () => raise.unlock();
    window.addEventListener('pointerdown', unlock);
    founded = foundedHere();
    vouchers = endorsersFor('can-take-watch').map((e) => ({ endorser: e.endorser, at: e.at }));
    address = watchPubkey();
    callsign = loadIdentity()?.callsign ?? null;
    board.start();
    // Asks whether a newer build is waiting while this screen is open, and only this one: it is the
    // only screen that answers as the watch, so the only place an older board's answers are made.
    const stopAsking = update.start();
    return () => {
      clearInterval(ticking);
      window.removeEventListener('pointerdown', unlock);
      raise.stop();
      awake.keep(false);
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
    // The holders were this watch's: the next one started or joined here names nobody else yet.
    others = '';
    refresh();
    confirmLeave = false;
  }

  /** The answer that did not reach a relay, if any. */
  let unsent = $state<string | null>(null);
  /** A directory record put into the answer being written, and where its words came from. */
  let attached = $state<{ for: string; name: string; provenance: Provenance } | null>(null);

  function attach(id: string, r: ResourceRecord) {
    const line = placeLine(r);
    text = text.trim() ? `${text.trim()}\n${line}` : line;
    attached = { for: id, name: r.name, provenance: provenanceOf(r) };
  }

  /** The source line the operator will see under the answer, said here first. */
  const sourceOf = (p: Provenance) => `${p.method ?? 'source not stated'}, ${p.verified ? `checked ${p.verified}` : 'never checked'}`;

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
      if (await board.answer(item, text, declining, attached?.for === id ? attached.provenance : null)) {
        answering = null;
        text = '';
        attached = null;
      } else {
        unsent = id;
      }
    } finally {
      busy = false;
    }
  }

  /** The board as it reads now, in its one order [core `boardOrder`]. */
  const out = $derived(board.entriesAt(nowS));
  /** The teams on it, to narrow the list by, where more than one team shares this watch. */
  const teams = $derived(teamsOn(out));
  /**
   * The teams this holder has narrowed the board to; none is all of them. Two holders sharing one
   * watch split its teams this way, agreed between them, and nothing on the wire says so.
   */
  let narrowed = $state<string[]>([]);
  /** A team nobody on the board is with any longer is no narrowing. */
  const chosen = $derived(narrowed.filter((n) => teams.some((t) => sameTeam(t, n))));
  const toggle = (t: string) =>
    (narrowed = chosen.some((c) => sameTeam(c, t)) ? chosen.filter((c) => !sameTeam(c, t)) : [...chosen, t]);
  /** What is waiting on this holder, and what is waiting on the teams they have not chosen: named, never hidden. */
  const asks = $derived(board.waiting.filter((w) => askShown(board.teamFor(w.operator), chosen)));
  const elsewhere = $derived(board.waiting.filter((w) => !askShown(board.teamFor(w.operator), chosen)));
  /** Names two operators here share: theirs show a key's print, which is who they are. */
  const repeated = $derived(repeatedNames(out));
  const printOf = (operator: string, callsign: string) => (repeated.has(nameKey(callsign)) ? keyPrint(operator) : null);

  /** Who is out, with their times, in the order the board is read. */
  const floor = $derived(
    out.filter((e) => shownFor(e, chosen)).map((e) => ({
      operator: e.operator,
      callsign: e.callsign,
      team: e.team ?? null,
      print: printOf(e.operator, e.callsign),
      area: e.area,
      status: e.status,
      note: floorNote(e, nowS),
      detail: floorDetail(e, nowS),
      pin: floorPin(e, nowS)
    }))
  );

  /**
   * Where somebody waiting on you is: the fix they sent with it, or else the last one they shared,
   * said as that. A Distress carries their last fix, and the board kept only its words.
   */
  function fixOf(w: Waiting): { p: NonNullable<Waiting['position']>; at: number } | null {
    if (w.position) return { p: w.position, at: w.before ?? w.at };
    const e = board.entries.find((x) => x.operator === w.operator);
    return e?.position && e.position_at !== null ? { p: e.position, at: e.position_at } : null;
  }

  /** Telling the people out what is happening [core `notice`]: everybody, or the teams chosen. */
  let telling = $state(false);
  let tellText = $state('');
  let tellBusy = $state(false);
  let tellFailed = $state(false);
  const tellTo = $derived(chosen.length > 0 ? chosen.join(', ') : 'everyone out');
  async function tell() {
    tellBusy = true;
    tellFailed = false;
    try {
      if ((await board.tellOut(tellText, chosen)).length > 0) {
        telling = false;
        tellText = '';
      } else tellFailed = true;
    } finally {
      tellBusy = false;
    }
  }

  let asking = $state<string | null>(null);
  let askFailed = $state<string | null>(null);
  async function askIn(operator: string) {
    asking = operator;
    askFailed = null;
    try {
      if (!(await board.askToCheckIn(operator))) askFailed = operator;
    } finally {
      asking = null;
    }
  }

  /**
   * Who an Assist can be passed to: everybody out but the person who asked and anybody in Distress,
   * in the teams the board is narrowed to; and the nearest few of them, where the asker shared where
   * they are.
   */
  const passable = (w: Waiting) =>
    board.entries.filter(
      (e) => e.operator !== w.operator && e.status !== 'distress' && (chosen.length === 0 || chosen.some((t) => sameTeam(e.team, t)))
    );
  const nearestFor = (w: Waiting) => {
    const f = fixOf(w);
    return f ? nearestTo(f.p, passable(w), 3) : [];
  };
  /** Who asked, where and how soon: never their own words, which may be about somebody else. */
  const passDraft = (w: Waiting) =>
    `${withTeam(w.operator, w.callsign)} asks for someone${w.area ? ` near ${w.area}` : ''}${w.urgency === 'now' ? ', now' : ''}.`;
  /** A name with the team it is out with, where one was given: what tells two teams' Ravens apart in a sentence. */
  const withTeam = (operator: string, callsign: string) => {
    const t = board.teamFor(operator);
    return t ? `${callsign} (${t})` : callsign;
  };

  let nightCopied = $state(false);
  let confirmClear = $state(false);
  async function copyNight() {
    try {
      await navigator.clipboard.writeText(night.text());
      nightCopied = true;
    } catch {
      nightCopied = false;
    }
  }
  const timeOf = (s: number) => new Date(s * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  /** `assist · now`, or the type alone. */
  const badgeOf = (w: Waiting) => (w.urgency ? `${w.type} · ${w.urgency}` : w.type);

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
  /** Read from this phone once it has mounted, so the first save is never an empty one over a kept list. */
  let othersLoaded = $state(false);
  const otherHolders = $derived(
    [...new Set((others.toLowerCase().match(/[0-9a-f]{64}/g) ?? []).filter((k) => k !== holderKey))]
  );
  // Kept, so a reload does not drop a relief from the next code anybody scans.
  $effect(() => {
    if (othersLoaded && address) setOtherHolders(otherHolders);
  });
  const addHolder = (k: string) => (others = others.trim() ? `${others.trim()}\n${k}` : k);
  const holderQr = $derived(holderKey ? encodeQR(holderKey, 'svg', { ecc: 'medium', border: 2 }) : '');
  const keyQr = $derived(showingKey ? encodeQR(showingKey, 'svg', { ecc: 'medium', border: 2 }) : '');
  /** Tonight's teams, typed by the holder and carried in the code, so sign-on offers them [teams.ts]. */
  let teamsTonight = $state('');
  const namedTeams = $derived(codeTeams(teamsTonight.split(',')));
  $effect(() => {
    if (othersLoaded) setWatchTeams(namedTeams);
  });
  const code = $derived.by(() => {
    const secret = address ? watchKey() : null;
    if (!secret || !address || !holderKey) return null;
    try {
      return watchCode({ pubkey: address, relays: watchRelays(), holders: [holderKey, ...otherHolders], teams: namedTeams }, secret);
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
  <title>{unanswered.length > 0 ? 'Distress · ' : ''}Watch · Field Terminal</title>
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
    <ScanKey label="Scan the watch key" onfound={(k) => (joining = k)} />
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
          onfire={() => {
            raise.unlock();
            void board.takeWatch();
          }}
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
        <!-- While this screen is open, and only then: a locked phone or a closed tab sounds nothing. -->
        <Slot k="Sound">
          <span class="toggle" data-watch-sound>
            {#if !sound}
              <Readout value="Off" tone="cold" sub="a Distress shows, silently" />
            {:else if raise.playable}
              <Readout value="On" tone="good" sub="Distress, while this is open" />
            {:else}
              <Readout value="Tap the screen" tone="warn" sub="this browser plays nothing until touched" />
            {/if}
            <button onclick={toggleSound}>{sound ? 'Turn off' : 'Turn on'}</button>
          </span>
        </Slot>
        <Slot k="Screen">
          <span data-watch-screen>
            {#if awake.held}
              <Readout value="Kept on" tone="good" />
            {:else if !awake.supported}
              <Readout value="May sleep" tone="warn" sub="this browser cannot keep it on" />
            {:else}
              <Readout value="May sleep" tone="warn" sub="not allowed just now" />
            {/if}
          </span>
        </Slot>
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
            Ask a holder of this watch for a <code>can take watch</code>
            credential, then claim it on <a href="/terminal/standing/">Standing</a>.
          </p>
        {/if}
    {/if}

    <!--
      The last slot in either post, so it is in the same place whichever one the holder is in.
      Nothing else says it: no notification, no badge, no sound, no vibration (only a Distress sounds) -- a holder is expected
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
      <label for="teams-tonight">Teams tonight</label>
      <input id="teams-tonight" bind:value={teamsTonight} autocomplete="off" placeholder="optional, separated by commas" data-teams-tonight />
      <Why summary="Other holders">
        <ScanKey label="Scan a holder key" onfound={addHolder} />
        <label for="other-holders">Their holder keys</label>
        <textarea id="other-holders" bind:value={others} rows="2" placeholder="64 hex characters each"></textarea>
        {#if otherHolders.length > 0}
          <Readout value={`${otherHolders.length + 1} holders`} tone="neutral" sub="in the code above" />
        {/if}
      </Why>
      <Why summary="This phone's holder key">
        <div class="qr" data-holder-qr>{@html holderQr}</div>
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
      <div class="qr" data-watch-key-qr>{@html keyQr}</div>
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
      {#if teams.length > 1}
        <!--
          Narrowing a list already on this phone, and what is waiting below with it. A Distress, and
          anybody past their time, stay on it; what waits on the other teams is named, never hidden.
        -->
        <div class="teams" role="group" aria-label="Team" data-teams>
          <button aria-pressed={chosen.length === 0} onclick={() => (narrowed = [])}>All</button>
          {#each teams as t (t)}
            <button aria-pressed={chosen.some((c) => sameTeam(c, t))} data-team={t} onclick={() => toggle(t)}>{t}</button>
          {/each}
        </div>
      {/if}
      <Board entries={floor} />
      <!--
        Asking somebody past their time to check in: what the spec asks a watch to do on overdue, and
        the holder's act, never the phone's. It reaches them silently, and nobody else.
      -->
      {#each board.entriesAt(nowS).filter((e) => e.status === 'overdue') as e (e.operator)}
        <div class="ask-in" data-ask-in={e.callsign}>
          {#if board.askedAt(e.operator) !== null}
            <Readout value="Asked" tone="neutral" sub={`${e.callsign} · ${fixAge(board.askedAt(e.operator)!, nowS)}`} />
          {/if}
          <button onclick={() => askIn(e.operator)} disabled={asking === e.operator}>
            {board.askedAt(e.operator) !== null ? `Ask ${withTeam(e.operator, e.callsign)} again` : `Ask ${withTeam(e.operator, e.callsign)} to check in`}
          </button>
          {#if askFailed === e.operator}
            <span class="error" data-ask-failed>Did not reach a relay.</span>
          {/if}
        </div>
      {/each}
      <!--
        What is happening, to the people out: the holder's words, silent on their phones, with
        nothing to accept or answer. Never an order and never about a person [invariants 1, 8].
      -->
      <div class="tell" data-tell>
        {#if telling}
          <label for="tell-text">To {tellTo}</label>
          <textarea id="tell-text" bind:value={tellText} rows="2" maxlength={TEXT_MAX}></textarea>
          <div class="row">
            <button onclick={tell} disabled={tellBusy || !tellText.trim()}>Send</button>
            <button onclick={() => (telling = false)}>Cancel</button>
          </div>
          {#if tellFailed}
            <span data-tell-failed><Readout value="Reached nobody" tone="warn" sub="no relay took it" /></span>
          {/if}
        {:else}
          <button data-tell-open onclick={() => { telling = true; tellFailed = false; }}>Tell {tellTo}</button>
        {/if}
        {#if board.told && board.told.text !== null}
          <span data-told>
            <Readout value={board.told.text} verbatim tone="neutral" sub={`to ${board.told.to.join(', ')} · ${fixAge(board.told.at, nowS)}`} />
          </span>
          <!-- It stands, and is told again to anybody heard from afterwards, until it is cleared or replaced. -->
          <button data-tell-clear onclick={() => board.clearNotice()}>Clear it</button>
        {:else if board.told}
          <span data-told-cleared><Readout value="Cleared" tone="cold" sub={fixAge(board.told.at, nowS)} /></span>
        {/if}
      </div>
    {/if}
  </section>

  {#snippet ask(w: Waiting)}
    <li class={w.type === 'distress' ? 'distress' : ''}>
            <div class="who">
              <span class="name">{w.callsign}</span>
              {#if board.teamFor(w.operator)}<span class="team" data-ask-team>{board.teamFor(w.operator)}</span>{/if}
              <span class="badge" data-urgency={w.urgency}>{badgeOf(w)}</span>
            </div>
            {#if printOf(w.operator, w.callsign)}<div class="where" data-ask-print>{printOf(w.operator, w.callsign)}</div>{/if}
            {#if w.text}<p class="said">{w.text}</p>{/if}
            <!-- Values, not prose: where they said they were, and where their phone last put them. -->
            {#if w.area}<div class="where" data-ask-area>{w.area}</div>{/if}
            {#if fixOf(w)}
              {@const f = fixOf(w)!}
              <div class="where" data-ask-fix>
                <span class="coords">{coordinates(f.p)}</span> · {within(f.p)} · {fixAge(f.at, nowS)} ·
                <a href={mapLink(f.p)} target="_blank" rel="noreferrer">Map</a>
              </div>
            {/if}
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
              {#if attached?.for === w.id}
                <span data-attached>
                  <Readout value={attached.name} verbatim tone="neutral" sub={sourceOf(attached.provenance)} />
                </span>
              {/if}
              {#if w.type === 'query' || w.type === 'assist'}
                <AnswerLookup near={fixOf(w)?.p ?? null} onpick={(r) => attach(w.id, r)} />
              {/if}
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
              <button onclick={() => { answering = w.id; text = ''; attached = null; }}>
                {w.type === 'distress' ? 'Tell them you are awake' : 'Answer'}
              </button>
            {/if}
            {#if w.type === 'assist'}
              <PassOn id={w.id} draft={passDraft(w)} others={passable(w).length}
                to={chosen.length > 0 ? chosen.join(', ') : 'the others out'}
                near={nearestFor(w).map((e) => withTeam(e.operator, e.callsign))} passedTo={board.passedTo(w.id)}
                onpass={async (t, near) =>
                  (await board.passOn(w, t, (near ? nearestFor(w) : passable(w)).map((e) => e.operator))).length > 0} />
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
      {#if ringing}
        <button data-silence onclick={() => (silenced = [...silenced, ...unanswered.map((w) => w.id)])}>Silence</button>
      {/if}
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
        {#each asks as w (w.id)}{@render ask(w)}{/each}
      </ul>
      {#if elsewhere.length > 0}
        <Slot k="Also waiting">
          <span data-also-waiting>
            <Readout value={elsewhere.map((w) => withTeam(w.operator, w.callsign)).join(', ')} verbatim tone="warn" sub="other teams" />
          </span>
        </Slot>
      {/if}
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

  <!--
    What this phone did while holding the watch: actions and callsigns, never what anybody wrote or
    where anybody was [watch-night.svelte.ts]. Tonight's: a panic wipe takes it.
  -->
  <section class="act" data-night>
    <h2>Tonight</h2>
    {#if night.entries.length === 0}
      <Slot k="Done"><Readout value="Nothing yet" tone="cold" /></Slot>
    {:else}
      <Why summary="What the watch did">
        <ol class="night">
          {#each night.entries as e, i (i)}<li><span class="t">{timeOf(e.at)}</span> {e.what}</li>{/each}
        </ol>
      </Why>
      <div class="row">
        <button onclick={copyNight}>{nightCopied ? 'Copied' : 'Copy it'}</button>
        {#if confirmClear}
          <button class="danger" onclick={() => { night.clear(); confirmClear = false; }}>Clear it</button>
          <button onclick={() => (confirmClear = false)}>Keep it</button>
        {:else}
          <button onclick={() => (confirmClear = true)}>Clear</button>
        {/if}
      </div>
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
  .night { margin: 0; padding-inline-start: 1.2rem; display: grid; gap: .25rem; font-size: .85rem; }
  .night .t { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--t-muted); }
  .ask-in { display: flex; align-items: center; justify-content: space-between; gap: .6rem; flex-wrap: wrap; margin-top: .5rem; }
  .toggle { display: flex; align-items: center; justify-content: space-between; gap: .6rem; flex-wrap: wrap; }
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
  .team { font-family: var(--font-mono); font-size: .66rem; color: var(--t-muted); }
  .tell { display: grid; gap: .5rem; margin-block-start: .8rem; }
  .teams { display: flex; flex-wrap: wrap; gap: .4rem; margin-block-end: .6rem; }
  /* The directory's toggles, so a list narrowed here reads as a list narrowed there. */
  .teams button { min-height: 2.4rem; font-size: .85rem; padding: 0 .8rem; border-color: var(--t-line); color: var(--t-faint); }
  .teams button[aria-pressed='true'] { border-color: var(--t-ink); color: var(--t-ink); }
  .said { margin: 0; color: var(--t-ink); font-size: .95rem; }
  .row { display: flex; gap: .6rem; }
  .badge {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .62rem; letter-spacing: .1em; text-transform: uppercase;
    color: var(--t-faint); border: 1px solid var(--t-line); padding: .1rem .3rem;
  }
  .board li.distress .badge { color: var(--t-alarm); border-color: var(--t-alarm); }
  /* Amber, never red: alarm is Distress's alone, and an Assist marked now is not one. */
  .badge[data-urgency='now'] { color: var(--t-oncall); border-color: var(--t-oncall); }
  .where {
    margin: 0; color: var(--t-muted); font-size: .8rem; overflow-wrap: anywhere;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .coords { color: var(--t-ink); user-select: all; }
  .danger { border-color: var(--t-alarm); color: var(--t-alarm); }
  /* Both readings in one cell, one visible: the slot is the same height whichever shows. */
  .build { display: grid; }
  .build-reading { grid-area: 1 / 1; visibility: hidden; }
  .build-reading[data-shown] { visibility: visible; }
</style>
