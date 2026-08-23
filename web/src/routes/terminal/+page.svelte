<script lang="ts">
  import { onMount } from 'svelte';
  import { capabilitySentence, pageableNow } from '@navcom/core';
  import { Panel, Slot, Readout, Why } from '$lib/components/panel';
  import { watch } from '$lib/terminal/watch.svelte';
  import { operator } from '$lib/terminal/session.svelte';
  import { presence } from '$lib/terminal/presence.svelte';
  import { position } from '$lib/terminal/position.svelte';
  import { battery } from '$lib/terminal/battery.svelte';
  import { pq } from '$lib/terminal/pq.svelte';
  import { loadConfig } from '$lib/terminal/config';
  import { peers } from '$lib/terminal/peers';
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

  onMount(() => {
    configured = loadConfig() !== null;
    identity = loadIdentity();
    damaged = corruptTiers().length > 0;
    void offline.checkShell();
    watch.start();
    presence.start();
    void battery.start();
    pq.start();
    // Withdrawals of credentials this operator holds. Started here rather than on the
    // standing screen, because a holder who never opens that screen must still stop relying
    // on an endorsement somebody has taken back — `can take watch` is a gate.
    standing.start();
    return () => {
      pq.stop();
      watch.stop();
      presence.stop();
      standing.stop();
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
  let closing = $state(false);
  let note = $state('');
  let cameHome = $state<{ at: number; by: string | null } | null>(null);

  async function home() {
    const by = await operator.standDown(note);
    cameHome = { at: Date.now(), by: by ?? null };
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
  <p class="eyebrow">Field Terminal</p>
  <h1>Status</h1>
</header>

{#if watch.alarms.length > 0}
  <!--
    Above the watch state, because it changes what the state MEANS. Everything below this
    is the watch's account of itself, and this says that account has contradicted itself.
  -->
  <section class="alarm" data-root-alarm={watch.alarms.at(-1)?.kind}>
    <h2>This watch contradicted itself</h2>
    {#each watch.alarms.slice(-3) as a, i (i)}
      <p>
        {#if a.kind === 'diverged'}
          It published two different accounts of its own log at the same length
          (<span class="mono">{a.was.size}</span> entries). <strong>Nothing legitimate does
          that.</strong> History was rewritten after it had been committed to.
        {:else if a.kind === 'shrank'}
          Its log went from <span class="mono">{a.was.size}</span> entries to
          <span class="mono">{a.now.size}</span>. Retention does this on a schedule; so does
          deletion.
        {:else}
          It was committing to a log and has stopped.
        {/if}
      </p>
    {/each}
    <p class="cost">
      This device recorded it, and keeps it. Signing on under this watch is a decision you
      are allowed to make either way — but you get to make it knowing.
    </p>
  </section>
{/if}

<!-- The one screen that must work when everything else is down. -->
<section class="state" style="--tone: {TONE[s.state]}" data-state={s.state}>
  <span class="dot" aria-hidden="true"></span>
  <p class="label">{LABEL[s.state]}</p>
  {#if s.holder}
    <p class="holder">
      {s.holder}
      <!-- An agent is never published as a human, and never presented as one. -->
      {#if s.holder_kind === 'agent'}<span class="kind">agent</span>{/if}
    </p>
  {/if}
</section>

{#if session}
  <!-- On station. What the board believes about you, so a wrong entry is visible here. -->
  <section class="station" data-station>
    <h2>On station</h2>
    <p class="area">{session.area}</p>
    <p class="until">
      {#if remaining !== null && remaining > 0}
        {remaining} min left of what you declared
      {:else}
        <strong>Past your declared time.</strong> The watch will nudge, and nothing more.
      {/if}
    </p>
    <p class="told">
      Told at sign-on: <span>{session.toldAtSignOn}</span>
    </p>
    <!--
      Unmissable while it is live, for the same reason a phone shows the location arrow.
      Somebody who forgot they turned this on should find out by looking at the screen.
    -->
    {#if position.live}
      <p class="sharing" data-sharing>
        Sharing where you are — {position.current?.precision_m
          ? `about ${position.current.precision_m}m`
          : 'exactly'}, to your watch and peers only
      </p>
    {:else if position.denied}
      <p class="sharing denied">
        You asked to share position and this phone will not — check its location permission.
      </p>
    {/if}
  </section>

  <nav class="actions">
    <a class="action" href="/terminal/query/">Query</a>
    <a class="action" href="/terminal/assist/">Assist</a>
    <button onclick={() => operator.routine()} disabled={operator.busy}>
      {operator.busy ? '…' : 'Check in'}
    </button>
    <button onclick={() => (closing = true)} disabled={operator.busy}>Stand down</button>
  </nav>

  {#if closing}
    <!--
      Coming home. The close of the night, and the only place the operator gets to say
      anything in their own words about it -- everything else in this app is a fixed shape.
    -->
    <section class="closing">
      <h2>Coming home</h2>
      <label for="note">Anything worth remembering <span class="opt">optional</span></label>
      <textarea id="note" bind:value={note} placeholder="quiet night, two handouts at the underpass"></textarea>
      <p class="cost">
        Goes in your own patrol record and nowhere else. <strong>Nothing about anybody you
        helped</strong> — that is the one thing this app never keeps.
      </p>
      <nav class="actions">
        <button onclick={() => (closing = false)}>Not yet</button>
        <button class="primary" onclick={home} disabled={operator.busy}>
          {operator.busy ? 'Standing down…' : "I'm home"}
        </button>
      </nav>
    </section>
  {/if}
  {#if battery.low}
    <!--
      Told to the operator, published to nobody. A battery level on the heartbeat would let
      a peer read somebody's silence as alarming or as fine, and that is a conclusion drawn
      from an absence [invariant 3]. The person who can act on this is the one holding the
      phone.
    -->
    <p class="battery">
      <strong>Battery {battery.percent}%.</strong> When it dies you stop sending, and the
      people watching for you will see nothing rather than something wrong.
    </p>
  {/if}
  <a class="action distress" href="/terminal/distress/">Distress</a>
{:else if configured && identity}
  <nav class="actions single">
    <a class="action primary" href="/terminal/sign-on/">Sign on</a>
  </nav>
  <!-- Distress does not require being on station. Needing help does not wait for paperwork. -->
  <a class="action distress" href="/terminal/distress/">Distress</a>
{:else if identity}
  <!--
    Identity but no watch. This is a COMPLETE state, not an unfinished one — it is how an
    operator who patrols alone works, and it is the most common way to use this app. So it
    shows what is usable rather than what is missing.
  -->
  <!--
    Signing on belongs here too, and for the same reason Distress does.

    The Alone layer promises her *"your own patrol record"*, and a record starts by signing
    on. The session layer supports that with no watch **on purpose** — its own words: *"the
    session is set either way"*, and a watch's *"absence must not mean the patrol never
    happened"* — and the sign-on screen is written for her, saying *"Nothing is watching. You
    can still sign on."* Everything was built for this operator except the way in.
  -->
  <nav class="actions">
    <a class="action primary" href="/terminal/sign-on/">Sign on</a>
    <a class="action" href="/terminal/directory/">Cached directory</a>
  </nav>
  <!--
    Distress belongs here for exactly the reason this branch exists.
    
    It was on the two branches with a watch and not on this one — so the **most common
    operator, in the most common state**, had no path from here to it and would have had to
    know the URL. The branch above says it shows what is usable rather than what is missing,
    and Distress is usable: with no watch it terminates in their own person, one tap away,
    which `contact.ts` calls "not the third rung of anything. It is the whole safety net."
  -->
  <a class="action distress" href="/terminal/distress/">Distress</a>
{/if}

{#if cameHome}
  <!--
    Confirmed by name where somebody was watching, and confirmed anyway where nobody was.
    The close of the night is not conditional on an audience.
  -->
  <section class="home" data-came-home>
    <h2>Home</h2>
    <p>
      {#if cameHome.by}
        <strong>{cameHome.by}</strong> has you home at
        {new Date(cameHome.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
      {:else}
        Back at
        {new Date(cameHome.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })},
        and it is in <a href="/terminal/patrols/">your record</a>.
      {/if}
    </p>
  </section>
{/if}

{#if identity && pq.uncovered().length > 0}
  <!--
    Deliberately a note, not a warning. The colour is the same muted one used for every
    other cost on this screen -- an orange bar saying "insecure" would be alarming AND
    wrong, because the message is encrypted and nobody can read it today.

    What is missing is cover against somebody storing tonight's traffic to open in fifteen
    years, and that is a sentence, not a label. It also says what would change it, because a
    notice you cannot act on is just worry.
  -->
  <p class="cover">
    Standard encryption tonight. Unreadable by anyone now — but not covered against being
    stored today and opened by a future quantum computer. That needs
    {uncoveredNames} to open the app once, and it happens on its own after that.
  </p>
{/if}

{#if offline.shellGaps && offline.shellGaps.length > 0}
  <!--
    Three screens promise this app works with no signal. Until now none of them looked.
    A shell that did not finish saving means parts of the terminal will not open without a
    connection -- which an operator should hear before they need them, not after.
  -->
  <p class="error" data-shell-gaps>
    Some of this app did not save for offline use, so parts of it may need a connection.
    Reopening on a good signal usually fixes it.
  </p>
{/if}

{#if damaged}
  <!--
    Reading corrupt storage as empty is right. Presenting it as a FIRST RUN is not: an
    operator whose identity blob got damaged saw "pick a callsign" and concluded they had
    been wiped. The damaged text is kept rather than overwritten, because it is JSON in
    localStorage and somebody can often read it by hand.
  -->
  <p class="error" data-damaged>
    Some of this phone's saved data could not be read, so it is starting as though it were
    new. <strong>The damaged copy has been kept</strong> rather than overwritten — do not
    clear this site's data if you want somebody to try to recover it.
  </p>
{/if}

{#if operator.error}
  <p class="error">{operator.error}</p>
{/if}

{#if presence.out.length > 0 || presence.unknown.length > 0}
  <!--
    Peers, with no watch anywhere in the path. Each device drew this itself from what it
    could decrypt; nothing holds it and nothing persists it.
  -->
  <section class="peers" data-peers>
    <h2>Your peers</h2>
    {#each presence.out as p (p.pubkey)}
      {@const state = presence.stateOf(p)}
      <p class="peer" class:out={state === 'out'} class:overdue={state === 'overdue'}>
        <strong>{p.callsign}</strong>
        {#if state === 'overdue'}
          <!--
            A nudge, and the wording says so. Nothing escalates from this: no page, no
            ladder, no contact. People are late for ordinary reasons far more often than
            dangerous ones, and an alarm here would make false alarms routine.
          -->
          is past the time they gave{p.payload.area ? ` — ${p.payload.area}` : ''}
        {:else}
          is out{p.payload.area ? ` — ${p.payload.area}` : ''}
        {/if}
      </p>
    {/each}
    {#each presence.unknown as p (p.pubkey)}
      <!-- Named rather than hidden. Leaving them off would read as "not out", which is a
           claim nobody made. -->
      <p class="peer unknown"><strong>{p.callsign}</strong> — nothing heard</p>
    {/each}
    {#if presence.unknown.length > 0}
      <p class="cost">
        <strong>Nothing heard is not the same as home.</strong> A quiet phone is a flat
        battery, no signal, or a pocket, and this will never guess which.
      </p>
    {/if}

    <!--
      Only what somebody actually said. Never inferred from you watching them -- two people
      can each assume the other is keeping an eye out, and assuming symmetry nobody agreed
      to is exactly how somebody ends up watched by nobody.
    -->
    {#if presence.watchingYou.length > 0}
      <p class="peer watched" data-watching-you>
        <strong>{presence.watchingYou.join(', ')}</strong>
        {presence.watchingYou.length === 1 ? 'is' : 'are'} watching for you tonight
      </p>
    {/if}
  </section>
{/if}

<!-- The consequence, not the label. A word like "Automated" is not enough on its own — so the
     panel carries the consequence in its own slot, and the sentence is one tap down. -->
<div data-capability>
  <Panel label="Watch">
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
    <Why>
      <p>{capabilitySentence(s, nowS)}</p>
    </Why>
  </Panel>
</div>

{#if s.state === 'dark' && configured}
  <section class="offline">
    <h2>Dark is not an error</h2>
    <p>
      Nothing is watching. That is a state, not a failure to connect — this screen, your
      identity and the <a href="/terminal/directory/">cached directory</a> all work with no
      watch and no signal, and Distress will keep trying regardless.
    </p>
    <p class="cost">
      It leaves you less capable, and there is no way around that. <strong>Query needs a
      watch</strong> — there is nobody to ask, and a cached list you browse one-handed is a
      poor substitute for someone who can answer a follow-up.
      <!--
        This sentence once also promised playbooks and a personal log; neither existed, and
        it was removed rather than left standing. The directory is back because it shipped.
        The rest stays out until it does — see the capability-claim test.
      -->
    </p>
  </section>
{/if}

{#if !identity}
  <section class="notyet">
    <h2>Start here</h2>
    <p>
      Pick a callsign. It takes one screen, nothing is sent anywhere, and there is no
      account to create — the key is made on this device and never leaves it.
    </p>
    <p><a class="action" href="/terminal/setup/">Choose a callsign</a></p>
  </section>
{:else if !configured}
  <section class="notyet">
    <h2>No watch, and that is a normal way to work</h2>
    <p>
      Nobody is watching. Most operators patrol alone and this is what that looks like —
      it is not unfinished setup, and nothing here is waiting on you.
    </p>
    <p>
      <strong>What works right now:</strong> the cached directory, with no signal at all,
      and everything on this device.
    </p>
    <p class="cost">
      <strong>What does not:</strong> Query, Assist and Distress all go to a watch, and there
      is nothing to send them to. If somebody gives you a Watchtower — in person, because
      nothing discovers one — you can <a href="/terminal/setup/">add it</a> and they start
      working.
    </p>
  </section>
{:else if watch.read.reason === 'clock'}
  <!--
    A wrong clock needs different advice from a dead watch. "Nobody is watching" sends an
    operator out relying on themselves, which is safe. "Your phone's clock is wrong" is
    fixable in thirty seconds and gets the watch back.
  -->
  <section class="notyet" data-clock-skew>
    <h2>This phone's clock is wrong</h2>
    <p>
      The watch is stamping its messages ahead of this phone's time, which means one of the
      two clocks is off — almost certainly this one.
    </p>
    <p>
      <strong>Until it agrees, nothing here can tell a live watch from a dead one</strong>,
      so it shows Dark. That is the safe answer rather than the true one.
    </p>
    <p class="cost">
      Turn on automatic date and time in the phone's settings. It usually corrects within a
      minute of having signal.
    </p>
  </section>
{:else if watch.read.reason === 'stale'}
  <section class="notyet">
    <h2>Last word was {watch.read.ageSeconds ?? '?'}s ago</h2>
    <p>
      A Watchtower is configured and the relay is still serving its last message, but that
      message is old enough that the daemon may be gone. <strong>Old is treated as Dark</strong>
      — a stale event says what was true, not what is.
    </p>
  </section>
{:else if watch.read.reason === 'absent'}
  <!--
    Configured, and the relays have nothing at all. Distinct from "no watch" above, which is
    an operator who chose to work alone: this one expected somebody and is being shown Dark
    without being told why. The two fixes are different and neither is guessable.
  -->
  <section class="notyet" data-watch-absent>
    <h2>Nothing from this watch</h2>
    <p>
      A Watchtower is configured, but its relays are not serving anything from it — not an
      old message, nothing. <strong>Dark is the safe answer</strong>, and it is the one you
      should act on: assume nobody is reading what you send.
    </p>
    <p class="cost">
      Usually one of two things. The relay list may not be the one the watch publishes to —
      both come from whoever gave you the address, and they have to match. Or the watch is
      simply not running, which is a question for the person who holds it.
    </p>
  </section>
{:else if watch.read.reason === 'corrupt'}
  <!--
    The relay is serving something, and this app cannot read it. Almost always a version
    gap, which is fixable — and quite different from a watch that is down.
  -->
  <section class="notyet" data-watch-corrupt>
    <h2>This watch is speaking a language this app does not</h2>
    <p>
      Something is arriving from the Watchtower and none of it can be read.
      <strong>Dark is the safe answer</strong> — an unreadable message is not evidence that
      anybody is watching.
    </p>
    <p class="cost">
      Most often the watch is newer than this app. Reopening this page while you have signal
      updates it. If that changes nothing, tell whoever holds the watch — they can see what
      it is publishing and you cannot.
    </p>
  </section>
{/if}

{#if identity}
  <!-- Two taps from anywhere in the terminal. Not buried, and not a button large enough to
       hit while putting the phone in a pocket. -->
  <nav class="quiet">
    <a href="/terminal/watch/">Watch</a>
    <a href="/terminal/resupply/">Resupply</a>
    <a href="/terminal/peers/">Peers</a>
    <a href="/terminal/card/">Your card</a>
    <a href="/terminal/directory/">Directory</a>
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

<section class="install">
  <h2>Adding this to your home screen</h2>
  <p>
    You can rename it, and you should think about whether you want to. <strong>A phone that
    is borrowed, searched or taken shows whatever name is on the icon.</strong>
  </p>
  <p class="cost">
    <!--
      No pitch, because there is nothing to pitch: native apps are deferred, so the home
      screen version and this one are the same app with the same abilities. When that stops
      being true, the honest sentence goes here and nowhere else.
    -->
    It is the same app either way — a home screen icon and no browser bar. Nothing is added
    and nothing is withheld.
  </p>
</section>

<style>
  .state {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: .3rem .8rem;
    border: 2px solid var(--tone);
    background: var(--t-raised);
    padding: 1.1rem 1.2rem;
  }
  .dot {
    width: .85rem; height: .85rem; border-radius: 50%;
    background: var(--tone); grid-row: 1 / span 1;
  }
  .label { margin: 0; font-size: 1.5rem; font-weight: 700; color: var(--tone); }
  .holder {
    grid-column: 2; margin: 0; color: var(--t-muted); font-size: 1rem;
    display: flex; align-items: baseline; gap: .5rem;
  }
  .kind {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .68rem; letter-spacing: .1em; text-transform: uppercase;
    border: 1px solid var(--t-line-strong); padding: .1rem .35rem; color: var(--t-faint);
  }

  .station { border: 2px solid var(--t-station); background: var(--t-raised); padding: 1rem 1.1rem; }
  .station h2 { color: var(--t-station); }
  .area { color: var(--t-ink); font-size: 1.25rem; font-weight: 650; margin: 0 0 .25rem; }
  .until { font-size: .95rem; margin: 0 0 .5rem; }
  .told { font-size: .82rem; color: var(--t-faint); margin: 0; }
  .told span { font-style: italic; }

  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; }
  .actions.single { grid-template-columns: 1fr; }
  .actions :global(.action), .actions button { width: 100%; }
  .primary { border-color: var(--t-station); color: var(--t-station); }

  .alarm { border: 2px solid var(--t-dark); background: var(--t-sunk); padding: 1rem 1.1rem; gap: .5rem; }
  .alarm h2 { color: var(--t-dark); }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

  .closing { border: 2px solid var(--t-line-strong); padding: 1rem 1.1rem; gap: .5rem; }
  .closing textarea { margin-bottom: .2rem; }
  .opt { color: var(--t-faint); font-size: .8rem; }
  .home { border: 2px solid var(--t-station); background: var(--t-raised); padding: 1rem 1.1rem; }
  .home h2 { color: var(--t-station); }
  .home p { color: var(--t-ink); font-size: 1.05rem; margin: 0; }

  .sharing {
    margin: .4rem 0 0; font-size: .85rem; color: var(--t-oncall);
    border-inline-start: 2px solid var(--t-oncall); padding-inline-start: .6rem;
  }
  .sharing.denied { color: var(--t-dark); border-inline-start-color: var(--t-dark); }

  .peers { border: 2px solid var(--t-line-strong); padding: .9rem 1rem; gap: .3rem; }
  .peer { margin: 0; }
  .peer.out { color: var(--t-ink); }
  .peer.unknown { color: var(--t-faint); }
  .peer.overdue { color: var(--t-oncall); }
  .peer.overdue strong { color: var(--t-oncall); }
  .peer.watched { color: var(--t-station); margin-top: .4rem; }
  .peer.watched strong { color: var(--t-station); }
  .peer.unknown strong { color: var(--t-muted); }

  .quiet { display: flex; gap: 1.2rem; flex-wrap: wrap; }
  .quiet a { color: var(--t-faint); font-size: .9rem; text-decoration: none; border-bottom: 1px solid var(--t-line); }

  /* Always its own row, always last, never adjacent to an ordinary action. */
  .distress {
    border-color: var(--t-dark); color: var(--t-dark); background: var(--t-sunk);
    text-transform: uppercase; letter-spacing: .04em;
  }
</style>
