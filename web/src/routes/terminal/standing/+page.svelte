<script lang="ts">
  /**
   * What people who have worked with you have said, and what you have said about them.
   *
   * Nothing here is published, indexed or looked up. It is a folder of signed statements you
   * hold and choose what to show — which is why no map of who-knows-whom exists anywhere in
   * this system.
   */
  import { onMount } from 'svelte';
  import { readClock, type ClockRead } from '$lib/terminal/clock';
  import { SCOPES, ageInDays, revoke, type Endorsement, type Scope, writeCredential } from '@navcom/core';
  import { StandingError, claim, drop, held, presentable, recordWritten, withdraw, withdrawn, written as writtenCredentials } from '$lib/terminal/standing';
  import { loadIdentity } from '$lib/terminal/identity';
  import { Readout, Why } from '$lib/components/panel';

  let mine = $state<Endorsement[]>([]);
  /**
   * The one held up to somebody else, or null.
   *
   * Credentials are checked **in person, offline, with no lookup** — that is the whole design,
   * and it means there is a moment where you hold your phone out to a person standing in front
   * of you. Every other screen here is laid out for whoever is holding the phone. This one is
   * not, and `presentable()` existed for it while nothing rendered it.
   */
  let showing = $state<Endorsement | null>(null);
  /**
   * The raw signed pair, while the reader is checking it on their own device.
   *
   * The screen above it is **this phone's word**: it says the signatures verified, and the
   * person reading it at arm's length has no way to tell that from a page that says so
   * without checking anything. For most handovers that is fine — they are looking at
   * somebody they just met and weighing whether to believe them, which is the whole design.
   *
   * For the handover where it is not fine, this is the way out: the credential and the claim
   * as they were signed, for the other person to verify with their own copy of the app and
   * nobody's assurance. `presentable()` existed for exactly this and was called from nowhere.
   */
  let handingOver = $state(false);
  let handedCopied = $state(false);
  let callsign = $state<string | null>(null);
  let pasted = $state('');
  let error = $state<string | null>(null);

  let writingScope = $state<Scope | null>(null);
  let written = $state<string | null>(null);
  let copied = $state(false);

  let { data } = $props();
  /*
   * An endorsement carries `at`, taken from this clock with no input from whoever writes it.
   * Dated behind, it reads as older standing than it is; dated ahead, `FUTURE_TOLERANCE_DAYS`
   * makes it unweighable. Either way the person receiving it is defended and the person
   * writing it is never told — and this is the one write on this screen that another human
   * relies on.
   */
  let clock = $state<ClockRead>({ behind: false, behindSeconds: 0, behindDays: 0 });

  onMount(() => {
    clock = readClock(data?.built, Date.now());
    mineWritten = writtenCredentials();
    callsign = loadIdentity()?.callsign ?? null;
    mine = held();
    gone = withdrawn();
  });

  function take() {
    error = null;
    try {
      claim(pasted);
      mine = held();
      pasted = '';
    } catch (e) {
      error = e instanceof StandingError ? e.message : 'Could not take that up.';
    }
  }

  /** The scope a stored credential asserts, read back out of its content. */
  function scopeOf(credential: { content: string }): string {
    try {
      return String((JSON.parse(credential.content) as { scope?: unknown }).scope ?? '');
    } catch {
      return '';
    }
  }

  function write(scope: Scope) {
    const identity = loadIdentity();
    if (!identity?.callsign) return;
    const credential = writeCredential(
      identity.secretKey,
      { scope, endorser: identity.callsign, at: new Date().toISOString().slice(0, 10) },
      Math.floor(Date.now() / 1000)
    );
    written = JSON.stringify(credential);
    writingScope = scope;
    copied = false;
    // Kept so it can be withdrawn later. Nothing about the holder is recorded — a credential
    // names nobody — so this is a list of things written, not of people vouched for.
    recordWritten(credential);
    mineWritten = writtenCredentials();
  }

  /** Credentials this operator wrote, which are the ones they can take back. */
  let mineWritten = $state<ReturnType<typeof writtenCredentials>>([]);
  /** Endorsements taken back by whoever wrote them. */
  let gone = $state<ReturnType<typeof withdrawn>>([]);
  let withdrawing = $state<string | null>(null);
  let unsentWithdrawal = $state<string | null>(null);

  async function takeBack(id: string) {
    withdrawing = id;
    try {
      // Honoured on this device whether or not it reaches a relay: the endorser has decided,
      // and that decision must not wait for signal.
      unsentWithdrawal = (await withdraw(id)) ? null : id;
      mineWritten = writtenCredentials();
    } finally {
      withdrawing = null;
    }
  }

  async function copy() {
    if (!written) return;
    try {
      await navigator.clipboard.writeText(written);
      copied = true;
    } catch {
      copied = false;
    }
  }

  function put(e: Endorsement) {
    drop(e.id);
    mine = held();
  }

  /** The signed pair behind the endorsement on screen, or null if it is no longer held. */
  const heldPair = $derived(
    showing ? (presentable().find((h) => h.credential.id === showing?.id) ?? null) : null
  );

  async function copyPair() {
    if (!heldPair) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(heldPair));
      handedCopied = true;
    } catch {
      handedCopied = false;
    }
  }

  function closePresent() {
    showing = null;
    handingOver = false;
    handedCopied = false;
  }

  const label = (s: string) => s.replace(/-/g, ' ');
  /**
   * How old an endorsement is, using the same rule as everything else that shows an age.
   *
   * This had its own arithmetic with a `Math.max(0, …)` clamp, which meant a credential dated
   * 2099 rendered **"0 days ago" — the freshest possible — and never aged**. That defeats the
   * one mechanism this design uses instead of expiry: *show the age and let the reader weigh
   * it*. `ageInDays` already answers this properly, and a second implementation of a rule is
   * how the two drift apart.
   */
  const age = (iso: string) => ageInDays(iso, new Date());
</script>

<svelte:head>
  <title>Standing · Field Terminal</title>
  <meta name="description" content="What people who have worked with you have said." />
</svelte:head>

<header>
  <p class="eyebrow"><a href="/terminal/">← Status</a></p>
  <h1>Standing</h1>
</header>

<section>
  <p>
    Signed statements from people who have worked beside you. You hold them, you choose what
    to show, and <strong>nothing here is published or looked up</strong>.
  </p>
  <!--
    This one stays on the glass: it is what the operator has to *do differently* because a
    credential names nobody, and the doctrine never hides an instruction.
  -->
  <p class="cost">
    The cost of that is real: <strong>whoever holds the bytes can take it up.</strong> Hand
    one over in person, or the way you already talk to that person. Nothing here can deliver
    it for you, because this app holds nobody's contact details.
  </p>
  <Why summary="Why it works this way">
    <p class="cost">
      <!--
        The property everything else follows from, stated first because it is what makes the
        rest safe rather than a feature of it.
      -->
      <strong>A credential names nobody.</strong> It says <em>"I vouch for the holder of
      this"</em> — a scope and a date, and no subject at all. So you can vouch for somebody who
      has never opened this app, and <strong>no map of who knows whom exists anywhere</strong>,
      including here.
    </p>
    <p class="cost">
      <!--
        No-free-text is a property of the whole model, not of the form where somebody happens
        to meet it.
      -->
      <strong>There is no free text</strong>, only a scope tag — explaining <em>why</em>
      somebody is credible is how their history leaks, and the person with the most valuable
      knowledge usually has the most to lose from having it described.
    </p>
    <p class="cost">
      <!-- 7.8, and it is the same trade the setup screen states about the callsign itself. -->
      Standing attaches to a key, which means <strong>it is pseudonymous, not anonymous</strong>
      — it links everything you sign. Contributing without a persistent identity is a real
      choice, and it is the other one.
    </p>
  </Why>
</section>

{#if !callsign}
  <section class="act">
    <p>Pick a callsign first — <a href="/terminal/setup/">it takes one screen</a>.</p>
  </section>
{:else}
  <section class="act">
    <h2>What you hold</h2>
    {#if mine.length === 0}
      <p class="cost">
        Nothing yet, and that is the ordinary starting point. Standing also accrues through
        contribution alone — <a href="/terminal/directory/">correcting the directory</a>
        needs nobody's permission and shows up under your callsign.
      </p>
    {:else}
      <ul class="held">
        {#each mine as e (e.id)}
          <li data-endorsement={e.scope}>
            <!--
              The scope and who vouched, in one readout. Provenance by name is the whole model,
              and the age travels with it because nothing here expires on a timer — the reader
              is the one who weighs it.
            -->
            {#if Number.isFinite(age(e.at))}
              <Readout value={label(e.scope)} tone="good" sub="from {e.endorser}, {age(e.at)} days ago" />
            {:else}
              <!-- Dated in the future or not a real date. Either way it is not an age a reader
                   can weigh, and saying "0 days ago" would be the freshest possible answer to
                   the least trustworthy input. -->
              <Readout value={label(e.scope)} tone="warn" sub="from {e.endorser}" />
              <span class="from" data-unweighable>dated {e.at}, which is not an age you can weigh</span>
            {/if}
            <button class="drop" onclick={() => (showing = e)}>Show</button>
            <button class="drop" onclick={() => put(e)}>Put down</button>
          </li>
        {/each}
      </ul>
      <Why summary="Why the age is shown">
        <p class="cost">
          Ages are shown because they matter — somebody vouched for five years ago is a fact
          about five years ago. Nothing expires on a timer; whoever wrote one can withdraw it.
        </p>
      </Why>
    {/if}
  </section>

  <section class="act">
    <h2>Take one up</h2>
    <p class="cost">
      Somebody handed you a credential. Reading it needs no network and takes nobody's
      approval, and whoever wrote it will never know whether you did.
    </p>
    <label for="cred">Paste it</label>
    <textarea id="cred" bind:value={pasted} rows="3" autocomplete="off" spellcheck="false"></textarea>
    {#if error}<p class="error">{error}</p>{/if}
    <button onclick={take} disabled={!pasted.trim()}>Take it up</button>
  </section>

  {#if gone.length > 0}
    <section class="act">
      <!--
        Shown rather than silently dropped. One of these is the gate on holding a board, so
        somebody who could take the watch yesterday and cannot today has to find out on a
        screen they open, not at the moment they try.
      -->
      <h2>Taken back</h2>
      <ul class="written" data-withdrawn>
        {#each gone as e (e.id)}
          <li>
            <span class="name">{label(e.scope)}</span>
            <p class="cost">
              <strong>{e.endorser}</strong> has taken this back, so it no longer counts for
              anything. They are the person to ask about it.
            </p>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="act">
    <h2>Vouch for somebody</h2>
    <p class="cost">
      Pick what you can honestly say.
    </p>
    {#if clock.behind}
      <p class="error" data-clock-dates-this>
        This phone's clock is <strong>{clock.behindDays > 0 ? `${clock.behindDays} days` : 'under a day'}
        behind</strong>, and an endorsement carries its date. What you write would read as
        older standing than it is, to somebody deciding whether to rely on you. Turn on
        automatic date and time first.
      </p>
    {/if}
    <div class="row">
      {#each SCOPES as scope (scope)}
        <button class="drop" onclick={() => write(scope)}>{label(scope)}</button>
      {/each}
    </div>
    {#if written}
      <p class="cost">
        <strong>{label(writingScope ?? '')}</strong> — give this to them however you already
        talk. It names nobody, so it is theirs the moment they take it up, and you will not
        be told when they do.
      </p>
      <pre class="blob">{written}</pre>
      <button onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    {/if}

    {#if unsentWithdrawal}
      <!--
        Deliberately outside the list. This lived inside the row it referred to, and
        withdrawing removes that row — so the one case worth reporting rendered nowhere.
      -->
      <p class="cost" data-withdrawal-unsent>
        This device has stopped honouring what you took back. It did not reach a relay, so
        anybody else checking will still see it until you open this with signal.
      </p>
    {/if}

    {#if mineWritten.length > 0}
      <!--
        Withdrawal existed on paper and nowhere else: `revoke` and `isRevokedBy` were both in
        core, identity.md said endorsers publish a revocation checked when online, and the
        client neither published one nor ever looked. An endorser who learned somebody was
        unsafe had no way to take it back, and `can take watch` is the gate on who may hold
        a board.
      -->
      <h3>What you have vouched for</h3>
      <p class="cost">
        Taking one back is you retracting your own claim. It is not an appeal, nobody
        adjudicates it, and the person is not told.
      </p>
      <ul class="written">
        {#each mineWritten as c (c.id)}
          <li>
            <span class="name">{label(scopeOf(c))}</span>
            <button class="drop" data-withdraw onclick={() => takeBack(c.id)}
              disabled={withdrawing === c.id}>Take it back</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

{#if showing}
  <!--
    Held out at arm's length, in the dark, for somebody else to read.
    
    Type sized for a second reader at sixty centimetres rather than a thumb at thirty, and on
    black so it can be read outdoors at night without lighting your own face. It must not look
    like a badge or an ID card: it is somebody's word, shown — and a credential that resembles
    official identification is the beginning of exactly the authority this project refuses.
  -->
  <section class="present" data-presenting={showing.scope}>
    <p class="present-scope">{label(showing.scope)}</p>
    <p class="present-by">vouched by {showing.endorser}</p>
    <p class="present-age">
      written {showing.at}{#if Number.isFinite(age(showing.at))} · {age(showing.at)} days ago{/if}
    </p>
    <!-- "This phone says so", not "this is verified". The reader cannot tell a page that
         checked the signatures from one that only claims to, and pretending otherwise is
         how a credential starts working like an ID card. -->
    <p class="present-check">this phone checked the signatures · no network used</p>
    {#if handingOver && heldPair}
      <p class="present-raw-note">
        The credential and the claim, as they were signed. Take a copy and check it on your
        own phone — then none of this is my word.
      </p>
      <pre class="present-raw" data-pair>{JSON.stringify(heldPair)}</pre>
      <button onclick={copyPair}>{handedCopied ? 'Copied' : 'Copy it'}</button>
    {:else if heldPair}
      <button class="present-alt" data-hand-over onclick={() => (handingOver = true)}>
        Let them check it themselves
      </button>
    {/if}
    <button onclick={closePresent}>Done</button>
  </section>
{/if}

<style>
  /* Not the terminal's ordinary scale: this is read by a second person, at arm's length. */
  .present {
    position: fixed;
    inset: 0;
    z-index: 10;
    background: #000;
    display: grid;
    align-content: center;
    justify-items: center;
    gap: .55rem;
    padding: 2rem 1.25rem;
    text-align: center;
  }
  .present-scope {
    margin: 0;
    font-size: clamp(2rem, 11vw, 3.2rem);
    font-weight: 700;
    line-height: 1.05;
    letter-spacing: .04em;
    text-transform: uppercase;
    color: var(--t-oncall);
  }
  .present-by { margin: .4rem 0 0; font-size: 1.15rem; color: var(--t-ink); letter-spacing: .04em; }
  .present-age { margin: 0; font-family: var(--font-mono); font-size: .8rem; color: var(--t-faint); }
  .present-check {
    margin: 1.2rem 0 1.4rem;
    font-family: var(--font-mono);
    font-size: .62rem;
    letter-spacing: .12em;
    text-transform: uppercase;
    color: var(--t-faint);
    border-block-start: 1px solid var(--t-line);
    padding-block-start: .8rem;
  }
  /* Secondary to "Done": the ordinary handover is somebody reading the screen, and this is
     the way out for the one where that is not enough. It must be findable, not prominent. */
  .present-alt {
    min-height: 2.4rem;
    font-size: .85rem;
    padding: 0 .9rem;
    border-color: var(--t-line);
    color: var(--t-faint);
  }
  .present-raw-note {
    margin: 0;
    max-width: 26rem;
    font-size: .85rem;
    line-height: 1.5;
    color: var(--t-muted);
  }
  /* Read by whoever is copying it, not at arm's length — so it goes back to a normal size
     and is allowed to scroll rather than pushing the rest of the overlay off screen. */
  .present-raw {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .6rem;
    line-height: 1.4;
    text-align: start;
    width: min(100%, 26rem);
    max-height: 30vh;
    overflow: auto;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    background: var(--t-sunk);
    border: 1px solid var(--t-line);
    padding: .6rem;
    margin: 0;
    color: var(--t-muted);
  }

  .act { gap: .6rem; }
  textarea { width: 100%; }
  .row { display: flex; gap: .5rem; flex-wrap: wrap; }
  .held { list-style: none; margin: 0; padding: 0; }
  .held li {
    display: flex; align-items: center; gap: .8rem;
    border-bottom: 1px solid var(--t-line); min-height: 3.2rem; flex-wrap: wrap;
  }
  .from { color: var(--t-faint); font-size: .88rem; flex: 1; }
  .blob {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .7rem;
    background: var(--t-sunk); border: 1px solid var(--t-line); padding: .6rem;
    overflow-x: auto; margin: 0; color: var(--t-muted); max-height: 9rem;
  }
  .drop { min-height: 2.4rem; font-size: .85rem; padding: 0 .8rem;
          border-color: var(--t-line); color: var(--t-faint); }
</style>
