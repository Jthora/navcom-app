<script lang="ts">
  import '$lib/styles/tokens.css';
  let { children } = $props();
</script>

<a class="skip" href="#main">Skip to content</a>

<header>
  <div class="bar">
    <a class="brand" href="/">
      <span class="brand-mark">NAVCOM</span>
      <span class="brand-tag">The Watchtower</span>
    </a>
    <nav>
      <a href="/directory/">Directory</a>
      <!--
        The full operator app. The root console at `/` already fuses a live search over this
        same directory with a link here for anyone who wants to sign on — this bar just names
        where things are for anyone already reading a site page.
      -->
      <a href="/terminal/">Terminal</a>
      <a href="/status/">Status</a>
      <a href="/about/">About</a>
      <a href="/docs/contributing/">Contribute</a><a href="/docs/">Docs</a>
    </nav>
  </div>
</header>

<main id="main">
  {@render children()}
</main>

<footer>
  <div class="wrap">
    <p>The resource directory is public and free to use. No account, nothing to install.</p>
    <p class="quiet">
      Nothing here records anything about the people being served. This directory describes
      services, never recipients.
    </p>
    <p class="quiet">
      Maintained by volunteers. Every perishable fact shows its age, and &ldquo;call
      first&rdquo; is a real answer rather than a missing one &mdash; please call ahead
      before sending anyone anywhere. Data is
      <a href="https://creativecommons.org/publicdomain/zero/1.0/" rel="noreferrer">CC0</a>:
      free for anyone to use.
    </p>
  </div>
</footer>

<style>
  /*
   * What does not belong on paper.
   *
   * Navigation is dead ink — a printed link cannot be followed — and the footer is chrome
   * for a screen. What survives is the record: the address, the phone number, the intake
   * rules, and how old they are.
   */
  @media print {
    header,
    footer,
    .skip {
      display: none !important;
    }
    :global(body) {
      background: #fff;
      color: #000;
    }
    main {
      padding: 0 !important;
      max-width: none !important;
    }
    /*
     * A record split across a page break is a record somebody misreads.
     *
     * `:global` because these live in the child routes, not in this layout — Svelte scopes
     * component styles, so an unqualified `section` here matches nothing and silently does
     * nothing. The compiler said so, which is the only reason this is right.
     */
    :global(section),
    :global(.notice),
    :global(li) {
      break-inside: avoid;
    }
    :global(a) {
      color: #000;
      text-decoration: underline;
    }
  }

  .skip {
    position: absolute;
    /* Off-screen on the side the script starts from, so it is off-screen in Arabic too. */
    inset-inline-start: -9999px;
  }
  .skip:focus {
    inset-inline-start: 0.5rem;
    inset-block-start: 0.5rem;
    z-index: 10;
    background: var(--surface);
    padding: 0.5rem 0.8rem;
    border: 2px solid var(--accent);
  }

  /*
   * The header carries the site's whole visual identity in one bar, so it is worth more
   * than a wordmark and some links. A 3px accent rule along the top is the one place this
   * static, zero-JS site borrows the terminal's own language without borrowing its budget --
   * it costs nothing and it is the first thing anyone sees, on every page.
   */
  header {
    border-bottom: 1px solid var(--line-strong);
    border-top: 3px solid var(--accent);
    background: var(--surface);
  }

  .bar {
    max-width: 48rem;
    margin: 0 auto;
    padding: 0.85rem 1.1rem;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .brand {
    display: flex;
    align-items: baseline;
    gap: 0.65rem;
    text-decoration: none;
  }
  .brand-mark {
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 1.02rem;
    letter-spacing: 0.14em;
    color: var(--ink);
  }
  .brand-tag {
    font-family: var(--font-mono);
    font-size: 0.66rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--faint);
  }

  nav {
    display: flex;
    gap: 1.2rem;
    font-family: var(--font-mono);
    font-size: 0.76rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  nav a { color: var(--muted); text-decoration: none; }
  nav a:hover { color: var(--accent); text-decoration: underline; }

  main { padding-top: 2.5rem; }

  footer {
    border-top: 1px solid var(--line);
    margin-top: 4rem;
    padding: 1.5rem 0 3rem;
    font-size: 0.88rem;
    color: var(--muted);
  }
  footer .wrap { display: flex; flex-direction: column; gap: 0.5rem; padding-bottom: 0; }
  .quiet { color: var(--faint); }
</style>
