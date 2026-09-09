<script lang="ts">
  /**
   * The public roster: operators who chose to be visible on the open web.
   *
   * The surface `visibility: 'public'` exists for, and the one global view in this app — every
   * other list asks a relay for a single metro. It asks for everybody, which is precisely why
   * it only contains people who opted into being asked about.
   *
   * ## What this deliberately is not
   *
   * **Not indexed, and it says so.** Being in a search result needs the names in static HTML,
   * which needs the build to read a relay — and a relay that timed out mid-build would publish
   * a page saying nobody is here. A false page about people is worse than a page a crawler
   * cannot read, so this fetches live and the limit is stated rather than implied.
   *
   * **Not a count.** No number anywhere: a count invites gaming and tells a reader nothing they
   * can act on. Alphabetical, which rewards nothing.
   *
   * **Not vetted.** Nobody has checked any of it, exactly as with the 8,430 directory records.
   */
  import { onMount } from 'svelte';
  import { does, platform as platformOf } from '@navcom/core';
  import { publicRoster } from '$lib/public-roster.svelte';

  onMount(() => {
    publicRoster.start();
    /*
     * The same flag the terminal layout sets, for the same reason.
     *
     * This page is prerendered and then hydrates, so its markup is on screen a beat before
     * anything is wired to it. A test that clicks in that window fails at random and looks
     * like a bug in the page. The terminal solved this with a flag rather than a timeout --
     * it waits for exactly the thing that has to have happened -- and this is the only other
     * page on the site that hydrates at all.
     */
    document.documentElement.dataset.hydrated = 'true';
    return () => publicRoster.stop();
  });
</script>

<svelte:head>
  <title>Operators · NavCom</title>
  <meta name="description" content="Volunteers who chose to be findable here. Nobody has checked any of it." />
</svelte:head>

<h1>Operators</h1>

<p class="lede">
  People who chose to be listed on the open web. Most operators are not here — being findable at
  all is opt-in, and being findable <em>from outside the app</em> is a further step.
</p>

<p class="cost"><strong>Nobody has checked any of this.</strong> Every entry was published by its holder about themselves.</p>

{#if !publicRoster.asked}
  <p class="cost">Loading needs JavaScript. This page is the one part of the site that does.</p>
{:else if publicRoster.loading && publicRoster.entries.length === 0}
  <p class="cost">Asking relays…</p>
{:else if publicRoster.entries.length === 0}
  <!-- Not the same as "nobody uses NavCom". Most operators never publish a card at all. -->
  <p class="cost">
    No operator here has chosen to be listed publicly. That is the ordinary case rather than a
    failure — a card is optional, and this list is a further opt-in on top of it.
  </p>
{:else}
  {#if publicRoster.partial}
    <p class="cost">More are listed than this shows. This is part of the roster, not all of it.</p>
  {/if}
  <ul class="roster">
    {#each publicRoster.entries as e (e.contact)}
      <li>
        <p class="who"><a href="/terminal/who/?k={e.contact}">{e.card.callsign}</a> <em>{e.card.region}</em></p>
        {#if e.card.doing}<p class="doing">{e.card.doing}</p>{/if}
        {#if e.does.length > 0}
          <p class="does">{e.does.map((d) => does(d)?.label ?? d).join(' · ')}</p>
        {/if}
        {#if e.links.length > 0}
          <p class="elsewhere">
            {#each e.links as l (l.platform)}
              <a href={platformOf(l.platform)?.url(l.handle)} rel="noopener noreferrer nofollow"
                 referrerpolicy="no-referrer" target="_blank">{platformOf(l.platform)?.label ?? l.platform}</a>
            {/each}
          </p>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<p class="cost">
  This list is read from relays as you look at it, so it is current — and for the same reason it
  is <strong>not in any search index</strong>.
</p>

<style>
  .lede { font-size: 1.05rem; }
  .roster { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 1.1rem; }
  .roster li { border-top: 1px solid var(--line, #ddd); padding-top: .8rem; }
  .who { margin: 0; font-weight: 600; }
  .who em { font-style: normal; font-weight: 400; opacity: .72; }
  .doing { margin: .2rem 0 0; }
  .does { margin: .15rem 0 0; font-size: .88rem; opacity: .78; }
  .elsewhere { margin: .3rem 0 0; display: flex; flex-wrap: wrap; gap: .6rem; font-size: .88rem; }
</style>
