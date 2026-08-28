<script lang="ts">
  /**
   * Being on-call: the one commitment in this app that involves being interrupted.
   *
   * Not a field screen. The person here is at home with a phone that might ring, and
   * everything on it is about what they are agreeing to rather than about what they can do.
   */
  import { onMount } from 'svelte';
  import {
    canBePaged, isRegistered, PagingError, registerForPaging, stopPaging, type Registration
  } from '$lib/terminal/paging';
  import { Slot, Readout } from '$lib/components/panel';

  let supported = $state(false);
  let registered = $state(false);
  let senderKey = $state('');
  let handover = $state<Registration | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let copied = $state(false);

  onMount(async () => {
    supported = canBePaged();
    if (supported) registered = await isRegistered();
  });

  async function register() {
    error = null;
    busy = true;
    try {
      handover = await registerForPaging(senderKey);
      registered = true;
    } catch (e) {
      error = e instanceof PagingError ? e.message : 'Could not register this device.';
    } finally {
      busy = false;
    }
  }

  async function stop() {
    await stopPaging();
    registered = false;
    handover = null;
  }

  async function copy() {
    if (!handover) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(handover));
      copied = true;
    } catch {
      copied = false;
    }
  }
</script>

<svelte:head>
  <title>On call · Field Terminal</title>
  <meta name="description" content="Agreeing to be woken when somebody raises a Distress." />
</svelte:head>

<header>
  <p class="eyebrow"><a href="/terminal/">← Status</a></p>
  <h1>On call</h1>
</header>

<section>
  <p>
    On-call means <strong>reachable when the board cannot raise anybody</strong>. It is a
    phone that might ring, not a shift — and being reachable is the entire content of the
    commitment.
  </p>
  <p class="cost">
    <!--
      Stated before the button, because it is the thing that makes this screen different from
      every other one in the app and the thing somebody is actually agreeing to.
    -->
    <strong>This is the only notification NavCom ever sends.</strong> Not check-ins, not
    someone signing on, not anything you missed. A <code>Distress</code> that reached nobody
    else, and drills that prove the ladder still works. The field terminal is silent and
    stays silent.
  </p>
  <p class="cost">
    <strong>The page carries no detail.</strong> Whoever sends it cannot read the
    <code>Distress</code> either, so there is nothing in it but the fact that somebody is
    waiting — you open the terminal to find out anything. That is deliberate: a notification
    quoting text from the wire would put a stranger's words on your locked screen.
  </p>
  <p class="cost">
    Turning it off is one tap and <strong>tells nobody</strong>. Somebody who has to justify
    standing down keeps a commitment they cannot keep, which is worse for whoever is relying
    on it than an honest end.
  </p>
</section>

{#if !supported}
  <section class="act">
    <h2>This device cannot be woken</h2>
    <Slot k="Paging">
      <Readout value="Not supported here" tone="cold" sub="not being on-call is a legitimate choice" />
    </Slot>
    <p class="cost">
      Nothing is wrong. On an iPhone, notifications only work once NavCom is on the Home
      Screen — <strong>Share, then Add to Home Screen</strong>, then open it from there.
      Otherwise use a phone that can, or take a channel the executor can reach some other
      way. Not being on-call is a legitimate choice.
    </p>
  </section>
{:else if registered}
  <section class="act">
    <h2>This device can be woken</h2>
    <Slot k="Paging">
      <Readout value="Registered" tone="good" sub={handover ? 'hand this to whoever runs the executor' : 'already registered on this device'} />
    </Slot>
    {#if handover}
      <p class="cost">
        Hand this to whoever runs the escalation executor. It is what lets them reach you and
        nothing else — it carries no callsign and identifies no watch.
      </p>
      <pre class="blob">{JSON.stringify(handover, null, 2)}</pre>
      <button onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    {:else}
      <p class="cost">
        Already registered on this device. If the person running the executor never received
        your details, stop and register again to produce them.
      </p>
    {/if}
    <button class="drop" onclick={stop}>Stop being wakeable</button>
  </section>
{:else}
  <section class="act">
    <h2>Register this device</h2>
    <Slot k="Paging">
      <Readout value="Not registered" tone="neutral" sub="needs a sender key from whoever runs the executor" />
    </Slot>
    <p class="cost">
      You need the <strong>sender key</strong> from whoever runs the escalation executor.
      They generate it once with <code>navcom-push --keys</code> and hand it over in person,
      like everything else here. Nothing discovers it.
    </p>
    <label for="sender">Sender key</label>
    <textarea id="sender" bind:value={senderKey} rows="3" autocomplete="off" spellcheck="false"
      placeholder="the public half, 87 characters"></textarea>
    {#if error}<p class="error">{error}</p>{/if}
    <button onclick={register} disabled={!senderKey.trim() || busy}>
      {busy ? 'Asking…' : 'Let this device be woken'}
    </button>
    <p class="cost">
      Your phone will ask for permission. Refusing is fine and means not being on-call, which
      is a real answer rather than a half one.
    </p>
  </section>
{/if}

<style>
  .act { gap: .6rem; }
  textarea { width: 100%; }
  .blob {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .78rem;
    background: var(--t-sunk); border: 1px solid var(--t-line); padding: .7rem;
    overflow-x: auto; margin: 0; color: var(--t-muted);
  }
  .drop { min-height: 2.6rem; font-size: .9rem; border-color: var(--t-line); color: var(--t-faint); }
</style>
