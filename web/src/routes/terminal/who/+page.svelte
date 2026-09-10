<script lang="ts">
  /**
   * One operator's card, reached by their address.
   *
   * ## Why a query parameter and not `/who/[contact]/`
   *
   * The site is `adapter-static` with `fallback: undefined, strict: true` — every route has to
   * be prerenderable, and contact keys are not knowable at build time. A dynamic segment would
   * mean adding a fallback page, which is a change to how the whole site is served for the sake
   * of one screen. One prerendered page reading a key from the URL costs nothing and works
   * offline, which a fallback would not. The terminal already does this for `?ack=`.
   *
   * ## Nothing here is derived
   *
   * A profile is one card, rendered. No activity, no history, no "also known", no suggestions,
   * nothing inferred from who knows whom. Everything on this screen was published by the person
   * it describes, and **nobody has checked any of it** — which the screen says, because a page
   * that looks like a profile invites the belief that somebody vetted it.
   */
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { Slot, Readout, Why } from '$lib/components/panel';
  import { does, embedUrl, frameHeight, layout, platform as platformOf } from '@navcom/core';
  import { profile } from '$lib/terminal/public.svelte';
  import { isLean } from '$lib/terminal/lean';

  let key = $state('');
  /** Decided once, on mount, by the phone rather than by asking the reader. */
  let lean = $state(false);
  let host = $state('');
  /**
   * Where the reader actually came from.
   *
   * This said *"← Find somebody"* unconditionally, pointing at a terminal screen. Somebody
   * arriving from the public roster — a recruit, which is the audience public visibility
   * exists for — got a back arrow into a part of the app they had never seen. A control
   * whose label names a destination has to name the right one; that is the same lesson as
   * the signature toggle, which read `DOCUMENT` while the mode was low signature.
   */
  let cameFrom = $state<{ href: string; label: string }>({
    href: '/terminal/find/',
    label: 'Find somebody'
  });

  onMount(() => {
    key = page.url.searchParams.get('k') ?? '';
    lean = isLean();
    host = location.hostname;

    // Same-origin only: a referrer from anywhere else tells us nothing we should act on.
    try {
      const from = document.referrer ? new URL(document.referrer) : null;
      if (from && from.origin === location.origin) {
        if (from.pathname.startsWith('/who')) cameFrom = { href: '/who/', label: 'Operators' };
        else if (from.pathname.startsWith('/terminal/find')) {
          cameFrom = { href: '/terminal/find/', label: 'Find somebody' };
        }
      }
    } catch {
      // A malformed referrer is not worth a broken screen. The default stands.
    }
    if (key) profile.watch(key);
    return () => profile.stop();
  });

  const card = $derived(profile.card);
  const shape = $derived(layout(card?.links ?? []));
  /**
   * The frame for the featured platform, or null.
   *
   * Null on a lean connection, so a phone that asked for less gets the facade and the same
   * link -- the page is never missing anything, only lighter.
   */
  const frame = $derived(
    !lean && shape.feature && host ? embedUrl(shape.feature, host) : null
  );
  const url = (p: string, h: string) => platformOf(p)?.url(h) ?? '#';
  const name = (p: string) => platformOf(p)?.label ?? p;
</script>

<svelte:head>
  <title>An operator · Field Terminal</title>
  <meta name="description" content="One operator's card, and what nobody has checked about it." />
</svelte:head>

<header>
  <p class="eyebrow"><a href={cameFrom.href}>← {cameFrom.label}</a></p>
  <h1>{card ? card.card.callsign : 'An operator'}</h1>
</header>

{#if !key}
  <section class="act">
    <Slot k="Card"><Readout value="No address" tone="cold" sub="this link carries no key" /></Slot>
    <p class="cost">A profile is reached by somebody's address. <a href="/terminal/find/">Browse an area</a> instead.</p>
  </section>
{:else if profile.loading && !card}
  <section class="act">
    <Slot k="Card"><Readout value="Asking" tone="neutral" sub="relays have not answered yet" /></Slot>
  </section>
{:else if !card}
  <section class="act">
    <!--
      Not found is not the same as does not exist. A relay serves what it has, and an operator
      who withdrew their card leaves one that no relay may still carry. Saying "no card here"
      claims more than we know.
    -->
    <Slot k="Card"><Readout value="Nothing here" tone="cold" sub="no relay we asked has a card for this address" /></Slot>
    <Why summary="Why that is not the same as no card">
      <p>
        That address may never have published one, or may have withdrawn it, or the relays this
        phone knows may simply not have it. <strong>These are different things and this screen
        cannot tell them apart.</strong>
      </p>
    </Why>
  </section>
{:else}
  <section class="act">
    <Slot k="Working">
      <Readout
        value={profile.out ? 'Out tonight' : 'Not listed'}
        tone={profile.out ? 'good' : 'neutral'}
        sub={card.card.region}
      />
    </Slot>

    {#if card.card.doing}
      <p class="doing">{card.card.doing}</p>
    {/if}

    {#if card.does.length > 0}
      <!-- Their claims, in their words. Never a badge, never a qualification. -->
      <p class="does">{card.does.map((d) => does(d)?.label ?? d).join(' · ')}</p>
    {/if}

    <!--
      A readout and a Why, not a paragraph. The claim still comes before the links and still
      says the same thing; `panel.md` sets a 40-word target for what is read before anything is
      opened, and this screen was over it. `Why` takes the prose as a slot and changes none of
      it, which is the mechanism this project already chose for exactly this.
    -->
    <Slot k="Checked">
      <Readout value="By nobody" tone="cold" sub="published by its holder" />
    </Slot>
    <Why summary="What that means">
      <p>
        Everything on this page was published by the holder of this address, about themselves.
        No part of it has been checked by anybody — the same claim every one of the 8,430
        directory records carries, said here because a page shaped like a profile invites the
        belief that somebody vetted it.
      </p>
    </Why>

    {#if card.card.lightning}
      <Slot k="Support">
        <Readout value="Lightning" tone="neutral" sub={card.card.lightning} />
      </Slot>
    {/if}
  </section>

  {#if shape.feature || shape.listed.length > 0}
    <section class="act">
      <h2>Where else they are</h2>
      <Why summary="What happens when you tap one">
        <p>
          Nothing on this page contacts any of these platforms until you tap. Then you leave
          NavCom and go to them, and <strong>they are told nothing about which card you were
          reading</strong> — the link carries no referrer.
        </p>
      </Why>

      {#if shape.feature}
        {@const f = shape.feature}
        {#if frame}
          <!--
            A frame, not a script. Every platform here has a keyless iframe, so nothing of
            theirs executes in this document -- TikTok's documented route is a blockquote
            upgraded by `embed.js`, and `tiktok.com/embed/@handle` reaches the same view
            without it. Sandboxed, lazy, and told nothing about where it is.
          -->
          <iframe
            class="frame"
            style="height: {frameHeight(f.platform)}rem"
            title="{name(f.platform)} — {f.handle}"
            src={frame}
            loading="lazy"
            referrerpolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          ></iframe>
          <p class="listed">
            <a href={url(f.platform, f.handle)} target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Open {name(f.platform)} →</a>
          </p>
        {:else}
          <a class="face lead" href={url(f.platform, f.handle)} target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">
            <span class="p">{name(f.platform)}</span>
            <span class="h">{f.handle}</span>
            <span class="go">Opens {name(f.platform)} →</span>
          </a>
        {/if}
      {/if}

      {#if shape.beside.length > 0}
        <div class="beside">
          {#each shape.beside as b (b.platform)}
            <a class="face" href={url(b.platform, b.handle)} target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">
              <span class="p">{name(b.platform)}</span>
              <span class="h">{b.handle}</span>
            </a>
          {/each}
        </div>
      {/if}

      {#if shape.listed.length > 0}
        <p class="listed">
          {#each shape.listed as l (l.platform)}
            <a href={url(l.platform, l.handle)} target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">{name(l.platform)}</a>
          {/each}
        </p>
      {/if}
    </section>
  {/if}
{/if}

<style>
  .act { gap: .6rem; }
  .doing { margin: .2rem 0 0; }
  .does { margin: .15rem 0 0; font-size: .86rem; color: var(--t-muted); }

  /*
   * A facade: a card that looks like the thing and is not one.
   *
   * Nothing third-party loads until a tap -- no script, no frame, no image from a CDN, so no
   * platform learns that somebody opened this page. A TikTok embed measured 60 MB and 13 hosts
   * on one profile; the device floor is a prepaid Android 8 with 400 MB free.
   */
  .face {
    display: block; text-decoration: none; color: var(--t-ink);
    border: 1px solid var(--t-line); border-radius: 4px;
    padding: .7rem .8rem; min-height: 2.75rem;
  }
  .face .p { display: block; font-weight: 600; }
  .face .h { display: block; font-size: .86rem; color: var(--t-muted); overflow-wrap: anywhere; }
  .face.lead { padding: 1rem; }
  .face.lead .p { font-size: 1.15rem; }
  .face .go { display: block; margin-top: .45rem; font-size: .74rem; letter-spacing: .06em; text-transform: uppercase; color: var(--t-faint); }

  /* Full width, its own aspect. The platform decides what goes in it; we decide how big. */
  .frame { width: 100%; border: 1px solid var(--t-line); border-radius: 4px; background: var(--t-sunk); }

  /* Two up, but one on its own fills the row rather than sitting in half of it. */
  .beside { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: .5rem; }
  .listed { display: flex; flex-wrap: wrap; gap: .5rem; margin: .2rem 0 0; }
  .listed a { font-size: .86rem; min-height: 2.75rem; display: inline-flex; align-items: center; }
</style>
