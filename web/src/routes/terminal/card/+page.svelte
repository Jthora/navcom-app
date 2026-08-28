<script lang="ts">
  /**
   * Your card — the one thing in this app that makes an operator public.
   *
   * Every claim about what publishing costs is stated *above* the form, not after it,
   * because the decision is made before the button and an explanation underneath it is an
   * explanation nobody read.
   */
  import { onMount } from 'svelte';
  import { Slot, Readout, Why } from '$lib/components/panel';
  import { DOING_MAX } from '@navcom/core';
  import { contactPubkey, listed, myCard, setListed, withdrawCard, type MyCard } from '$lib/terminal/card';
  import { loadIdentity } from '$lib/terminal/identity';
  import { publishCard } from '$lib/terminal/public.svelte';

  let { data } = $props();

  let published = $state<MyCard | null>(null);
  let contact = $state<string | null>(null);
  let callsign = $state<string | null>(null);
  let region = $state('');
  let doing = $state('');
  let showListed = $state(false);
  let busy = $state(false);
  let confirming = $state(false);

  onMount(() => {
    published = myCard();
    contact = contactPubkey();
    callsign = loadIdentity()?.callsign ?? null;
    showListed = listed();
    if (published) {
      region = published.region;
      doing = published.doing ?? '';
    }
  });

  const left = $derived(DOING_MAX - doing.length);

  async function publish() {
    if (!region || busy) return;
    busy = true;
    try {
      await publishCard({ region, doing: doing.trim() || undefined });
      published = myCard();
      contact = contactPubkey();
    } finally {
      busy = false;
    }
  }

  function withdraw() {
    withdrawCard();
    published = null;
    contact = null;
    showListed = false;
    confirming = false;
    region = '';
    doing = '';
  }

  function toggleListed() {
    showListed = !showListed;
    setListed(showListed);
  }
</script>

<svelte:head>
  <title>Your card · Field Terminal</title>
  <meta name="description" content="Being findable, and what it costs." />
</svelte:head>

<header>
  <p class="eyebrow"><a href="/terminal/">← Status</a></p>
  <h1>Your card</h1>
</header>

<section>
  <p>
    A card lets somebody in your area find you and ask to pair, without either of you
    knowing the other first. <strong>You have no card unless you publish one</strong>, and
    the app works exactly the same without it.
  </p>
  <Why summary="What publishing does and doesn't expose">
    <p>
      <!--
        The claim that makes a card safe to publish, stated before the form rather than after
        it. It is also the reason the contact key exists at all.
      -->
      A card is signed by a <strong>separate key</strong> that is used for nothing else. It
      cannot be connected to your patrols, your peers or your watch — publishing one tells the
      network your callsign and your metro, and nothing about how you work.
    </p>
    <p>
      <strong>A card carries no position.</strong> Not your address, not your neighbourhood,
      not a coarse pin. There is nowhere in it to put one.
    </p>
  </Why>
  <p class="cost">
    <!-- Reducing exposure is never symmetrical with increasing it. Saying so is the rule. -->
    <strong>Publishing cannot be undone.</strong> Withdrawing throws away the key that signs
    your card, so nobody can reach you at it again and no invite sent to it arrives — but
    relays that already have the card may keep serving it. Nothing can unpublish it, and
    anything claiming otherwise would be lying to you.
  </p>
</section>

{#if !callsign}
  <section class="act">
    <p>Pick a callsign first — <a href="/terminal/setup/">it takes one screen</a>.</p>
  </section>
{:else}
  <section class="act">
    <h2>{published ? 'Your card' : 'Publish a card'}</h2>

    <label for="region">Where you work</label>
    <select id="region" bind:value={region}>
      <option value="">Choose an area</option>
      {#each data.regions as r (r.slug)}
        <option value={r.slug}>{r.name} · {r.country}</option>
      {/each}
    </select>
    <p class="cost">A metro, and never anything smaller.</p>

    <label for="doing">What you do</label>
    <textarea id="doing" bind:value={doing} rows="2" maxlength={DOING_MAX}
      placeholder="Water and socks, Thursdays."></textarea>
    <p class="cost">
      Optional, and often the most useful part. {left} characters left.
      <strong>Nothing about anybody you have helped</strong> — write about the work, not the
      people.
    </p>

    <button onclick={publish} disabled={!region || busy}>
      {published ? 'Replace your card' : 'Publish your card'}
    </button>

    {#if published && contact}
      <Slot k="Card">
        <Readout value="Published" tone="good" sub="as {callsign}" />
      </Slot>
      <p class="cost">
        Anybody browsing that area can see it and ask to pair. You decide who to accept, and
        ignoring somebody sends them nothing.
      </p>
    {/if}
  </section>

  {#if published}
    <section class="act">
      <h2>Out tonight</h2>
      <p class="cost">
        With this on, signing on adds your name to that area's board while you are out —
        <strong>a name and nothing else</strong>. No position, no times, and no count of
        anybody. It comes off by itself when you stand down or your phone stops.
      </p>
      <button onclick={toggleListed} aria-pressed={showListed}>
        {showListed ? 'Listed while out' : 'Not listed'}
      </button>
      <Slot k="On board while out">
        <Readout
          value={showListed ? 'Listed' : 'Not listed'}
          tone={showListed ? 'good' : 'neutral'}
          sub={showListed
            ? 'your callsign appears on the board while signed on'
            : 'nothing published when you sign on — the default'}
        />
      </Slot>
    </section>

    <section class="act">
      <h2>Withdraw</h2>
      <p class="cost">
        Throws away the key that signs your card. Invites sent to it stop arriving. Relays
        that already have the card may keep serving it — <strong>this cannot unpublish
        it</strong>.
      </p>
      {#if confirming}
        <button class="danger" onclick={withdraw}>Throw the key away</button>
        <button onclick={() => (confirming = false)}>Keep my card</button>
      {:else}
        <button onclick={() => (confirming = true)}>Withdraw my card</button>
      {/if}
    </section>
  {/if}
{/if}

<style>
  .act { gap: .6rem; }
  select, textarea { width: 100%; }
  .danger { border-color: var(--t-alarm); color: var(--t-alarm); }
</style>
