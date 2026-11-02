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
  <!-- What somebody is agreeing to, before the button: the one line kept (2026-11-01). -->
  <p>You are paged the moment a <code>Distress</code> reaches this watch.</p>
</section>

{#if !supported}
  <section class="act">
    <h2>This device cannot be woken</h2>
    <Slot k="Paging">
      <Readout value="Not supported here" tone="cold" sub="this browser cannot be paged" />
    </Slot>
    <p class="cost">
      On an iPhone: <strong>Share, then Add to Home Screen</strong>, and open it from there.
    </p>
  </section>
{:else if registered}
  <section class="act">
    <h2>This device can be woken</h2>
    <Slot k="Paging">
      <Readout value="Registered" tone="good" sub={handover ? 'hand this to whoever runs the executor' : 'already registered on this device'} />
    </Slot>
    {#if handover}
      <pre class="blob">{JSON.stringify(handover, null, 2)}</pre>
      <button onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    {:else}
      <p class="cost">Never handed over? Stop, and register again.</p>
    {/if}
    <button class="drop" onclick={stop}>Stop being wakeable</button>
    <!-- The watch keeps listing you until whoever runs it takes you off. -->
    <p class="cost">Stopping tells nobody.</p>
  </section>
{:else}
  <section class="act">
    <h2>Register this device</h2>
    <Slot k="Paging">
      <Readout value="Not registered" tone="neutral" sub="needs a sender key from whoever runs the executor" />
    </Slot>
    <label for="sender">Sender key</label>
    <textarea id="sender" bind:value={senderKey} rows="3" autocomplete="off" spellcheck="false"
      placeholder="the public half, 87 characters"></textarea>
    {#if error}<p class="error">{error}</p>{/if}
    <button onclick={register} disabled={!senderKey.trim() || busy}>
      {busy ? 'Asking…' : 'Let this device be woken'}
    </button>
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
