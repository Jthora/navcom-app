<svelte:head>
  <title>NavCom</title>
  <meta
    name="description"
    content="A public directory of who will actually take someone tonight — hours, intake rules, and how recently anyone checked."
  />
</svelte:head>

<div class="wrap">
  <p class="eyebrow">The Watchtower</p>
  <h1>Who will actually take someone tonight.</h1>

  <p class="lead">
    Official listings rot. Hours are wrong, and the rules that decide whether a person gets
    a bed — pets, ID, sobriety, curfew, couples — are usually missing entirely. This
    directory carries those rules, and it always shows how recently anyone checked.
  </p>

  <div class="actions">
    <a class="cta cta--primary" href="/directory/">Open the directory</a>
    <!--
      "I was expecting a command interface, not a website" was the substance of the
      complaint this page exists to answer. The Terminal is the actual application — CLAUDE.md
      calls it "fully capable, no install" — and it had no path in from the front door beyond a
      nav link nobody reads on a first visit. It belongs beside the directory CTA, not below it.
    -->
    <a class="cta cta--ghost" href="/terminal/">Open the Field Terminal<span aria-hidden="true"> &rarr;</span></a>
  </div>

  <section class="doctrine">
    <h2>How to read it</h2>
    <ol class="rules">
      <li><strong>Every perishable fact shows its age.</strong> "Open until 10pm, verified 3 days ago" — never just "open until 10pm".</li>
      <li><strong>When a check is too old, it says <em>call first</em></strong> rather than showing you a stale answer. That is an honest response, not a missing one.</li>
      <li><strong>Blank means unknown</strong> — never "no restriction". If we do not know whether they take dogs, we say so.</li>
      <li><strong>Unverified public listings look different</strong> from entries a person actually checked, because low-confidence data that looks authoritative is worse than none.</li>
    </ol>
  </section>

  <section class="network">
    <h2>What this is part of</h2>
    <p>
      NavCom is non-institutional dispatch for volunteer patrol networks — someone holds a
      watch while operators are out, and answers questions from the street so nobody has to
      search a database one-handed in the cold.
    </p>
    <p>
      This directory is the part that is useful to anyone facing the same night, so it is
      public and needs no app. Outreach workers, street medics and mutual aid crews are
      welcome to it on their own terms.
    </p>
  </section>
</div>

<style>
  h1 {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif;
    font-weight: 800;
    font-size: clamp(2.1rem, 6vw, 3.1rem);
    line-height: 1.05;
    letter-spacing: -0.03em;
    margin: 0.6rem 0 1rem;
    max-width: 18ch;
    text-wrap: balance;
  }

  .lead { font-size: 1.1rem; color: var(--muted); max-width: var(--measure); }

  .actions {
    margin: 1.85rem 0 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.85rem;
  }

  .cta {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-family: var(--font-mono);
    font-size: 0.85rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    text-decoration: none;
    padding: 0.8rem 1.35rem;
    border: 2px solid var(--ink);
  }
  .cta--primary { background: var(--ink); color: var(--ground); }
  .cta--primary:hover { background: transparent; color: var(--ink); }

  .cta--ghost { background: transparent; color: var(--ink); border-color: var(--line-strong); }
  .cta--ghost:hover { border-color: var(--accent); color: var(--accent); }

  section { margin-top: 3rem; display: flex; flex-direction: column; gap: 0.9rem; }
  h2 {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    padding-bottom: 0.6rem;
    border-bottom: 1px solid var(--line-strong);
  }
  section p { max-width: var(--measure); color: var(--muted); }

  /*
   * Numbered by CSS counter rather than manual "1. 2. 3." — these four rules are a fixed
   * doctrine, not a bulleted afterthought, and the reader should be able to point at "rule 2"
   * the way the rest of this project's docs do.
   */
  .rules {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    max-width: var(--measure);
    list-style: none;
    counter-reset: rule;
    padding: 0;
  }
  .rules li {
    counter-increment: rule;
    position: relative;
    padding-inline-start: 2.1rem;
    color: var(--muted);
  }
  .rules li::before {
    content: counter(rule);
    position: absolute;
    inset-inline-start: 0;
    top: 0.1rem;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--accent);
    border: 1px solid var(--line-strong);
    width: 1.4rem;
    height: 1.4rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .rules strong { color: var(--ink); }

  .network {
    border: 1px solid var(--line-strong);
    border-inline-start: 3px solid var(--accent);
    padding: 1.1rem 1.3rem;
    background: var(--surface);
  }
  .network h2 { border-bottom: none; padding-bottom: 0; }
</style>
