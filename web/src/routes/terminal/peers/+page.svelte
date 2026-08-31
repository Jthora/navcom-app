<script lang="ts">
  /**
   * Pairing, and who you are paired with.
   *
   * Nothing here discovers anybody. No suggestions, no ranking, no list of operators who
   * might know each other — that list is the thing this design refuses to build, and its
   * absence is the feature.
   */
  import { onMount } from 'svelte';
  import { Slot, Readout, Heartbeat, Why } from '$lib/components/panel';
  import { page } from '$app/state';
  import { PairError, pair, peers, setBuddy, unpair, type Peer } from '$lib/terminal/peers';
  import { loadIdentity } from '$lib/terminal/identity';
  import { relays, usingDefaults } from '$lib/terminal/relays';
  import encodeQR from '@paulmillr/qr';
  import { canScan, pubkeyFrom, scan, ScanError, type Scanner } from '$lib/terminal/scan';
  import { invites, type Waiting } from '$lib/terminal/invites.svelte';

  let mine = $state<Peer[]>([]);
  let myPubkey = $state<string | null>(null);
  let code = $state('');
  let callsign = $state('');
  let error = $state<string | null>(null);
  /** Who was accepted while the reply could not be sent. */
  let halfPaired = $state<string | null>(null);
  let copied = $state(false);
  let using = $state<string[]>([]);
  let defaults = $state(false);
  let scannable = $state(false);
  let scanning = $state(false);
  let camera = $state<HTMLVideoElement | null>(null);
  let scanner: Scanner | null = null;
  let naming = $state<Record<string, string>>({});

  onMount(() => {
    using = relays();
    defaults = usingDefaults();
    scannable = canScan();
    mine = peers();
    myPubkey = loadIdentity()?.pubkey ?? null;
    // A pairing link opens straight into the form with the code already there. The person
    // still has to name them and accept, because pairing must be something you did.
    const fromLink = page.url.hash.replace(/^#/, '');
    if (fromLink) code = fromLink;

    // Only listens on inboxes this operator actually has. Somebody who never published a
    // card has no public address, so nothing can arrive here uninvited.
    invites.start();
    return () => invites.stop();
  });

  const link = $derived(myPubkey ? `https://navcom.app/terminal/peers/#${myPubkey}` : '');

  /**
   * The code as a QR, drawn as SVG.
   *
   * `@paulmillr/qr` is by the same author as the elliptic-curve and hashing libraries
   * nostr-tools already depends on — same ecosystem, no new supply chain, and no
   * dependencies of its own. The alternative was hand-rolling Reed-Solomon on a screen
   * whose whole job is exchanging keys, which is not a place to be inventive.
   *
   * SVG rather than canvas: it scales to whatever the phone is, prints, and needs no
   * pixel-density arithmetic.
   */
  const qr = $derived(myPubkey ? encodeQR(link, 'svg', { ecc: 'medium', border: 2 }) : '');
  /** Broken into blocks. Sixty-four unbroken characters is unreadable and unspeakable. */
  const blocks = $derived(myPubkey ? (myPubkey.match(/.{1,8}/g) ?? []) : []);

  async function startScan() {
    if (!camera) return;
    error = null;
    scanning = true;
    try {
      scanner = await scan(camera);
      const raw = await scanner.found;
      const key = pubkeyFrom(raw);
      if (!key) throw new ScanError('That code is not a NavCom code.');
      code = key;
    } catch (err) {
      error = err instanceof ScanError ? err.message : 'Could not scan.';
    } finally {
      scanning = false;
      scanner = null;
    }
  }

  function stopScan() {
    scanner?.stop();
    scanner = null;
    scanning = false;
  }

  /**
   * Pairing, from a button rather than a form submit.
   *
   * A prerendered page is on screen and tappable before it hydrates, and a `<form>` tapped
   * in that window does a native GET submit: the page reloads and the code the operator
   * just typed is gone. A plain button does nothing at all until it works, and a tap that
   * does nothing is recoverable in a way that a tap that clears the field is not.
   *
   * Same reasoning as the Distress hold control, which must never be disabled during
   * hydration -- what a prerendered screen does before its JavaScript arrives is a design
   * decision, not an implementation detail.
   */
  function accept() {
    error = null;
    try {
      pair(code, callsign);
      mine = peers();
      code = '';
      callsign = '';
    } catch (err) {
      error = err instanceof PairError ? err.message : 'Could not pair.';
    }
  }

  function drop(peer: Peer) {
    unpair(peer.pubkey);
    mine = peers();
  }

  function toggleBuddy(peer: Peer) {
    setBuddy(peer.pubkey, !peer.buddy);
    mine = peers();
  }

  async function take(w: Waiting) {
    // Pairing is two halves and only one is local. If the reply did not reach a relay they
    // are on this device's list and this device is on nobody's, which for a buddy means
    // nobody is watching while the operator believes somebody is.
    const reached = await invites.accept(w, naming[w.id] ?? '');
    mine = peers();
    halfPaired = reached ? null : w.payload.callsign;
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      copied = true;
    } catch {
      copied = false;
    }
  }
</script>

<svelte:head>
  <title>Peers · Field Terminal</title>
  <meta name="description" content="Who you have paired with." />
</svelte:head>

<header>
  <p class="eyebrow"><a href="/terminal/">← Status</a></p>
  <h1>Peers</h1>
</header>

<section>
  <p>
    Somebody you paired with sees when you are out, and you see when they are. No watch is
    involved, no server holds it, and either of you can end it without telling the other.
  </p>
  <p>
    <!--
      The sentence this screen was missing, and the one most likely to matter.
      Nothing in the code ever required a peer to be an operator — `pair` takes any valid
      key and a name you choose, and there is no roster to be absent from — but every word
      here described patrolling, so somebody whose only candidate was their partner had no
      way to know this was for them. The mechanism shipped; the framing did not.
    -->
    <strong>They do not have to be an operator.</strong> A partner, a housemate, a sibling —
    anyone willing to install this and pick a name. Most people here know nobody else who
    does this, and the person most likely to notice you did not come home already lives with
    you.
  </p>
  <p class="cost">
    <strong>Best done face to face.</strong> A code sent through a messaging app travels
    through whatever carried it — which is fine between people who already talk that way,
    and worth knowing either way.
  </p>
  <p class="cost">
    <!-- Stated before pairing rather than after. Somebody deciding whether to pair should
         already know how ending it works. -->
    Ending it is one tap, immediate, and <strong>they are not told</strong>. It stops what
    you send them from then on; it cannot recall what they already have.
  </p>
  <p class="cost">
    <!--
      Before the pairing form, where somebody deciding actually reads it. Sixth time this
      session an important sentence sat behind a conditional — and the first time it was
      caught the moment it was written rather than after it shipped.
    -->
    <strong>Watching for somebody</strong> is a separate thing you can take on: your phone
    tells you when they are past the time they gave, and <strong>they are told you are doing
    it</strong> — a private note would let somebody believe they are watched while nobody
    is. It is a nudge and nothing else: nothing escalates, nobody is paged, and going quiet
    is never treated as trouble.
  </p>
  <p class="cost">
    <!--
      Said before an invite has ever arrived, because the moment one is on the screen is the
      moment somebody feels they owe an answer. They do not.
    -->
    You can also pair with somebody you have not met, from <a href="/terminal/find/">their
    card</a>. Anybody may ask you — and <strong>ignoring sends nothing</strong>: no refusal,
    no read receipt, and no way for them to tell an ignored invite from one that never
    arrived. <a href="/terminal/card/">Publishing a card</a> is what makes you askable, and
    having none is the default.
  </p>
</section>

<!--
  Said plainly because every network call this app makes has to be explainable to somebody
  pointing a proxy at it. Relays carry sealed envelopes they cannot read, and using one
  reveals no Watchtower -- but an operator should still know which strangers' machines
  their presence travels through.
-->
<Why summary="Where this goes">
  <p>
    Presence travels through {defaults ? 'these public relays, which ship as defaults' : 'the relays you configured'}.
    They carry sealed messages they cannot read, and none of them learns who your peers are.
  </p>
  <p class="blocks">{#each using as r (r)}<span>{r}</span>{/each}</p>
</Why>

{#if invites.waiting.length > 0}
  <section class="act">
    <h2>Asked to pair</h2>
    {#if invites.flooded}
      <!--
        Anybody can send one of these — the address is published, which is what a card is
        for. Said plainly, because the operator is the only one who can tell a flood from a
        busy week, and because the invite they were expecting may be the one being refused.
      -->
      <Slot k="Requests">
        <Readout value="Turning away" tone="warn" sub="more arriving than this will hold" />
      </Slot>
      <p class="over" data-invites-flooded>
        More pairing requests are arriving than this will hold, so new ones are being
        turned away. If you were expecting one, clear these and ask them to send it again.
      </p>
      <button class="drop" data-ignore-all onclick={() => invites.ignoreAll()}>
        Clear all requests
      </button>
    {/if}
    {#if halfPaired}
      <Slot k="Pairing">
        <Heartbeat label="Half done" />
      </Slot>
      <p class="over" data-half-paired>
        You have {halfPaired}, but they do not have you — your reply did not reach a relay.
        Tap Accept again when you have signal, or they will not see your patrols.
      </p>
    {/if}
    <ul class="asks">
      {#each invites.waiting as w (w.id)}
        <li>
          <span class="name">{w.payload.callsign}</span>
          {#if w.payload.note}<p class="doing">{w.payload.note}</p>{/if}
          <label for="as-{w.id}">What you call them</label>
          <input id="as-{w.id}" bind:value={naming[w.id]} autocomplete="off"
            placeholder={w.payload.callsign} />
          <div class="row">
            <button onclick={() => take(w)}>Accept</button>
            <button class="drop" onclick={() => invites.ignore(w)}>Ignore</button>
          </div>
        </li>
      {/each}
    </ul>
    <p class="cost">Ignoring sends nothing. Take the time you want.</p>
  </section>
{/if}

<section class="act">
  <h2>Your code</h2>
  {#if myPubkey}
    <!-- Held up to their camera. This is the in-person path the design prefers, and it is
         the only one that does not travel through somebody else's servers. -->
    <div class="qr" data-qr>{@html qr}</div>
    <details>
      <summary>Or read it out</summary>
      <p class="blocks">{#each blocks as b, i (i)}<span>{b}</span>{/each}</p>
    </details>
    <button onclick={copy}>{copied ? 'Copied' : 'Copy your link'}</button>
    <p class="cost">
      Hold it up to their camera. Nothing happens until they accept, and nothing about you
      is published by having a code.
    </p>
  {:else}
    <p>Pick a callsign first — <a href="/terminal/setup/">it takes one screen</a>.</p>
  {/if}
</section>

<section class="act">
  <h2>Add somebody</h2>
  <!-- Camera first where the browser has one, because holding a phone up beats reading
       hex aloud. Where it does not, this is absent rather than broken. -->
  {#if scannable}
    <button type="button" onclick={scanning ? stopScan : startScan}>
      {scanning ? 'Stop' : 'Scan their code'}
    </button>
    <video
      bind:this={camera}
      class="camera"
      class:live={scanning}
      playsinline
      muted
      aria-label="Camera, looking for a pairing code"
    ></video>
  {/if}

  <div class="form">
    <label for="code">Their code</label>
    <textarea id="code" bind:value={code} rows="2" autocomplete="off" spellcheck="false"
      placeholder="paste their code or link"></textarea>
    <label for="name">What you call them</label>
    <input id="name" bind:value={callsign} autocomplete="off" placeholder="Raven" />
    <p class="cost">
      Your name for them, kept on this phone and never sent anywhere. They will never see it.
    </p>
    {#if error}<p class="error">{error}</p>{/if}
    <button type="button" onclick={accept}>Pair</button>
  </div>
</section>

{#if mine.length > 0}
  <section>
    <h2>Paired</h2>
    <ul class="paired">
      {#each mine as p (p.pubkey)}
        <li class:watching={p.buddy}>
          <span class="name">{p.callsign}</span>
          {#if p.buddy}<span class="badge">watching</span>{/if}
          <button class="drop" onclick={() => toggleBuddy(p)}>
            {p.buddy ? 'Stop watching' : 'Watch for them'}
          </button>
          <button class="drop" onclick={() => drop(p)}>Remove</button>
        </li>
      {/each}
    </ul>
    <p class="cost">
      Removing somebody is immediate, and they are not told.
    </p>
  </section>
{/if}

<style>
  .over {
    margin: 0 0 0.6rem;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--edge);
    border-inline-start: 3px solid var(--warn, var(--edge));
    font-size: 0.85rem;
    line-height: 1.4;
  }

  .act { gap: .6rem; }
  .form { display: flex; flex-direction: column; gap: .6rem; }
  .qr {
    background: #fff; padding: .7rem; align-self: flex-start; line-height: 0;
    /* White ground regardless of theme: a scanner needs the contrast the format assumes. */
  }
  .qr :global(svg) { width: min(62vw, 15rem); height: auto; display: block; }
  .camera { width: 100%; max-height: 0; border-radius: 2px; background: var(--t-sunk); }
  .camera.live { max-height: 16rem; object-fit: cover; margin-top: .5rem; }

  details summary { color: var(--t-faint); font-size: .88rem; min-height: 2.4rem; cursor: pointer; }

  .blocks {
    display: flex; flex-wrap: wrap; gap: .35rem .6rem; margin: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .95rem;
    color: var(--t-ink);
  }
  .blocks span { background: var(--t-sunk); padding: .2rem .4rem; }

  .paired { list-style: none; margin: 0 0 .6rem; padding: 0; }
  .paired li {
    display: flex; align-items: center; gap: .8rem;
    border-bottom: 1px solid var(--t-line); min-height: 3.2rem;
  }
  .paired li.watching { border-inline-start: 2px solid var(--t-station); padding-inline-start: .5rem; }
  .name { color: var(--t-ink); font-weight: 650; flex: 1; }
  .badge {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .62rem; letter-spacing: .1em; text-transform: uppercase;
    color: var(--t-station); border: 1px solid var(--t-station); padding: .1rem .3rem;
  }
  .asks { list-style: none; margin: 0 0 .6rem; padding: 0; }
  .asks li {
    display: flex; flex-direction: column; gap: .5rem;
    border-bottom: 1px solid var(--t-line); padding-block: .9rem;
  }
  .asks input { width: 100%; }
  .row { display: flex; gap: .6rem; }
  .doing { margin: 0; color: var(--t-faint); font-size: .92rem; }
  .drop { min-height: 2.2rem; font-size: .8rem; padding: 0 .7rem; border-color: var(--t-line); color: var(--t-faint); }
</style>
