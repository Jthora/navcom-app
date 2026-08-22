<script lang="ts">
  import '$lib/styles/tokens.css';
  let { children } = $props();
</script>

<a class="skip" href="#main">Skip to content</a>

<header>
  <div class="bar">
    <a class="brand" href="/">NavCom</a>
    <nav>
      <a href="/directory/">Directory</a>
      <!--
        The application itself, which was reachable only by typing the path.

        CLAUDE.md's position on this surface is "try instantly, no install, fully capable" —
        and nothing on the public site linked to it, so the front door offered a directory and
        a pile of documentation about a product that appeared not to exist. It is the same
        rule as everywhere else here: a mechanism nobody can reach is not built.
      -->
      <a href="/terminal/">Terminal</a>
      <a href="/status/">Status</a>
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

  header { border-bottom: 1px solid var(--line-strong); background: var(--surface); }

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
    font-family: var(--font-display);
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--ink);
    text-decoration: none;
    letter-spacing: -0.01em;
  }

  nav { display: flex; gap: 1.1rem; font-size: 0.92rem; }
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
