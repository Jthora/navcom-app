<script lang="ts">
  /**
   * Find [docs/design/groups.md §4]: narrowing what this phone already holds, by name.
   *
   * **It asks nobody, and what is typed never leaves the phone.** No relay query is ever built from
   * it. It reads, in a fixed order and labelled by where each came from: your peers under the names
   * you chose, then the cards seen this session. A city's board, or the people listed publicly, are
   * asked for only on a tap — the board's ask names the city, the roster's the public label, and
   * neither names a person or the text.
   *
   * Names only: callsigns, and four or more hex characters against a key's print. Never what people
   * do, their links or their standing: *find a medic* is a target list. Grouped by source, alphabetical
   * within it, a print beside every name, hidden cards left out, no counts and no suggestions. When
   * nothing matches it says what was searched, never that nobody exists.
   */
  import { onMount } from 'svelte';
  import { keyPrint as printOrNull } from '@navcom/core/card';
  import { Panel, Readout, Slot } from '$lib/components/panel';
  import type { Nav } from '$lib/com/screens';
  import { handleFor, seenCards } from '$lib/people/cache.svelte';
  import { ROSTER_MAX, fetchBoard, fetchRoster, type Asked } from '$lib/people/fetch';
  import { isHidden } from '$lib/hidden';
  import { myCard } from '$lib/terminal/card';
  import { peers } from '$lib/terminal/peers';

  let { nav }: { nav: Nav } = $props();
  /** A key's print, or its first characters where it has none. */
  const keyPrint = (key: string): string => printOrNull(key) ?? key.slice(0, 8);

  let query = $state('');
  /** The directory's regions, for choosing a board: the same file the landing page searches. */
  let regions = $state<{ region: string; name: string }[]>([]);
  let region = $state(myCard()?.region && myCard()?.region !== 'earth' ? myCard()!.region : '');
  let board = $state<{ region: string; asked: Asked } | null>(null);
  let roster = $state<Asked | null>(null);
  let asking = $state(false);
  const mine = peers();

  onMount(() => {
    void fetch('/console-regions.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((f: { centroids?: { region: string; name: string }[] } | null) => {
        regions = [...(f?.centroids ?? [])].sort((a, b) => a.name.localeCompare(b.name));
      })
      .catch(() => {});
  });

  const q = $derived(query.trim().toLowerCase());
  /** Four or more hex characters match a key's print, or the key itself. */
  const hex = $derived(/^[0-9a-f]{4,64}$/.test(q.replace(/\s+/g, '')) ? q.replace(/\s+/g, '') : null);
  const matches = (name: string, key: string) =>
    q !== '' && (name.toLowerCase().includes(q) || (hex !== null && (key.startsWith(hex) || keyPrint(key).replace(/\s+/g, '').startsWith(hex))));

  const peerHits = $derived(mine.filter((p) => matches(p.callsign, p.pubkey)).sort((a, b) => a.callsign.localeCompare(b.callsign)));
  const cardHits = $derived(
    seenCards()
      .filter((c) => !isHidden(c.card.contact) && matches(c.card.card.callsign, c.card.contact))
      .sort((a, b) => a.card.card.callsign.localeCompare(b.card.card.callsign))
  );
  /** A whole key, or a profile link, pasted: opened from the cache, with *Fetch newest* there. */
  const pasted = $derived(/(?:^|[?&]k=)([0-9a-f]{64})\b/.exec(query.trim().toLowerCase())?.[1] ?? null);
  const regionName = $derived(regions.find((r) => r.region === region)?.name ?? region);

  async function loadBoard() {
    if (!region) return;
    asking = true;
    try {
      board = { region, asked: await fetchBoard(region) };
    } finally {
      asking = false;
    }
  }
  async function loadRoster() {
    asking = true;
    try {
      roster = await fetchRoster();
    } finally {
      asking = false;
    }
  }
  const open = (contact: string) => nav.open({ kind: 'profile', h: handleFor(contact) });
</script>

<div data-screen="find">
  <Panel label="Find" post="on this phone">
    <label for="people-q" class="q-label">A callsign, or a key’s first characters</label>
    <input id="people-q" type="search" bind:value={query} autocomplete="off" spellcheck="false" placeholder="Wren" />
    <Slot k="Sent">
      <Readout value="Nothing" tone="good" sub="what you type is searched here and sent nowhere" />
    </Slot>

    {#if pasted}
      <button type="button" class="hit" data-open-pasted onclick={() => open(pasted)}>
        <span class="name">Open this key’s profile</span><span class="print">{keyPrint(pasted)}</span>
      </button>
    {/if}

    {#if q !== ''}
      {#if peerHits.length > 0}
        <h3>Your peers</h3>
        <ul class="hits" data-hits="peers">
          {#each peerHits as p (p.pubkey)}<li class="hit"><span class="name">{p.callsign}</span><span class="print">{keyPrint(p.pubkey)} · paired</span></li>{/each}
        </ul>
      {/if}
      {#if cardHits.length > 0}
        <h3>Cards seen this session</h3>
        <ul class="hits" data-hits="cards">
          {#each cardHits as c (c.card.contact)}
            <li>
              <button type="button" class="hit" data-hit-card={c.card.contact} onclick={() => open(c.card.contact)}>
                <span class="name">{c.card.card.callsign}{c.agent ? ' · an agent' : ''}</span><span class="print">{keyPrint(c.card.contact)}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      {#if peerHits.length === 0 && cardHits.length === 0 && !pasted}
        <span data-find-nothing>
          <Readout
            value="Nothing on this phone matches"
            tone="cold"
            sub={`searched ${mine.length} ${mine.length === 1 ? 'peer' : 'peers'} and ${seenCards().length} ${seenCards().length === 1 ? 'card' : 'cards'} seen this session; ${board ? `${regionName}’s board loaded` : 'no board loaded'}`}
          />
        </span>
      {/if}
    {/if}

    <div class="more">
      <label for="find-region" class="q-label">A city’s board</label>
      <select id="find-region" bind:value={region}>
        <option value="">Choose a city or town</option>
        {#each regions as r (r.region)}<option value={r.region}>{r.name}</option>{/each}
      </select>
      <button type="button" data-load-board disabled={!region || asking} onclick={loadBoard}>
        <span>Load {region ? `${regionName}’s` : 'a'} board</span>
        <span class="said">One ask, naming the city: never a person, never what you typed.</span>
      </button>
      {#if board}
        <Readout
          value={board.asked.answered ? `${board.asked.cards} ${board.asked.cards === 1 ? 'card' : 'cards'}` : 'Unknown'}
          tone={board.asked.answered ? 'neutral' : 'cold'}
          sub={board.asked.answered ? `on ${regionName}’s board, now searchable here` : 'no relay answered'}
        />
      {/if}
      <button type="button" data-load-roster disabled={asking} onclick={loadRoster}>
        <span>Also search people listed publicly</span>
        <span class="said">Only cards their holders chose to list on the open web.</span>
      </button>
      {#if roster}
        <Readout
          value={roster.answered ? `${roster.cards} listed` : 'Unknown'}
          tone={roster.answered ? 'neutral' : 'cold'}
          sub={roster.answered ? (roster.cards >= ROSTER_MAX ? 'more are listed than this holds' : 'now searchable here') : 'no relay answered'}
        />
      {/if}
    </div>
  </Panel>
</div>

<style>
  .q-label {
    font-size: 0.8rem;
    color: var(--t-faint);
  }
  input,
  select {
    width: 100%;
    min-height: 3rem;
  }
  h3 {
    margin: 0.6rem 0 0.2rem;
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--t-faint);
  }
  .hits {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.4rem;
  }
  .hit {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    min-height: 3rem;
    padding: 0.4rem 0.8rem;
    border: 1px solid var(--t-line);
    background: var(--t-sunk);
    color: var(--t-ink);
    font: inherit;
    text-align: start;
  }
  button.hit {
    cursor: pointer;
  }
  .name {
    font-weight: 600;
  }
  .print {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--t-faint);
  }
  .more {
    display: grid;
    gap: 0.5rem;
    margin-top: 0.8rem;
  }
  .more button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.2rem;
    min-height: 3rem;
    padding: 0.5rem 0.8rem;
    border: 1px solid var(--t-line);
    background: var(--t-sunk);
    color: var(--t-ink);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .said {
    font-size: 0.78rem;
    color: var(--t-faint);
  }
</style>
