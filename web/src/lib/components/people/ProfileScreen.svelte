<script lang="ts">
  /**
   * Anybody's profile [docs/design/groups.md §3, *Anybody's*]: a readout of a card this phone has
   * seen, opened from a name on a report, a board or Find.
   *
   * **There is no lit action, because a profile is a readout.** Three controls: *Fetch newest* asks
   * relays for this one card, and says they learn that this phone asked; *Write to them* sends the
   * existing invite, and is gone once *With you* says you are paired; *Check links* opens the page
   * that checks proofs. Nothing derived is shown — no crews, endorsements, watch membership,
   * standing, counts, mutuals or *out tonight*.
   *
   * Named by a handle, never a key: after a wipe or a reload the handle names nobody, and the screen
   * says *Not on this phone* and fetches nothing.
   */
  import { NOTE_MAX } from '@navcom/core';
  import { does as doesOf, keyPrint as printOrNull, platform } from '@navcom/core/card';
  import { Panel, Readout, Slot } from '$lib/components/panel';
  import type { Nav } from '$lib/com/screens';
  import { contactOf, seen } from '$lib/people/cache.svelte';
  import { fetchCard, type Asked } from '$lib/people/fetch';
  import { isHidden } from '$lib/hidden';
  import { loadIdentity } from '$lib/terminal/identity';
  import { invite } from '$lib/terminal/invites.svelte';
  import { peerByCard } from '$lib/terminal/peers';

  let { h, now }: { h: string; nav: Nav; now: number } = $props();
  /** A key's print, or its first characters where it has none. */
  const keyPrint = (key: string): string => printOrNull(key) ?? key.slice(0, 8);

  const contact = $derived(contactOf(h));
  const held = $derived(contact ? seen(contact) : null);
  const hidden = $derived(contact !== null && isHidden(contact));
  let asked = $state<Asked | null>(null);
  let asking = $state(false);
  let writing = $state(false);
  let note = $state('');
  let wrote = $state<'sent' | 'unsent' | null>(null);
  const signedOn = loadIdentity()?.callsign != null;
  /** Paired by writing to this card, and not wiped since: the only way this phone knows [peers.ts]. */
  const withYou = $derived(contact && signedOn ? peerByCard(contact) : null);
  /** Up to three terms, an unknown one dropped [groups.md §3]. */
  const doesSaid = $derived(held ? held.card.does.flatMap((d) => doesOf(d)?.label ?? []).slice(0, 3) : []);
  const dayOf = (seconds: number) => new Date(seconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  /** How long ago, in the largest whole unit. */
  function ago(seconds: number): string {
    const s = Math.max(0, Math.floor(now / 1000) - seconds);
    if (s < 90) return 'just now';
    if (s < 5400) return `${Math.round(s / 60)} min ago`;
    if (s < 129_600) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86_400)} d ago`;
  }

  async function fetchNewest() {
    if (!contact || hidden) return;
    asking = true;
    try {
      asked = await fetchCard(contact);
    } finally {
      asking = false;
    }
  }

  async function write() {
    if (!contact) return;
    asking = true;
    try {
      wrote = (await invite(contact, note.trim())) ? 'sent' : 'unsent';
      if (wrote === 'sent') writing = false;
    } finally {
      asking = false;
    }
  }
</script>

<div data-screen="profile">
  <Panel label="Profile" post={held && !hidden ? held.card.card.callsign : null}>
    {#if !contact}
      <!-- History holds a handle; the person it named went with the reload or the wipe. -->
      <Slot k="Who"><Readout value="Not on this phone" tone="cold" sub="this screen named somebody this phone has since forgotten" /></Slot>
    {:else}
      <Slot k="Name">
        {#if held && !hidden}
          <Readout
            value={held.card.card.callsign}
            verbatim
            tone="neutral"
            sub={`${keyPrint(contact)}${held.agent ? ' · an agent' : ''}`}
          />
        {:else}
          <Readout value={keyPrint(contact)} verbatim tone="cold" sub="the key’s first characters; no card read" />
        {/if}
      </Slot>
      <Slot k="Card">
        <span data-profile-card={hidden ? 'hidden' : held ? 'seen' : asked ? (asked.answered ? 'none' : 'unanswered') : 'unread'}>
          {#if hidden}
            <Readout value="Not displayed" tone="cold" sub="navcom.app does not display this card" />
          {:else if held}
            <Readout value={`From ${ago(held.card.at)}`} tone="neutral" sub={`seen on this phone ${ago(Math.floor(held.seenAt / 1000))}`} />
          {:else if asked && !asked.answered}
            <Readout value="Unknown" tone="cold" sub="no relay answered" />
          {:else if asked}
            <Readout value="No card" tone="cold" sub="at this address, on the relays that answered" />
          {:else}
            <Readout value="Not on this phone" tone="cold" sub="fetch the newest to see it" />
          {/if}
        </span>
      </Slot>
      {#if held && !hidden}
        <Slot k="Doing">
          {#if held.card.card.doing}<q class="their-words">{held.card.card.doing}</q>{:else}<Readout value="—" tone="cold" />{/if}
        </Slot>
        <Slot k="Area">
          <Readout value={held.areas.length > 0 ? held.areas.map((a) => a.name ?? a.id).join(' · ') : 'Earth'} tone="neutral" sub="what they say" />
        </Slot>
        <Slot k="Does">
          <Readout value={doesSaid.length > 0 ? doesSaid.join(' · ') : '—'} tone="neutral" />
        </Slot>
        <Slot k="Links">
          {#if held.card.links.length > 0}
            <ul class="links">{#each held.card.links as l (l.platform)}<li>{platform(l.platform)?.label ?? l.platform}: {l.handle}</li>{/each}</ul>
          {:else}
            <Readout value="—" tone="cold" />
          {/if}
        </Slot>
      {/if}
      <Slot k="Checked"><Readout value="Nobody" tone="cold" sub="has checked this card" /></Slot>
      {#if signedOn}
        <Slot k="With you">
          <span data-with-you={withYou ? 'paired' : 'unknown'}>
            {#if withYou}
              <Readout value={`Paired since ${dayOf(withYou.since)}`} tone="neutral" sub={`you call them ${withYou.callsign}`} />
            {:else}
              <!-- Never "not paired": a pairing by code, or one from before a wipe, cannot be told from none. -->
              <Readout value="Not known" tone="cold" sub="only a pairing made by writing to this card shows here" />
            {/if}
          </span>
        </Slot>
      {/if}

      {#if !hidden}
        <div class="rail">
          <button type="button" data-fetch-card disabled={asking} onclick={fetchNewest}>
            <span>Fetch newest</span>
            <span class="said">The relays learn that this phone asked for this card.</span>
          </button>
          {#if signedOn && held && !withYou}
            {#if writing}
              <label for="note">Say who you are</label>
              <textarea id="note" bind:value={note} rows="2" maxlength={NOTE_MAX} placeholder="Out most Thursdays around the north side."></textarea>
              <button type="button" data-write-send disabled={asking} onclick={write}>Send</button>
            {:else}
              <button type="button" data-write onclick={() => ((writing = true), (wrote = null))}>Write to them</button>
            {/if}
            {#if wrote === 'sent'}
              <Readout value="Sent" tone="good" sub="if they accept, they appear on Peers" />
            {:else if wrote === 'unsent'}
              <Readout value="Not sent" tone="warn" sub="no relay took it; try again with signal" />
            {/if}
          {/if}
          <a href={`/terminal/who/?k=${contact}`} data-sveltekit-reload data-check-links>Check links</a>
        </div>
      {/if}
    {/if}
  </Panel>
</div>

<style>
  .their-words {
    color: var(--t-ink);
    font-size: 0.95rem;
  }
  .links {
    margin: 0;
    padding-inline-start: 1.1rem;
    font-size: 0.9rem;
    color: var(--t-ink);
  }
  .rail {
    display: grid;
    gap: 0.5rem;
    margin-top: 0.6rem;
  }
  .rail button,
  .rail a {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 0.2rem;
    min-height: 3rem;
    padding: 0.5rem 0.8rem;
    border: 1px solid var(--t-line);
    background: var(--t-sunk);
    color: var(--t-ink);
    font: inherit;
    text-align: start;
    text-decoration: none;
    cursor: pointer;
  }
  .said {
    font-size: 0.78rem;
    color: var(--t-faint);
  }
  textarea {
    width: 100%;
  }
</style>
