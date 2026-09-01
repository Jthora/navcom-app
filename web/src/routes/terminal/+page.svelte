<script lang="ts">
  import { onMount } from 'svelte';
  import { capabilitySentence, pageableNow } from '@navcom/core';
  import { Panel, Slot, Readout, Why, Action, Board } from '$lib/components/panel';
  import { watch } from '$lib/terminal/watch.svelte';
  import { operator } from '$lib/terminal/session.svelte';
  import { presence } from '$lib/terminal/presence.svelte';
  import { position } from '$lib/terminal/position.svelte';
  import { battery } from '$lib/terminal/battery.svelte';
  import { pq } from '$lib/terminal/pq.svelte';
  import { overdue } from '$lib/terminal/overdue.svelte';
  import { loadConfig } from '$lib/terminal/config';
  import { peers } from '$lib/terminal/peers';
  import { formatDuration } from '$lib/terminal/patrol';
  import { notes } from '$lib/terminal/notes';
  import * as standing from '$lib/terminal/standing';
  import { loadIdentity } from '$lib/terminal/identity';
  import { corruptTiers } from '$lib/terminal/storage';
  import { offline } from '$lib/terminal/offline.svelte';

  const s = $derived(watch.state);

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
  const reachable = $derived(pageableNow(s.oncall, nowS).map((o) => o.author.callsign));
  const watchRead = $derived(
    s.state === 'dark'
      ? { value: 'Dark', tone: 'cold' as const, sub: null }
      : s.state === 'station'
        ? { value: 'On station', tone: 'good' as const, sub: s.holder }
        // Invariant 5. An agent is always identified as an agent, including here.
        : { value: 'Automated', tone: 'warn' as const, sub: 'agent · not a human' }
  );
  let configured = $state(false);
  let identity = $state<ReturnType<typeof loadIdentity>>(null);
  let damaged = $state(false);
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

  onMount(() => {
    configured = loadConfig() !== null;
    identity = loadIdentity();
    damaged = corruptTiers().length > 0;
    waiting = Object.keys(notes()).length;
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
    return () => {
      pq.stop();
      watch.stop();
      presence.stop();
      standing.stop();
      overdue.stop();
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
      ? { id: 'none', label: 'No callsign' }
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
      note: presence.stateOf(p) === 'overdue' ? 'is past the time they gave' : 'is out'
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
      <Why>
        {#each watch.alarms.slice(-3) as a, i (i)}
          <p>
            {#if a.kind === 'diverged'}
              It published two different accounts of its own log at the same length
              ({a.was.size} entries). <strong>Nothing legitimate does that.</strong> History was
              rewritten after it had been committed to.
            {:else if a.kind === 'shrank'}
              Its log went from {a.was.size} entries to {a.now.size}. Retention does this on a
              schedule; so does deletion.
            {:else}
              It was committing to a log and has stopped.
            {/if}
          </p>
        {/each}
        <p>
          This device recorded it, and keeps it. Signing on under this watch is a decision you
          are allowed to make either way — but you get to make it knowing.
        </p>
      </Why>
    </div>
  </section>
{/if}

<!--
  The one screen that must work when everything else is down, as one panel.

  Rule 4: the same facts in the same slots every time, so an operator learns the position and
  stops reading. Rule 5: one lit action. Rule 3: every sentence that used to be on this screen
  is still here, word for word, behind `Why`.
-->
<Panel label="Status" post={post.label} data-state={s.state} data-post={post.id}>
  <!-- Rule 5. One lit action, and it is the thing this post actually does. -->
  {#snippet action()}
    {#if !identity}
      <Action label="Choose a callsign" tone="warn" href="/terminal/setup/" />
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

    <div data-capability>
      <Slot k="Watch">
        <Readout value={watchRead.value} tone={watchRead.tone} sub={watchRead.sub} />
      </Slot>
      <Slot k="Distress">
        {#if reachable.length === 0}
          <Readout value="No addressee" tone="warn" sub="pages nobody, and says so" />
        {:else}
          <Readout value="Pages on-call" tone="neutral" />
        {/if}
      </Slot>
      {#if reachable.length > 0}
        <Slot k="On call">
          <Readout
            value={reachable.join(', ')}
            tone="neutral"
            sub={reachable.length === 1 ? 'sole — ladder ends here' : null}
          />
        </Slot>
      {:else}
        <Slot k="On call" />
      {/if}

      <Why open={!identity || !configured || watch.read.reason !== null}>
        <p>{capabilitySentence(s, nowS)}</p>

        {#if !identity}
          <h2>Start here</h2>
          <p>
            Pick a callsign. It takes one screen, nothing is sent anywhere, and there is no
            account to create — the key is made on this device and never leaves it.
          </p>
          <p>
            <!--
              The Alone layer needs nothing, not even a callsign [CLAUDE.md]. A visitor who only
              wants to look up a shelter must not be told to enlist first — the rail below this
              panel only appears once identity exists, so without this line landing here with no
              callsign yet leaves no visible way to the one thing that needs no commitment at all.
            -->
            Only here to look something up? The
            <a href="/terminal/directory/">cached directory</a> needs no callsign and nothing sent
            anywhere.
          </p>
        {/if}

        {#if s.state === 'dark' && configured}
          <p>
            <strong>Dark is not an error.</strong> Nothing is watching. That is a state, not a
            failure to connect — this screen, your identity and the
            <a href="/terminal/directory/">cached directory</a> all work with no watch and no
            signal, and Distress will keep trying regardless.
          </p>
          <p>
            It leaves you less capable, and there is no way around that. <strong>Query needs a
            watch</strong> — there is nobody to ask, and a cached list you browse one-handed is
            a poor substitute for someone who can answer a follow-up.
          </p>
        {/if}

        <!--
          Every branch below explains a watch that *exists* and is Dark, so each is gated on
          `configured`. Without that guard the chain fell through for the commonest visitor
          this app has — somebody with no callsign and no watch, for whom `!configured &&
          identity` is false — and told them "A Watchtower is configured, but its relays are
          not serving anything from it", followed by "assume nobody is reading what you send".
          Both false, and to a stranger they read as the app being broken on arrival.
        -->
        {#if !configured && identity}
          <h2>No watch, and that is a normal way to work</h2>
          <p>
            Nobody is watching. Most operators patrol alone and this is what that looks like —
            it is not unfinished setup, and nothing here is waiting on you.
          </p>
          <p>
            <strong>What works right now:</strong> the cached directory, with no signal at all,
            and everything on this device.
          </p>
          <p>
            <strong>What does not:</strong> Query, Assist and Distress all go to a watch, and
            there is nothing to send them to. If somebody gives you a Watchtower — in person,
            because nothing discovers one — you can <a href="/terminal/setup/">add it</a> and
            they start working.
          </p>
        {:else if configured && watch.read.reason === 'clock'}
          <h2 data-clock-skew>This phone's clock is wrong</h2>
          <p>
            The watch is stamping its messages
            ahead of this phone's time, which means one of the two clocks is off — almost
            certainly this one.
          </p>
          <p>
            <strong>Until it agrees, nothing here can tell a live watch from a dead one</strong>,
            so it shows Dark. That is the safe answer rather than the true one.
          </p>
          <p>
            Turn on automatic date and time in the phone's settings. It usually corrects within
            a minute of having signal.
          </p>
        {:else if configured && watch.read.reason === 'stale'}
          <h2>Last word was {watch.read.ageSeconds ?? '?'}s ago</h2>
          <p>
            A Watchtower is
            configured and the relay is still serving its last message, but that message is old
            enough that the daemon may be gone. <strong>Old is treated as Dark</strong> — a
            stale event says what was true, not what is.
          </p>
        {:else if configured && watch.read.reason === 'absent'}
          <!-- The marker wraps the whole explanation, not its first paragraph: what the test
               is asserting is that the operator was told why, and the why is both halves. -->
          <div data-watch-absent>
            <h2>Nothing from this watch</h2>
            <p>
              A Watchtower is configured, but its relays are not serving anything from it — not an old message, nothing.
              <strong>Dark is the safe answer</strong>, and it is the one you should act on: assume nobody is reading what you send.
            </p>
            <p>
              Usually one of two things. The relay list may not be the one the watch publishes to — both come from whoever gave you the address, and they have to match.
              Or the watch is simply not running, which is a question for the person who holds it.
            </p>
          </div>
        {:else if watch.read.reason === 'corrupt'}
          <div data-watch-corrupt>
            <h2>This watch is speaking a language this app does not</h2>
            <p>
              Something is arriving from the Watchtower and none of it can be read.
              <strong>Dark is the safe answer</strong> — an unreadable message is not evidence that anybody is watching.
            </p>
            <p>
              Most often the watch is newer than this app. Reopening this page while you have signal updates it.
              If that changes nothing, tell whoever holds the watch — they can see what it is publishing and you cannot.
            </p>
          </div>
        {/if}
      </Why>
    </div>

    {#if session}
      <!-- What the board believes about you, so a wrong entry is visible here. -->
      <div data-station>
        <Slot k="Area"><Readout value={session.area} tone="neutral" /></Slot>
        <Slot k="Check in">
          {#if overdue.flagged}
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
            <Readout value="Past declared" tone="warn" sub="the watch will nudge, nothing more" />
          {/if}
        </Slot>
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
        <Why summary="What you were told at sign-on">
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
          <p class="cover">
            Standard encryption tonight. Unreadable by anyone now — but not covered against
            being stored today and opened by a future quantum computer. That needs
            {uncoveredNames} to open the app once, and it happens on its own after that.
          </p>
        {/if}
        {#if offline.shellGaps && offline.shellGaps.length > 0}
          <p>
            Some of this app did not save for offline use, so parts of it may need a connection.
            Reopening on a good signal usually fixes it.
          </p>
        {/if}
        {#if damaged}
          <p>
            Some of this phone's saved data could not be read, so it is starting as though it
            were new. <strong>The damaged copy has been kept</strong> rather than overwritten —
            do not clear this site's data if you want somebody to try to recover it.
          </p>
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

<!--
  Distress is not the lit action and it is not on the rail.

  It sits on its own in every state, because needing help does not wait for paperwork and
  because with no watch it terminates in the operator's own person — which `contact.ts` calls
  "not the third rung of anything. It is the whole safety net."
-->
{#if identity}
  <Action label="Distress" tone="alarm" href="/terminal/distress/" />
{/if}

{#if session}
  <nav class="nc-rail" data-rail="out">
    <a href="/terminal/query/">Query</a>
    <a href="/terminal/assist/">Assist</a>
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
      <Why summary="Where this goes">
        <p>
          Goes in your own patrol record and nowhere else. <strong>Nothing about anybody you
          helped</strong> — that is the one thing this app never keeps.
        </p>
      </Why>
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
          sub={cameHome.by ? `${cameHome.by} has you home` : 'nobody was watching, and it still counts'}
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
      <Why summary="Where it went">
        <p>
          It is in <a href="/terminal/patrols/">your record</a>, on this device and nowhere
          else. Nothing about anybody you helped is in it.
        </p>
        {#if waiting > 0}
          <p>
            The {waiting === 1 ? 'line' : 'lines'} you jotted at a door
            {waiting === 1 ? 'is' : 'are'} still only here. Open
            <a href="/terminal/directory/">your area</a> and turn
            {waiting === 1 ? 'it' : 'them'} into a correction, and the next person who stands
            outside that place reads what you learned. <strong>A panic wipe destroys them</strong>
            — they live in the tier that exists to be destroyed, which is the right trade for a
            line written in a hurry and the reason to promote it while you remember.
          </p>
        {/if}
      </Why>
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
      <Why summary="What this is built from">
        {#if presence.unknown.length > 0}
          <p>
            <strong>Nothing heard is not the same as home.</strong> A quiet phone is a flat
            battery, no signal, or a pocket, and this will never guess which.
          </p>
        {/if}
        <p>
          Each device drew this itself from what it could decrypt. Nothing holds it and nothing
          persists it, and an operator past the time they gave is a nudge — nothing escalates
          from it, because people are late for ordinary reasons far more often than dangerous
          ones.
        </p>
      </Why>
      {#if presence.watchingYou.length > 0}
        <!--
          Only what somebody actually said. Never inferred from you watching them — two people
          can each assume the other is keeping an eye out, and assuming symmetry nobody agreed
          to is exactly how somebody ends up watched by nobody.
        -->
        <Slot k="Watching">
          <span data-watching-you>
            <Readout
              value={presence.watchingYou.join(', ')}
              tone="good"
              sub="{presence.watchingYou.length === 1 ? 'is' : 'are'} watching for you tonight"
            />
          </span>
        </Slot>
      {/if}
    </div>
  </section>
{/if}

{#if identity}
  <!-- Everything that is not the lit action. Two taps from anywhere, and not a button large
       enough to hit while putting the phone in a pocket. -->
  <nav class="nc-rail" data-rail="all">
    <a href="/terminal/watch/">Watch</a>
    <a href="/terminal/resupply/">Resupply</a>
    <a href="/terminal/peers/">Peers</a>
    <a href="/terminal/card/">Your card</a>
    <a href="/terminal/directory/">Cached directory</a>
    <a href="/terminal/patrols/">Your patrols</a>
    <a href="/terminal/log/">What the watch wrote</a>
    <a href="/terminal/backup/">Backup</a>
    <a href="/terminal/wipe/">Wipe this device</a>
    <a href="/terminal/standing/">Standing</a>
    <a href="/terminal/funding/">Support</a>
    <a href="/terminal/on-call/">On call</a>
    <a href="/terminal/setup/">Setup</a>
  </nav>
{/if}

<section class="nc-panel" data-home-screen>
  <header class="nc-panel-head">
    <span>Home screen</span>
  </header>
  <div class="nc-panel-slots">
    <Why summary="Adding this to your home screen">
      <p>
        You can rename it, and you should think about whether you want to. <strong>A phone that
        is borrowed, searched or taken shows whatever name is on the icon.</strong>
      </p>
      <p>
        <!--
          Still no pitch: native apps are deferred, so the home screen version and this one
          are the same app with the same abilities, and nothing is withheld from the browser.
          But "nothing is added" was flatly false. `delivery.md` names two things that
          genuinely are better installed and calls the second one "the difference between the
          directory being there at 2am and not" — and this screen was denying it, which
          leaves an operator on the device floor deciding against the one thing that protects
          the layer they actually depend on. Stated once, where it is relevant, and never
          again.
        -->
        It is the same app either way — a home screen icon and no browser bar — and nothing is
        withheld from the browser version. One thing does change: a phone short of space may
        throw away a site's cached data, and it is <strong>less likely to do that to something
        on your home screen</strong>. That is the cached directory being there at 2am or not.
      </p>
    </Why>
  </div>
</section>

<style>
  .closing { border: 2px solid var(--t-line-strong); padding: 1rem 1.1rem; gap: .5rem; }
  .closing textarea { margin-bottom: .2rem; }
  .opt { color: var(--t-faint); font-size: .8rem; }
</style>
