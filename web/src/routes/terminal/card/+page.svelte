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
  import {
    DOES,
    DOES_MAX,
    DOING_MAX,
    layout,
    LINKS_MAX,
    PLATFORMS,
    platform as platformOf,
    VISIBILITY_CHOICES,
    type CardLink,
    type Visibility
  } from '@navcom/core';
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

  let visibility = $state<Visibility>('board');
  let does = $state<string[]>([]);
  let links = $state<CardLink[]>([]);
  let newPlatform = $state('');
  let newHandle = $state('');

  onMount(() => {
    published = myCard();
    contact = contactPubkey();
    callsign = loadIdentity()?.callsign ?? null;
    showListed = listed();
    if (published) {
      region = published.region;
      doing = published.doing ?? '';
      visibility = published.visibility ?? 'board';
      does = [...(published.does ?? [])];
      links = [...(published.links ?? [])];
    }
  });

  const left = $derived(DOING_MAX - doing.length);

  async function publish() {
    if (!region || busy) return;
    busy = true;
    try {
      await publishCard({
        region,
        doing: doing.trim() || undefined,
        visibility,
        does: [...does],
        links: [...links]
      });
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
    withdrawExtras();
  }

  /** At most `DOES_MAX`. Choosing is an act, so the cap is felt rather than explained. */
  function toggleDoes(id: string) {
    if (does.includes(id)) does = does.filter((d) => d !== id);
    else if (does.length < DOES_MAX) does = [...does, id];
  }

  const shape = $derived(layout(links));

  /** What this link's position currently means. Shown so the ordering teaches itself. */
  function rankOf(link: CardLink): string {
    if (shape.feature?.platform === link.platform) return 'Featured';
    if (shape.beside.some((b) => b.platform === link.platform)) return 'Beside it';
    return 'Listed';
  }

  const canAdd = $derived(
    newPlatform !== '' &&
      newHandle.trim() !== '' &&
      links.length < LINKS_MAX &&
      !links.some((l) => l.platform === newPlatform)
  );

  function addLink() {
    if (!canAdd) return;
    links = [...links, { platform: newPlatform, handle: newHandle.trim() }];
    newPlatform = '';
    newHandle = '';
  }

  function removeLink(id: string) {
    links = links.filter((l) => l.platform !== id);
  }

  /** Rank is position, so reordering is the only way to change it. */
  function move(id: string, by: -1 | 1) {
    const at = links.findIndex((l) => l.platform === id);
    const to = at + by;
    if (at < 0 || to < 0 || to >= links.length) return;
    const next = [...links];
    [next[at], next[to]] = [next[to]!, next[at]!];
    links = next;
  }

  function withdrawExtras() {
    visibility = 'board';
    does = [];
    links = [];
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
  <p><strong>You have no card unless you publish one</strong>, and the app works the same without it.</p>
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
  <!--
    Reducing exposure is never symmetrical with increasing it, and saying so is the rule. The
    force of it is in the first four words; the other forty-nine explain, and explanation is
    what `Why` is for. Kept word for word, one tap away.
  -->
  <p class="cost"><strong>Publishing cannot be undone.</strong></p>
  <Why summary="What withdrawing can and cannot do">
    <p>
      A card lets somebody in your area find you and ask to pair, without either of you knowing
      the other first. Withdrawing throws away the key that signs your card, so nobody can reach
      you at it again and no invite sent to it arrives — but relays that already have the card
      may keep serving it. Nothing can unpublish it, and anything claiming otherwise would be
      lying to you.
    </p>
  </Why>
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
    <p class="cost">Optional. {left} characters left.</p>
    <Why summary="What not to write here">
      <p>
        <strong>Nothing about anybody you have helped</strong> — write about the work, not the
        people.
      </p>
    </Why>

    <fieldset class="pick">
      <legend>Who can find you</legend>
      {#each VISIBILITY_CHOICES as choice (choice.value)}
        <label class="opt">
          <input type="radio" name="visibility" value={choice.value} bind:group={visibility} />
          <span>
            <strong>{choice.label}</strong>
            <!--
              The audience, not a category name. A category can be believed to mean more than
              it does; a sentence about who can see something cannot. `address` says out loud
              that the card is still published, because there is no server here to enforce
              anything stronger and implying one is the failure invariant 4 exists to forbid.
            -->
            <em>{choice.audience}</em>
          </span>
        </label>
      {/each}
    </fieldset>

    <fieldset class="pick">
      <legend>What you do</legend>
      <p class="cost">Optional. {DOES_MAX - does.length} left.</p>
      <Why summary="Nobody checks this">
        <p>
          <strong>Nobody checks any of this</strong> — it says what you do, never what you are
          qualified for.
        </p>
      </Why>
      {#each DOES as d (d.id)}
        <label class="opt">
          <input
            type="checkbox"
            checked={does.includes(d.id)}
            disabled={!does.includes(d.id) && does.length >= DOES_MAX}
            onchange={() => toggleDoes(d.id)}
          />
          <span><strong>{d.label}</strong> <em>{d.means}</em></span>
        </label>
      {/each}
    </fieldset>

    <fieldset class="pick">
      <legend>Where else to find you</legend>
      <p class="cost">Optional, and off unless you add one.</p>
      <Why summary="This is permanent, and it is a join">
        <p>
          Anybody reading your card can connect this callsign to that account from now on,
          <strong>including after you remove it here</strong>, because relays keep what they
          were given.
        </p>
      </Why>
      <Why summary="Why the first one is bigger">
        <p>
          The first is shown as a feed, the next two beside it, the rest as links. Move them
          to change that. Some platforms refuse to be shown at all, so those stay links
          however you order them — better that than a panel that never fills.
        </p>
      </Why>

      {#each links as l (l.platform)}
        <div class="link">
          <p class="who">
            <strong>{platformOf(l.platform)?.label ?? l.platform}</strong>
            <em>{l.handle}</em>
          </p>
          <!--
            Rank and controls on their own line. On a 390px screen the one-line version wrapped
            the remove button onto a row of its own, which read as belonging to the next link.
          -->
          <p class="controls">
            <span class="rank">{rankOf(l)}</span>
            <span class="buttons">
              <button class="tiny" onclick={() => move(l.platform, -1)} disabled={links.indexOf(l) === 0} aria-label="Move {platformOf(l.platform)?.label} up">↑</button>
              <button class="tiny" onclick={() => move(l.platform, 1)} disabled={links.indexOf(l) === links.length - 1} aria-label="Move {platformOf(l.platform)?.label} down">↓</button>
              <button class="tiny" onclick={() => removeLink(l.platform)} aria-label="Remove {platformOf(l.platform)?.label}">✕</button>
            </span>
          </p>
        </div>
      {/each}

      {#if links.length < LINKS_MAX}
        <div class="add">
          <label class="sr" for="platform">Platform</label>
          <select id="platform" bind:value={newPlatform}>
            <option value="">Add a platform</option>
            {#each PLATFORMS as p (p.id)}
              <option value={p.id} disabled={links.some((l) => l.platform === p.id)}>{p.label}</option>
            {/each}
          </select>
          <label class="sr" for="handle">Handle</label>
          <input id="handle" bind:value={newHandle} placeholder="your handle" autocomplete="off" />
          <button onclick={addLink} disabled={!canAdd}>Add</button>
        </div>
      {/if}
    </fieldset>

    <button onclick={publish} disabled={!region || busy}>
      {published ? 'Replace your card' : 'Publish your card'}
    </button>

    {#if published && contact}
      <Slot k="Card">
        <Readout value="Published" tone="good" sub="as {callsign}" />
      </Slot>
      <Why summary="Who can see it">
        <p>
          Anybody browsing that area can see it and ask to pair. You decide who to accept, and
          ignoring somebody sends them nothing.
        </p>
      </Why>
    {/if}
  </section>

  {#if published}
    <section class="act">
      <h2>Out tonight</h2>
      <Why summary="What gets published">
        <p>
          With this on, signing on adds your name to that area's board while you are out —
          <strong>a name and nothing else</strong>. No position, no times, and no count of
          anybody. It comes off by itself when you stand down or your phone stops.
        </p>
      </Why>
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
      <Why summary="What withdrawing does">
        <p>
          Throws away the key that signs your card. Invites sent to it stop arriving. Relays
          that already have the card may keep serving it — <strong>this cannot unpublish
          it</strong>.
        </p>
      </Why>
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

  .pick { border: 1px solid var(--t-line); border-radius: 4px; padding: .55rem .7rem; margin: 0; }
  .pick legend { padding: 0 .35rem; font-size: .8rem; text-transform: uppercase; letter-spacing: .08em; }
  /* A row a thumb can hit, with the consequence on the same line as the choice. */
  .opt { display: flex; gap: .55rem; align-items: baseline; padding: .4rem 0; min-height: 2.75rem; }
  .opt em { display: block; font-style: normal; opacity: .78; font-size: .86rem; }
  .opt input { margin-top: .2rem; }

  /* Two lines, always. Never a wrap that orphans a control under the wrong link. */
  .link { padding: .5rem 0; border-bottom: 1px solid var(--t-line); }
  .link:last-of-type { border-bottom: 0; }
  .link .who { margin: 0 0 .3rem; overflow-wrap: anywhere; }
  .link .who em { font-style: normal; opacity: .78; }
  .link .controls { margin: 0; display: flex; align-items: center; justify-content: space-between; gap: .5rem; }
  .link .buttons { display: flex; gap: .35rem; flex: 0 0 auto; }
  .rank { font-size: .74rem; text-transform: uppercase; letter-spacing: .07em; opacity: .7; }
  /* Still 44px of target: the glyph is small, the button is not. */
  .tiny { min-width: 2.75rem; min-height: 2.75rem; padding: 0; }
  .tiny:disabled { opacity: .35; }

  /*
   * Add gets its own full-width row rather than sitting at the end of the handle field.
   *
   * The signature toggle is `position: fixed` in the bottom-right corner, and a compact Add
   * button landed underneath it -- measured overlapping by 60 x 44px. Playwright still
   * clicked it, because it re-scrolls before clicking; a thumb does not, and would have hit
   * the toggle instead. Full width puts the button's centre well clear of that corner.
   */
  .add { display: flex; gap: .4rem; flex-wrap: wrap; align-items: center; }
  .add select { flex: 1 1 100%; width: 100%; }
  .add input { flex: 1 1 100%; min-width: 0; }
  .add button { flex: 1 1 100%; }

  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
