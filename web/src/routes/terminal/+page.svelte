<script lang="ts">
  import { onMount } from 'svelte';
  import { capabilitySentence, isValidPosition, pageableNow } from '@navcom/core';
  import { fixAge, mapLink, within } from '$lib/terminal/fix';
  import { Panel, Slot, Readout, Why, Action, Board } from '$lib/components/panel';
  import { watch } from '$lib/terminal/watch.svelte';
  import { operator, watchClosure } from '$lib/terminal/session.svelte';
  import type { DistressClosure } from '@navcom/core';
  import { presence } from '$lib/terminal/presence.svelte';
  import { position } from '$lib/terminal/position.svelte';
  import { battery } from '$lib/terminal/battery.svelte';
  import { pq } from '$lib/terminal/pq.svelte';
  import { overdue } from '$lib/terminal/overdue.svelte';
  import { passedOn } from '$lib/terminal/passed-on.svelte';
  import { notice } from '$lib/terminal/notice.svelte';
  import { ago } from '$lib/terminal/heard-copy';
  import { loadConfig, offeredWatch, storedWatch, type StoredWatch } from '$lib/terminal/config';
  import { peers } from '$lib/terminal/peers';
  import { formatDuration } from '$lib/terminal/patrol';
  import { notes } from '$lib/terminal/notes';
  import * as standing from '$lib/terminal/standing';
  import { loadIdentity } from '$lib/terminal/identity';
  import { backTo, pendingMission, type PendingMission } from '$lib/missions/pending';
  import { leakedSentences } from '$lib/missions/leaked';
  import { corruptTiers, onWipe } from '$lib/terminal/storage';
  import { offline } from '$lib/terminal/offline.svelte';
  import { readClock, type ClockRead } from '$lib/terminal/clock';
  import { heard } from '$lib/terminal/heard.svelte';
  import { HeardSlot, HeardWhy } from '$lib/components/heard';
  import { refusingNow } from '$lib/terminal/refusing.svelte';
  import { loadContact } from '$lib/terminal/contact';
  import { distressRead } from '$lib/terminal/distress-read';
  import { hostOf } from '$lib/terminal/heard-copy';

  const s = $derived(watch.state);
  /**
   * A watch this phone was given whose every relay this page refuses. Not "no watch": somebody
   * added it, and is told what is wrong with it and where to fix it [audit: relay paths, review].
   */
  let stranded = $state<StoredWatch | null>(null);

  /*
   * The capability receipt as a panel rather than a sentence [docs/design/panel.md].
   *
   * The sentence is not gone — it is one tap down, word for word, because `DARK` without "it
   * still works offline" reads as the app being broken and `CALL FIRST` without its reason is
   * a shorter way to be unhelpful. What changes is that the *state* is now readable at arm's
   * length, which a twenty-one word disclosure at 2am is not.
   *
   * `pageableNow` is the core's own rule for who can actually be raised, so this does not
   * reimplement "reachable" and then drift from it.
   */
  const nowS = $derived(Math.floor(Date.now() / 1000));
  const leaked = leakedSentences();
  const reachable = $derived(pageableNow(s.oncall, nowS).map((o) => o.author.callsign));
  const watchRead = $derived(
    s.state === 'dark'
      ? { value: 'Dark', tone: 'cold' as const, sub: stranded ? 'its relays cannot be reached from here' : null }
      : s.state === 'station'
        ? { value: 'On station', tone: 'good' as const, sub: s.holder }
        // Invariant 5. An agent is always identified as an agent, including here.
        : { value: 'Automated', tone: 'warn' as const, sub: 'agent · not a human' }
  );
  let configured = $state(false);
  /**
   * Where the watch is heard, in relays, before anybody relies on it [relay-lists §7, invariant 9].
   * Aged on screen as the reading is: a relay whose last state goes past five minutes stops
   * counting while the screen is open, not only when something new arrives.
   */
  let nowMs = $state(Date.now());
  const heardNow = $derived(heard.now(nowMs));
  /**
   * Who may end a `Distress` sent to this phone's watch [G3]. `attributed` false is a box handed
   * over before it named its escalation key: on it, an answer the agent beside it sent cannot be
   * told from a person's, and this screen says so.
   */
  let closure = $state<DistressClosure | null>(null);
  /** A backup named a watch and the operator has not yet added or forgotten it. */
  let offered = $state(false);
  let identity = $state<ReturnType<typeof loadIdentity>>(null);
  /** The operator's own person, by name: who a Distress reaches when no watch does [contact.ts]. */
  let person = $state<string | null>(null);
  /** A mission somebody left to take a callsign: once they have one, the way back is the lit action. */
  let leftMission = $state<PendingMission | null>(null);
  let damaged = $state(false);
  /** The `20911` this device was paged about, if it arrived through a notification. */
  let ackId = $state<string | null>(null);
  let acking = $state(false);
  let ackDone = $state(false);
  let ackFailed = $state<string | null>(null);

  /**
   * Sends *"I have this."* -- the only thing that stops the escalation ladder.
   *
   * **Only ever from a tap.** A delivery receipt, a read receipt or an app-open must never be
   * routed here [signals.spec]: somebody whose phone buzzed is not somebody who woke up.
   *
   * A failure is said out loud rather than swallowed. The ladder keeps paging either way, but
   * the person standing here has to know their ack did not land, because the alternative is
   * believing they have handled something they have not.
   */
  async function acknowledge() {
    if (!ackId || acking) return;
    acking = true;
    ackFailed = null;
    try {
      await operator.acknowledge(ackId);
      ackDone = true;
    } catch (err) {
      ackFailed = err instanceof Error ? err.message : 'It did not send.';
    } finally {
      acking = false;
    }
  }
  /**
   * Lines jotted at a door that have not become corrections yet.
   *
   * `notes.ts` designs this as *capture cold, correct warm* — jot it in the rain, fix it
   * somewhere with light and both hands. The cold half shipped and the warm half had no
   * prompt: `notes()` was read by exactly one screen, the region page where the note was
   * written, so an operator had to remember unaided that they had anything waiting.
   *
   * A count, not a nudge. Nothing here chases it, nothing counts a streak, and it goes
   * away by being acted on rather than by being dismissed.
   */
  let waiting = $state(0);
  /**
   * The notes themselves, not just how many.
   *
   * This screen said "N waiting — jotted, not yet corrections" and gave no way to reach any
   * of them. An operator had to remember which of sixty-eight areas each note was about,
   * open the directory and find the record from memory — so the note stayed a note. The
   * whole published directory holds **one** `in_person` check, and this is one reason why.
   */
  let jotted = $state<{ id: string; region?: string; name?: string }[]>([]);

  /** What this screen reads from tonight's storage: the mission somebody left, and the lines jotted. */
  function tonight() {
    leftMission = pendingMission();
    const all = notes();
    waiting = Object.keys(all).length;
    jotted = Object.entries(all).map(([id, n]) => ({
      id,
      ...(n.region ? { region: n.region } : {}),
      ...(n.name ? { name: n.name } : {})
    }));
  }

  let { data } = $props();
  /*
   * Read once on mount rather than derived, and deliberately not during prerender: at build
   * time `Date.now()` *is* the stamp, so a derived version would compute a meaningless
   * "healthy" on the server and bake it into HTML every device then shares. A wrong clock is
   * a fact about one phone.
   */
  let clock = $state<ClockRead>({ behind: false, behindSeconds: 0, behindDays: 0 });

  onMount(() => {
    // Removed before `identity` is assigned, so the pre-hydration link and the real Action are
    // never both on screen: this runs synchronously and Svelte applies the `{#if identity}`
    // update after.
    document.getElementById('distress-early')?.remove();
    /*
     * A Distress this device was paged about, carried in the URL the notification opened.
     *
     * It cannot come from anywhere else. `20911` is ephemeral, so a relay forwards it to
     * whoever is subscribed at that instant and stores nothing -- a phone that was asleep when
     * it fired and woke on the page finds the event gone [2.5].
     *
     * Validated as a 64-character hex id before it is shown, because a query parameter is
     * attacker-controlled by definition: anybody can send somebody a link.
     */
    const q = new URLSearchParams(location.search).get('ack');
    if (q && /^[0-9a-f]{64}$/.test(q)) ackId = q;
    clock = readClock(data?.built, Date.now());
    configured = loadConfig() !== null;
    closure = watchClosure();
    stranded = configured ? null : storedWatch();
    offered = !configured && !stranded && offeredWatch() !== null;
    identity = loadIdentity();
    person = loadContact()?.label ?? null;
    damaged = corruptTiers().length > 0;
    tonight();
    /*
     * A wipe in another tab took what `tonight` read, and this tab's way back to a mission with it
     * (`storage.ts`): read again, so this screen does not go on offering "Back to" a mission by name,
     * or the lines jotted tonight, on a phone just wiped.
     */
    const unwiped = onWipe(tonight);
    void offline.checkShell();
    watch.start();
    presence.start();
    void battery.start();
    pq.start();
    // Withdrawals of credentials this operator holds. Started here rather than on the
    // standing screen, because a holder who never opens that screen must still stop relying
    // on an endorsement somebody has taken back — `can take watch` is a gate.
    standing.start();
    // The watch's *"you are past the time you gave"*. The only thing it sends unasked, and
    // it arrives silently -- started here because Status is the screen an operator opens,
    // and a nudge nothing renders is a nudge nobody can reach.
    overdue.start();
    const aging = setInterval(() => (nowMs = Date.now()), 15_000);
    return () => {
      unwiped();
      clearInterval(aging);
      pq.stop();
      watch.stop();
      presence.stop();
      standing.stop();
      // Signed on, it goes on listening on every screen [session `signOn`]; only off patrol does
      // leaving Status end it.
      if (!operator.session) overdue.stop();
    };
  });

  /**
   * Who has not published a key, **by name**.
   *
   * It said *"2 people you send to"*, and this project's own rule is provenance by name:
   * *"an operator being told '2 on-call' learns less than one told 'Wren and Raven'"*. Here
   * the count is worse than uninformative — the whole sentence asks the operator to get
   * somebody to open the app, and a number does not say who to ask.
   *
   * `pq` returns pubkeys and knows nothing about naming, which is the right split. The peer
   * list is where names live, so the resolution happens here.
   */
  const uncoveredNames = $derived.by(() => {
    const mine = peers();
    const watchKeys = new Set(
      [loadConfig()?.pubkey, ...(loadConfig()?.holders ?? [])].filter(Boolean) as string[]
    );
    const names = pq.uncovered().map((key) => {
      const peer = mine.find((p) => p.pubkey === key);
      if (peer) return peer.callsign;
      // Not somebody this operator named, so say what it is rather than showing a key.
      return watchKeys.has(key) ? 'the watch' : key.slice(0, 8);
    });

    if (names.length === 0) return '';
    if (names.length === 1) return names[0];
    return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  });

  const session = $derived(operator.session);

  /*
   * The post you hold, which is what the panel opens onto [docs/design/panel.md P1].
   *
   * Not the same question as what the watch is doing — that has its own slot. This is what
   * *you* are doing, and it decides which single action is lit. `Ready` rather than `Alone`
   * because Alone describes the watch behind you rather than the post you hold, and it reads
   * as a deficiency in a place where the brief is emphatic that it is not one.
   */
  const post = $derived(
    !identity
      ? { id: 'none', label: 'No profile' }
      : session
        ? { id: 'out', label: 'Out' }
        : { id: 'ready', label: 'Ready' }
  );

  /** Peers, in the shape the floor renders. Names, never a count. */
  const peerRows = $derived([
    ...presence.out.map((p) => ({
      operator: p.pubkey,
      callsign: p.callsign,
      area: p.payload.area ?? '',
      status: presence.stateOf(p) === 'overdue' ? 'overdue' : 'out',
      note: presence.stateOf(p) === 'overdue' ? 'is past the time they gave' : 'is out',
      /*
       * Where they shared they are, which sign-on tells them their peers see (2026-11-02): a team
       * lead could see their team was out and not where. Read as untrusted, and only while they are
       * heard: a peer holds where you are, never where you were.
       */
      pin: isValidPosition(p.payload.position)
        ? { href: mapLink(p.payload.position), label: `Map · ${within(p.payload.position)} · ${fixAge(p.heard, Math.floor(Date.now() / 1000))}` }
        : null
    })),
    ...presence.unknown.map((p) => ({
      operator: p.pubkey,
      callsign: p.callsign,
      // Named rather than hidden. Leaving them off would read as "not out", which is a claim
      // nobody made.
      area: '',
      status: 'unknown',
      note: 'nothing heard'
    }))
  ]);
  /** Which passed-on Assist this operator said they can go to, by when it arrived. */
  let goingFor = $state<number | null>(null);
  async function canGo() {
    const heardAt = passedOn.at;
    if (!passedOn.text) return;
    await operator.canGo(`I can go: ${passedOn.text}`);
    if (!operator.error) goingFor = heardAt;
  }
  let closing = $state(false);
  let note = $state('');
  let cameHome = $state<
    { at: number; by: string | null; started: number | null; area: string | null } | null
  >(null);

  async function home() {
    /*
     * The night's line, kept so the close can show it.
     *
     * `positioning.md` names this as a thing operators need and the genre almost never shows:
     * *"coming home and being counted."* Standing down ended a patrol and said the time. What
     * an operator actually gets out of it is the line in their own record — how long they were
     * out, where, and whether anybody had them.
     */
    const started = session?.at ?? null;
    const area = session?.area ?? null;
    const by = await operator.standDown(note);
    cameHome = { at: Date.now(), by: by ?? null, started, area };
    closing = false;
    note = '';
  }

  /** Whole minutes remaining. Negative reads as over, not as a smaller number. */
  const remaining = $derived.by(() => {
    if (!session) return null;
    return Math.round((session.expectedUntil - Date.now() / 1000) / 60);
  });

  const LABEL = {
    station: 'On station',
    'automated-oncall': 'Automated · on-call',
    automated: 'Automated',
    dark: 'Dark'
  } as const;

  // Each state gets its own colour. Sharing one would make two different situations look
  // the same at a glance, which is the only glance an operator gets.
  const TONE = {
    station: 'var(--t-station)',
    'automated-oncall': 'var(--t-oncall)',
    automated: 'var(--t-auto)',
    dark: 'var(--t-dark)'
  } as const;
</script>

<svelte:head>
  <title>Status · Field Terminal</title>
  <meta name="description" content="What is actually behind you before you go out." />
</svelte:head>

<header>
  <span class="eyebrow">Field Terminal</span>
  <h1>Status</h1>
</header>

{#if clock.behind}
  <!--
    Above everything, including the watch's own alarms, because it changes what every age
    below MEANS. The panel under it is an account measured in ages, and this says the thing
    doing the measuring is broken.

    It is shown only when the clock is *provably* wrong -- earlier than the build it is
    running, which a phone cannot honestly be. Nothing here is ever shown for a clock that
    has merely not been checked, because there is no way to check one and a warning nobody
    can act on is the alarm fatigue this project spends everything else avoiding.
  -->
  <section class="nc-panel" data-clock-behind>
    <header class="nc-panel-head">
      <span>This phone</span>
      <span class="nc-panel-post">Clock is wrong</span>
    </header>
    <div class="nc-panel-slots">
      <Slot k="Behind by">
        <Readout
          value={clock.behindDays > 0 ? `${clock.behindDays} days` : 'under a day'}
          tone="alarm"
          sub="measured against this build, not a server"
        />
      </Slot>
      <p class="cost">Turn on automatic date and time. Ages shown here are wrong until you do.</p>
    </div>
  </section>
{/if}

{#if watch.alarms.length > 0}
  <!--
    Above the panel, because it changes what the panel MEANS. Everything below is the watch's
    account of itself, and this says that account has contradicted itself.

    One of the two states permitted the alarm channel [rule 7]: a watch that is lying about
    itself. The other is Distress.
  -->
  <section class="nc-panel" data-root-alarm={watch.alarms.at(-1)?.kind}>
    <header class="nc-panel-head">
      <span>This watch</span>
      <span class="nc-panel-post">Contradicted itself</span>
    </header>
    <div class="nc-panel-slots">
      {#each watch.alarms.slice(-3) as a, i (i)}
        <Slot k={a.kind === 'diverged' ? 'Log' : a.kind === 'shrank' ? 'Log' : 'Log'}>
          {#if a.kind === 'diverged'}
            <Readout value="Rewritten" tone="alarm" sub="two accounts at {a.was.size} entries" />
          {:else if a.kind === 'shrank'}
            <Readout value="Shrank" tone="alarm" sub="{a.was.size} → {a.now.size} entries" />
          {:else}
            <Readout value="Stopped" tone="alarm" sub="was committing, no longer" />
          {/if}
        </Slot>
      {/each}
      <p class="cost">This device keeps the record. Signing on under this watch is your call.</p>
    </div>
  </section>
{/if}

<!--
  The one screen that must work when everything else is down, as one panel.

  Rule 4: the same facts in the same slots every time, so an operator learns the position and
  stops reading. Rule 5: one lit action. Rule 3: every sentence that used to be on this screen
  is still here, word for word, behind `Why`.
-->
<!--
  Above the Status panel, not below it, and the move is the whole of the fix.

  Measured against the built site: at 375x667 this sat at 831-887px — **220px below the fold**,
  reachable only by scrolling for it. At 393x851 it was clipped by 13px. It was fully visible
  only on a 6.7" screen, and the stated device floor is a prepaid Android 8, which is a small
  phone. The alarm was legible on the flagship and off-screen on the target.

  Thumb reach was never the problem — 28-44mm from the pivot, comfortably easy for either hand
  on all three sizes. A control placed perfectly inside the thumb arc is worth nothing when it
  is not on the screen. It sat at the end of the document because that is the order it was
  written in, and nothing measured it until something did.

  Placed after the two conditional panels above, deliberately: a wrong clock and a rewritten
  log are things to *read* before trusting anything here, and Distress is the thing to *do*.
  On an ordinary night neither of those renders and this is the first element on the page.
-->
<!--
  Distress is not the lit action and it is not on the rail.

  It sits on its own in every state, because needing help does not wait for paperwork and
  because with no watch it terminates in the operator's own person — which `contact.ts` calls
  "not the third rung of anything. It is the whole safety net."
-->
<!--
  The same control, twice, and only ever one of them on screen.

  This one is prerendered and hidden, and a script `hooks.server.ts` puts inside it reveals it
  as it is parsed, before the bundle loads, if this device has an identity. The one below is the real `Action` and replaces it on
  mount. Without the pair, the most urgent control in the app was behind roughly three seconds
  of hydration on the phone this app is written for — while `hooks.server.ts` already existed
  to solve exactly that problem one screen deeper.

  Markup matched to `Action`'s own output so the swap is invisible.
-->
<div id="distress-early" hidden>
  <a class="nc-act" data-act data-tone="alarm" href="/terminal/distress/">
    <span class="nc-act-label">Distress</span>
  </a>
</div>

{#if identity}
  <Action label="Distress" tone="alarm" href="/terminal/distress/" />
{/if}

<Panel label="Status" post={post.label} data-state={s.state} data-post={post.id}>
  <!-- Rule 5. One lit action, and it is the thing this post actually does. -->
  {#snippet action()}
    <!--
      Rule 5 says one lit action, and an acknowledgement outranks every other thing this
      screen offers: somebody raised a Distress and is waiting on this tap. It is shown before
      sign-on and before check-in for that reason, and it disappears once it has been sent.
    -->
    {#if ackId && !ackDone}
      <!-- Wrapped only to give this one control a selector of its own; `Action` takes no
           arbitrary attributes, and a test that matched on tone would also match Distress. -->
      <span data-ack>
        <Action
          label={acking ? '…' : 'I have this'}
          tone="alarm"
          disabled={acking}
          onfire={acknowledge}
        />
      </span>
    {:else if !identity}
      <Action label="Create your profile" tone="warn" href="/terminal/setup/" />
    {:else if leftMission && !session}
      <!-- They came here to take part in a mission, not to go out: that is the thing this post does now. -->
      <span data-back-to-mission data-sveltekit-reload>
        <Action label={backTo(leftMission)} tone="warn" href="/" />
      </span>
    {:else if session}
      <Action
        label={operator.busy ? '…' : 'Check in'}
        tone="warn"
        disabled={operator.busy}
        onfire={() => operator.routine()}
      />
    {:else}
      <Action label="Sign on" tone="warn" href="/terminal/sign-on/" />
    {/if}
  {/snippet}

    {#if ackId}
      <!--
        The outcome, said plainly. An ack that did not land must never look like one that did:
        the ladder keeps paging either way, but somebody who believes they have handled this
        will stop looking for another way to reach the operator.
      -->
      {#if ackDone}
        <!--
          "The watch has been told you have this" was more than a relay accepting it proves: the
          watch refuses an acknowledgement from a key that is not on its on-call list, and says
          so only in its own log.
        -->
        <p class="cost" data-ack-sent>
          <strong>Sent to a relay.</strong> It counts only if this key is on the watch's on-call
          list.
        </p>
      {:else if ackFailed}
        <p class="cost" data-ack-failed>
          <strong>It did not send — {ackFailed}</strong> Nobody has been told you have this.
          Reach the operator another way, and try again when you have signal.
        </p>
      {:else}
        <p class="cost" data-ack-pending>
          An operator raised a <strong>Distress</strong> and is waiting for a human. If this key
          is on the watch's on-call list, tapping tells them a human has it and stops the ladder
          going any further.
        </p>
      {/if}
    {/if}

    <div data-capability>
      <Slot k="Watch">
        <Readout value={watchRead.value} tone={watchRead.tone} sub={watchRead.sub} />
      </Slot>
      <Slot k="Distress">
        <!-- Read as sign-on reads it [distress-read.ts]. "No addressee" said the first was false
             while a holder read the board [journey, 2026-10-28], and to an operator whose own
             person is the whole safety net. -->
        {@const d = distressRead({ reachable: reachable.length, configured, station: s.state === 'station', person })}
        <Readout value={d.value} tone={d.tone} sub={d.sub} />
      </Slot>
      {#if reachable.length > 0}
        <Slot k="On call">
          <Readout
            value={reachable.join(', ')} verbatim
            tone="neutral"
            sub={reachable.length === 1 ? 'sole — ladder ends here' : null}
          />
        </Slot>
      {:else}
        <Slot k="On call" />
      {/if}
      {#each refusingNow(nowMs) as r (r.url)}
        <!-- A relay refusing this phone for volume [refusing]: the beats hold off it, a Distress does not. -->
        <Slot k="Relay">
          <span data-refusing={r.url}>
            <Readout
              value={hostOf(r.url)}
              verbatim
              tone="warn"
              sub={`${r.why === 'banned' ? 'banned this address' : 'rate-limited'} · routine updates held off until ${new Date(r.until).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`}
            />
          </span>
        </Slot>
      {/each}
      {#if refusingNow(nowMs).length > 0}
        <p class="cost">Distress still goes to it. Switching between Wi-Fi and mobile data usually clears it.</p>
      {/if}
      {#if configured && closure && !closure.attributed}
        <Slot k="Escalation key">
          <span data-escalation-key="none">
            <Readout value="Not named" tone="warn" sub="a person’s answer cannot be told from the agent’s" />
          </span>
        </Slot>
      {/if}
      <!-- Only for a watch this page can send to. Alone shows nothing, and a stranded watch is
           already explained: neither is a count of relays waiting to be filled in. -->
      {#if configured}
        <HeardSlot heard={heardNow} {nowMs} />
      {/if}

      {#if !identity}
        <!-- The two other ways in, as links: a profile is the button above. Nothing else said. -->
        <p class="nc-first" data-first-run>
          <a href="/terminal/backup/#restore" data-restore-link>Sign in with a backup</a>
          <span aria-hidden="true">·</span>
          <a href="/terminal/directory/">Cached directory</a>
        </p>
      {/if}
      {#if identity && !configured && !stranded && !offered && !person}
        <p class="nc-first"><a href="/terminal/setup/#person" data-person-link>Add someone to call</a></p>
      {/if}
      <!-- Open on its own only when something is wrong; otherwise the readouts above say it. -->
      <Why open={!!stranded || !!offered || (configured && watch.read.reason !== null)}>
        {#if configured && closure && !closure.attributed}
          <p data-escalation-key-why>This watch doesn't name its escalation key yet. Ask whoever runs it for a new watch code.</p>
        {/if}
        {#if !stranded}
          <p>{capabilitySentence(s, nowS)}</p>
        {/if}
        {#if configured}
          <HeardWhy heard={heardNow} />
        {/if}
        {#if leaked.length > 0 && identity}<p data-sealed-exposed>{leaked.join(' ')}</p>{/if}

        {#if stranded}
          <div data-watch-unreachable>
            <h2>Can't reach your watch</h2>
            <p>Fix its relays in <a href="/terminal/setup/#relays">your profile</a>.</p>
            <ul class="refused">
              {#each stranded.refused as r, i (i)}<li>{r.why}</li>{:else}<li>No relay is saved with it.</li>{/each}
            </ul>
          </div>
        {:else if !configured && identity && offered}
          <h2 data-watch-offered>Your backup named a watch</h2>
          <p><a href="/terminal/backup/">Add it or forget it</a></p>
        {:else if configured && watch.read.reason === 'clock'}
          <h2 data-clock-skew>This phone's clock is wrong</h2>
          <p>Turn on automatic date and time.</p>
        {:else if configured && watch.read.reason === 'stale'}
          <h2>Last word was {watch.read.ageSeconds ?? '?'}s ago</h2>
          <p>Check your signal and your phone's clock.</p>
        {:else if configured && watch.read.reason === 'absent' && watch.unanswered}
          <div data-watch-unanswered>
            <h2>Can't reach the watch</h2>
            <p>Usually the signal. Distress keeps trying.</p>
          </div>
        {:else if configured && watch.read.reason === 'absent'}
          <div data-watch-absent>
            <h2>Nothing from this watch</h2>
            <p>Check its relays with whoever gave it to you.</p>
          </div>
        {:else if watch.read.reason === 'corrupt'}
          <div data-watch-corrupt>
            <h2>Can't read this watch</h2>
            <p>Reopen with a signal to update. If that doesn't help, tell whoever holds the watch.</p>
          </div>
        {/if}
      </Why>
    </div>

    {#if session}
      <!-- What the board believes about you, so a wrong entry is visible here. -->
      <div data-station>
        <Slot k="Area"><Readout value={session.area} verbatim tone="neutral" /></Slot>
        {#if session.team}<Slot k="Team"><Readout value={session.team} verbatim tone="neutral" /></Slot>{/if}
        <Slot k="Check in">
          {#if operator.heldCheckIn !== null}
            <!-- Pressed where nothing took it: it goes by itself, stamped when it was pressed. -->
            <span data-check-in-held>
              <Readout value="Waiting for signal" tone="warn" sub={`pressed ${new Date(operator.heldCheckIn * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}; it goes by itself`} />
            </span>
          {:else if overdue.flagged}
            <!--
              The watch has actually said it, so this stops being the device's own arithmetic
              and becomes a thing somebody sent. It is the only unasked message NavCom
              delivers, it made no sound arriving, and it is not an alarm: being late is
              ordinary, nothing else was told, and nothing escalates [invariant 3].
            -->
            <span data-nudged>
              <Readout
                value="The watch nudged"
                tone="warn"
                sub="check in if you are still out, or stand down"
              />
            </span>
          {:else if remaining !== null && remaining > 0}
            <Readout value="{remaining} min left" tone="good" sub="of what you declared" />
          {:else}
            <!--
              "The watch will nudge" was promised with no check that a watch exists. A box nudges on
              its own; a watch held on phones only when its holder asks (2026-11-02), so "may".
            -->
            <Readout
              value="Past declared"
              tone="warn"
              sub={operator.hasWatch ? 'a watch may nudge, nothing more' : 'nothing will nudge you'}
            />
          {/if}
        </Slot>
        {#if operator.asked}
          <!-- A question or an Assist a person is answering: the answer is on its own screen. -->
          <Slot k="Asked">
            <span data-asked-status>
              {#if operator.lastResponse}
                <a href="/terminal/{operator.asked.type}/"><Readout value="Answered" tone="good" sub={operator.lastResponse.responder?.callsign ?? null} /></a>
              {:else if operator.asked.gaveUp}
                <Readout value="No answer heard" tone="warn" sub="it may have come while you had no signal" />
                <button type="button" data-ask-again disabled={operator.busy} onclick={() => operator.askAgain()}>Ask again</button>
              {:else}
                <Readout value="Waiting for the watch" tone="neutral" sub={`${ago(Math.floor(nowMs / 1000) - operator.asked.at)} so far`} />
              {/if}
            </span>
          </Slot>
        {/if}
        {#if notice.text}
          <!--
            What the watch told everybody out: what is happening, arrived silently, with nothing to
            accept or answer. Putting it down tells nobody anything [invariant 8].
          -->
          <Slot k="Watch says">
            <span data-notice>
              <Readout value={notice.by ?? 'Watch'} verbatim tone={notice.at && Math.floor(nowMs / 1000) - notice.at > 3600 ? 'cold' : 'neutral'} sub={notice.at ? `${ago(Math.floor(nowMs / 1000) - notice.at)} ago` : null} />
            </span>
          </Slot>
          <p class="said" data-notice-text>{notice.text}</p>
          <div class="passed-acts">
            <button type="button" onclick={() => notice.clear()}>Put down</button>
          </div>
        {/if}
        {#if passedOn.text}
          <!--
            Somebody's Assist, passed on by the watch: an offer, arrived silently. Taking it up is a
            question back to the watch; putting it down tells nobody anything [invariant 8].
          -->
          <Slot k="Passed on">
            <span data-passed-on>
              <Readout value={passedOn.by ?? 'Watch'} verbatim tone="neutral" sub={passedOn.at ? `${ago(Math.floor(nowMs / 1000) - passedOn.at)} ago` : null} />
            </span>
          </Slot>
          <p class="said" data-passed-on-text>{passedOn.text}</p>
          <div class="passed-acts">
            <!--
              Taking it up in one tap: the operator's own question back to the watch, saying they can
              go and to what, which the watch answers like any other (2026-11-02). Their act, never
              assumed: nothing else here says they are going.
            -->
            {#if goingFor === passedOn.at}
              <span data-going><Readout value="Told the watch" tone="neutral" sub="you can go" /></span>
            {:else}
              <button type="button" data-can-go disabled={operator.busy} onclick={canGo}>I can go</button>
            {/if}
            <a href="/terminal/query/">Answer the watch</a>
            <button type="button" onclick={() => passedOn.clear()}>Put down</button>
          </div>
        {/if}
        {#if position.live}
          <!--
            Unmissable while it is live, for the same reason a phone shows the location arrow.
            Somebody who forgot they turned this on should find out by looking at the screen.
          -->
          <Slot k="Position">
            <span data-sharing>
              <Readout
                value="Sharing"
                tone="warn"
                sub="{position.current?.precision_m
                  ? `about ${position.current.precision_m}m`
                  : 'exactly'} · watch and peers only"
              />
            </span>
          </Slot>
        {:else if position.denied}
          <Slot k="Position">
            <Readout value="Refused" tone="warn" sub="check this phone's location permission" />
          </Slot>
        {:else if position.unavailable}
          <Slot k="Position">
            <Readout value="No fix" tone="warn" sub="weak signal or indoors — not a permission problem" />
          </Slot>
        {/if}
        <Why summary="At sign-on">
          <p>{session.toldAtSignOn}</p>
        </Why>
      </div>
    {/if}

    {#if battery.low}
      <!--
        Told to the operator, published to nobody. A battery level on the heartbeat would let a
        peer read somebody's silence as alarming or as fine, and that is a conclusion drawn from
        an absence [invariant 3].
      -->
      <Slot k="Battery">
        <span data-battery>
          <Readout value="{battery.percent}%" tone="warn" sub="low — when it dies you stop sending" />
        </span>
      </Slot>
    {/if}

    {#if identity && pq.uncovered().length > 0}
      <!--
        Deliberately a note, not a warning. The message is encrypted and nobody can read it
        today; what is missing is cover against somebody storing tonight's traffic to open in
        fifteen years, and that is a sentence rather than a label.
      -->
      <Slot k="Cover">
        <Readout value="Classical only" tone="cold" sub="not quantum-covered" />
      </Slot>
    {/if}

    {#if offline.shellGaps && offline.shellGaps.length > 0}
      <Slot k="Offline">
        <span data-shell-gaps>
          <Readout value="Incomplete" tone="warn" sub="parts may need a connection" />
        </span>
      </Slot>
    {/if}

    {#if waiting > 0}
      <!--
        The warm half of capture-cold-correct-warm. A place you learned something about is
        still only a line on this phone until it becomes a correction somebody else can read.
      -->
      <Slot k="Field notes">
        <span data-notes-waiting>
          <Readout
            value="{waiting} waiting"
            tone="cold"
            sub="jotted, not yet corrections"
          />
        </span>
      </Slot>
    {/if}

    {#if damaged}
      <Slot k="Storage">
        <span data-damaged>
          <Readout value="Damaged" tone="alarm" sub="the unreadable copy is kept" />
        </span>
      </Slot>
    {/if}

    {#if identity && (pq.uncovered().length > 0 || (offline.shellGaps && offline.shellGaps.length > 0) || damaged)}
      <Why summary="About this device" open>
        {#if pq.uncovered().length > 0}
          <p class="cover">Not yet post-quantum: {uncoveredNames} need to open the app once.</p>
        {/if}
        {#if offline.shellGaps && offline.shellGaps.length > 0}
          <p>Parts of the app didn't save for offline. Reopen on a good signal.</p>
        {/if}
        {#if damaged}
          <p>Saved data couldn't be read. The damaged copy is kept: don't clear this site's data.</p>
        {/if}
      </Why>
    {/if}

  {#if operator.error}
    <Slot k="Last action">
      <Readout value="Failed" tone="alarm" />
      <Why summary="What went wrong"><p class="error">{operator.error}</p></Why>
    </Slot>
  {/if}
</Panel>

{#if jotted.length > 0}
  <!--
    The way back, which did not exist.
    "Capture cold, correct warm" is the whole design of a note: you write it at a door with
    gloves on and turn it into a correction somewhere with light. The second half needed the
    operator to remember which area the place was in, and this is what they get instead.

    A list, not a task. Nothing here counts anything, nothing chases, and ignoring it costs
    nothing — the note keeps until a panic wipe, and it was always only for them anyway.

    Names, not the note's own text: this is the screen most likely to be read over a
    shoulder, and the note is the riskiest free text in the system by its own account.
  -->
  <section class="nc-panel" data-notes-open>
    <header class="nc-panel-head">
      <span>Notes waiting</span>
    </header>
    <div class="nc-panel-slots">
      <p class="cost">
        Lines you wrote at a door. They are still <strong>only on this phone</strong> — a
        correction is what reaches whoever gets there next.
      </p>
      <ul class="jotted">
        {#each jotted as n (n.id)}
          <li>
            {#if n.region}
              <a href="/terminal/directory/{n.region}/">{n.name ?? n.id}</a>
            {:else}
              <!-- Written before a note carried its area. Still readable, still promotable,
                   and honest that this one takes a look through the directory. -->
              <span>{n.name ?? n.id}</span>
              <span class="opt">— written before notes carried their area;
                <a href="/terminal/directory/">find it in the directory</a></span>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  </section>
{/if}


{#if session}
  <nav class="nc-rail" data-rail="out" aria-label="While out">
    <!-- Both go only to a watch: with none at all they would reach nobody. A watch this page
         cannot reach keeps them, and the panel says why nothing gets through. -->
    {#if configured || stranded}
      <a href="/terminal/query/">Query</a>
      <a href="/terminal/assist/">Assist</a>
    {/if}
    <button onclick={() => (closing = true)} disabled={operator.busy}>Stand down</button>
  </nav>
{/if}

{#if closing}
  <!--
    Coming home. The close of the night, and the only place the operator gets to say anything
    in their own words about it — everything else in this app is a fixed shape.
  -->
  <section class="nc-panel closing">
    <header class="nc-panel-head">
      <span>Coming home</span>
    </header>
    <div class="nc-panel-slots">
      <label for="note">Anything worth remembering <span class="opt">optional</span></label>
      <textarea id="note" bind:value={note} placeholder="quiet night, two handouts at the underpass"></textarea>
      <nav class="nc-rail">
        <button onclick={() => (closing = false)}>Not yet</button>
      </nav>
    </div>
    <div class="nc-panel-act">
      <Action
        label={operator.busy ? 'Standing down…' : "I'm home"}
        tone="warn"
        disabled={operator.busy}
        onfire={home}
      />
    </div>
  </section>
{/if}

{#if cameHome}
  <!--
    Confirmed by name where somebody was watching, and confirmed anyway where nobody was. The
    close of the night is not conditional on an audience.
  -->
  <section class="nc-panel" data-came-home>
    <header class="nc-panel-head">
      <span>Tonight</span>
      <span class="nc-panel-post">Closed</span>
    </header>
    <div class="nc-panel-slots">
      <!--
        The line that was written, shown where it was written.

        `positioning.md` names this as the thing the genre almost never shows and that may
        matter most: *"coming home and being counted."* Standing down said the time and nothing
        else. What an operator has afterwards is a record under their own callsign, and this is
        the moment to show it to them.

        It does **not** claim the record is provable. Inclusion proofs have not shipped —
        `log.ts` says so — and a receipt that overstated what it was would be the one thing this
        screen must never be.
      -->
      <Slot k="Home">
        <Readout
          value={new Date(cameHome.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          tone="good"
          sub={cameHome.by ? `${cameHome.by} has you home` : 'nobody confirmed it, and it still counts'}
        />
      </Slot>
      {#if cameHome.started !== null}
        <Slot k="Out for">
          <Readout
            value={formatDuration(Math.max(0, Math.floor(cameHome.at / 1000) - cameHome.started))}
            tone="neutral"
            sub={cameHome.area ?? null}
          />
        </Slot>
      {/if}
      <Slot k="Written">
        <Readout value="Your record" tone="neutral" sub="on this phone, under your callsign" />
      </Slot>
      {#if waiting > 0}
        <!--
          The warm half, at the moment `notes.ts` designs it for.

          *"Capture cold, correct warm — jot the line now; turn it into a correction when you
          are somewhere with light and both hands."* Coming home **is** that moment, and until
          now nothing said so: the only screen that ever read `notes()` was the region page
          where the note was written, so the warm half depended on the operator remembering
          unaided.

          Placed here rather than mid-patrol on purpose. A line you jotted at a door is worth
          nothing to the next operator until somebody turns it into a correction, and asking
          for that while somebody is still out would be the app tasking them.
        -->
        <Slot k="Learned">
          <span data-notes-home>
            <Readout
              value="{waiting} note{waiting === 1 ? '' : 's'}"
              tone="warn"
              sub="only on this phone until you correct the record"
            />
          </span>
        </Slot>
      {/if}
      <p class="cost">
        <a href="/terminal/patrols/">Your record</a>{#if waiting > 0} · <a href="/terminal/directory/">turn your notes into corrections</a>{/if}
      </p>
    </div>
  </section>
{/if}

{#if presence.out.length > 0 || presence.unknown.length > 0}
  <!--
    Peers, with no watch anywhere in the path. Each device drew this itself from what it could
    decrypt; nothing holds it and nothing persists it.
  -->
  <section class="nc-panel" data-peers>
    <header class="nc-panel-head">
      <span>Your peers</span>
    </header>
    <div class="nc-panel-slots">
      <Board entries={peerRows} empty="No contact" />
      {#if presence.unknown.length > 0}<p class="cost">Not heard isn't the same as home.</p>{/if}
      {#if presence.watchingYou.length > 0}
        <!--
          Only what somebody actually said. Never inferred from you watching them — two people
          can each assume the other is keeping an eye out, and assuming symmetry nobody agreed
          to is exactly how somebody ends up watched by nobody.
        -->
        <Slot k="Watching">
          <span data-watching-you>
            <Readout
              value={presence.watchingYou.join(', ')} verbatim
              tone="good"
              sub="{presence.watchingYou.length === 1 ? 'is' : 'are'} watching for you tonight"
            />
          </span>
        </Slot>
      {/if}
    </div>
  </section>
{/if}

<!-- Everything that is not the lit action. Two taps from anywhere, and not a button large
     enough to hit while putting the phone in a pocket. The map comes first and is prerendered,
     callsign or none: missions are what the app is for, and an installed app has no address bar
     to find it with [finding 35]. -->
<!--
  Where to go, the four a newcomer goes to first, ahead of the rest: fifteen tiles of one weight
  said nothing about what comes next after a callsign [journey, 2026-10-28]. The rest keep their
  places, in the order an operator reaches for them.
-->
<nav class="nc-rail" data-rail="all" aria-label="Places">
  <a class="nc-lead" href="/" data-sveltekit-reload data-map-link>Missions and the map</a>
  <!-- Before a callsign too: a first night alone is what it is for. -->
  <a class="nc-lead" href="/terminal/playbook/" data-playbook-link>Playbook</a>
  {#if identity}
    <a class="nc-lead" href="/terminal/card/">Your card</a>
    <a class="nc-lead" href="/terminal/peers/">Peers</a>
    <a class="nc-lead" href="/terminal/map/" data-live-map-link>Map</a>
    <a class="nc-lead" href="/terminal/directory/">Cached directory</a>
    <a href="/terminal/patrols/">Your patrols</a>
    <a href="/terminal/watch/">Watch</a>
    <a href="/terminal/standing/">Standing</a>
    <a href="/terminal/backup/">Backup</a>
    <a href="/terminal/setup/">Setup</a>
    <a href="/terminal/on-call/">On call</a>
    <a href="/terminal/log/">What the watch wrote</a>
    <a href="/terminal/resupply/">Resupply</a>
    <a href="/terminal/funding/">Support</a>
    <a href="/terminal/wipe/">Wipe this device</a>
  {/if}
</nav>

<!--
  One door out, and the only unconditional one on this screen.

  The terminal is a closed world: no screen in it links to the public site, to the docs, or to
  the directory that needs no JavaScript. That is fine until the bundle is the thing going
  wrong — and then the fallback that always works is unreachable from the place you would look
  for it.

  Prerendered and outside every `{#if}` on purpose. A link that only appears once the app has
  hydrated is no use to somebody whose app will not hydrate.
-->
<section class="nc-panel" data-static-fallback>
  <header class="nc-panel-head">
    <span>If this will not load</span>
  </header>
  <div class="nc-panel-slots">
    <p class="cost"><a href="/directory/">The plain directory</a> works without this app.</p>
  </div>
</section>

<style>
  .closing { border: 2px solid var(--t-line-strong); padding: 1rem 1.1rem; gap: .5rem; }
  /* Logical, not physical: `rtl.test.ts` fails a stylesheet that would indent the wrong
     side in a right-to-left language, and 8.2 puts a second one in scope. */
  .jotted { margin: .4rem 0 0; padding-inline-start: 1.1rem; display: grid; gap: .35rem; }
  .refused { margin: .2rem 0 0; padding-inline-start: 1.1rem; display: grid; gap: .3rem; overflow-wrap: anywhere; }
  .jotted li { line-height: 1.4; }
  .closing textarea { margin-bottom: .2rem; }
  .opt { color: var(--t-faint); font-size: .8rem; }
  .nc-first { display: flex; flex-wrap: wrap; gap: .3rem .6rem; align-items: center; margin: .2rem 0 0; }
  .nc-first a { min-height: 2.75rem; display: inline-flex; align-items: center; }
  .said { margin: 0; color: var(--t-ink); }
  .passed-acts { display: flex; gap: .8rem; align-items: center; }
</style>
