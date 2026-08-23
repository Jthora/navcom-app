<script lang="ts">
  /**
   * The board for one area: who published a card, and who is out tonight.
   *
   * This screen is a bulletin board, not a directory the app assembled. Everybody here
   * pinned themselves up. Nothing is suggested, ranked or inferred from who knows whom, and
   * the ordering is alphabetical precisely because it rewards nothing.
   *
   * It is reached from Peers rather than from Status: finding somebody is something you do
   * at a table, not something you do with one hand on a patrol.
   */
  import { onMount } from 'svelte';
  import { Slot, Readout } from '$lib/components/panel';
  import { NOTE_MAX } from '@navcom/core';
  import { board } from '$lib/terminal/public.svelte';
  import { invite } from '$lib/terminal/invites.svelte';
  import { loadIdentity } from '$lib/terminal/identity';
  import { contactPubkey, myCard } from '$lib/terminal/card';

  let { data } = $props();

  let region = $state('');
  let callsign = $state<string | null>(null);
  let mine = $state<string | null>(null);
  let asking = $state<string | null>(null);
  let note = $state('');
  let sent = $state<string[]>([]);
  let busy = $state(false);

  onMount(() => {
    callsign = loadIdentity()?.callsign ?? null;
    mine = contactPubkey();
    // Somebody who published a card almost certainly wants to see their own area first.
    const own = myCard()?.region;
    if (own) {
      region = own;
      board.watch(own);
    }
    return () => board.stop();
  });

  function choose(event: Event) {
    region = (event.target as HTMLSelectElement).value;
    asking = null;
    if (region) board.watch(region);
    else board.stop();
  }

  /** Who we could not reach a relay for. */
  let failed = $state<string | null>(null);

  async function ask(contact: string) {
    if (busy) return;
    busy = true;
    try {
      // Marked sent whatever happened, so an operator with no signal watched it succeed and
      // waited for a reply to something that never left the device.
      if (await invite(contact, note.trim())) {
        sent = [...sent, contact];
        asking = null;
        note = '';
        failed = null;
      } else {
        failed = contact;
      }
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>Find · Field Terminal</title>
  <meta name="description" content="Operators who published a card in your area." />
</svelte:head>

<header>
  <p class="eyebrow"><a href="/terminal/peers/">← Peers</a></p>
  <h1>Find</h1>
</header>

<section>
  <p>
    Everybody here <strong>published a card about themselves</strong>. Nobody is listed by
    being paired with somebody, nothing suggests anyone, and the order is alphabetical
    because it should reward nothing.
  </p>
  <p class="cost">
    <!--
      What sending an invite costs the sender, before they send one. It is the only moment
      an operational key leaves this device to somebody unmet.
    -->
    Asking somebody to pair <strong>gives them your key</strong> and the line you write.
    They can ignore it, and you will never know — there is no read receipt and no refusal,
    on purpose.
  </p>
  <p class="cost">
    Nothing about anybody you have helped goes in that line [invariant 1]. Write about
    yourself and the work.
  </p>
  <p class="cost">
    <strong>You are not on this board unless you put yourself there.</strong>
    <a href="/terminal/card/">Your card</a> is where that happens, and having none is the
    default.
  </p>
</section>

<section class="act">
  <label for="area">Area</label>
  <select id="area" value={region} onchange={choose}>
    <option value="">Choose an area</option>
    {#each data.regions as r (r.slug)}
      <option value={r.slug}>{r.name} · {r.country}</option>
    {/each}
  </select>
</section>

{#if region}
  <section>
    {#if board.loading}
      <p class="cost">Asking the relays…</p>
    {:else if board.entries.length === 0}
      <!-- Said plainly rather than as an error. An empty board in a real metro is the
           ordinary case early on, and it is not a failure of anything. -->
      <Slot k="Cards">
        <Readout value="None here" tone="cold" sub="most operators never publish one" />
      </Slot>
      <p class="cost">
        Nobody has published a card here. That is normal — most operators never do, and it
        says nothing about whether anybody is working this area.
      </p>
    {:else}
      {#if board.partial}
        <!-- A list that silently stops looks like a complete list. Somebody looking for one
             particular operator would conclude they are not here. -->
        <p class="cost" data-board-partial>
          More cards are published here than this can show, so this is part of the board.
          If you are looking for somebody in particular, ask them for their code directly.
        </p>
      {/if}
      <ul class="board">
        {#each board.entries as e (e.contact)}
          <li>
            <div class="who">
              <span class="name">{e.callsign}</span>
              {#if e.out}<span class="badge">out tonight</span>{/if}
            </div>
            {#if e.doing}<p class="doing">{e.doing}</p>{/if}
            {#if e.lightning}
              <!--
                A string to copy, and nothing that looks like a checkout. No amount, no
                suggested figure, no total received -- funding.md forbids all three, and a
                "support" button with a number beside it is how a leaderboard starts.
              -->
              <p class="ln" data-lightning>{e.lightning}</p>
            {/if}

            {#if e.contact === mine}
              <p class="cost">This is your card.</p>
            {:else if sent.includes(e.contact)}
              <p class="cost">Sent. If they want to pair, they will appear on Peers.</p>
            {:else if failed === e.contact}
              <!--
                It said "Sent." whatever happened, so an operator with no signal watched it
                succeed and then waited for a reply to something that never left the phone.
              -->
              <p class="cost" data-invite-failed>
                That did not reach a relay, so it has not been sent. Try again when you have
                signal.
              </p>
              <button onclick={() => ask(e.contact)} disabled={busy}>Try again</button>
            {:else if !callsign}
              <p class="cost"><a href="/terminal/setup/">Pick a callsign</a> to ask.</p>
            {:else if asking === e.contact}
              <label for="note">Say who you are</label>
              <textarea id="note" bind:value={note} rows="2" maxlength={NOTE_MAX}
                placeholder="Out most Thursdays around the north side."></textarea>
              <button onclick={() => ask(e.contact)} disabled={busy}>Send</button>
              <button onclick={() => (asking = null)}>Cancel</button>
            {:else}
              <button onclick={() => { asking = e.contact; note = ''; }}>Ask to pair</button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .act { gap: .6rem; }
  select, textarea { width: 100%; }
  .board { list-style: none; margin: 0; padding: 0; }
  .board li {
    display: flex; flex-direction: column; gap: .5rem;
    border-bottom: 1px solid var(--t-line); padding-block: .9rem;
  }
  .who { display: flex; align-items: center; gap: .7rem; }
  .name { color: var(--t-ink); font-weight: 650; font-size: 1.02rem; }
  .badge {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .62rem; letter-spacing: .1em; text-transform: uppercase;
    color: var(--t-station); border: 1px solid var(--t-station); padding: .1rem .3rem;
  }
  .doing { margin: 0; color: var(--t-faint); font-size: .92rem; }
  .ln {
    margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .82rem; color: var(--t-muted);
  }
</style>
