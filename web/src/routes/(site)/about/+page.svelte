<script lang="ts">
  import { LIVE, GONE, LIVENESS_WORDING } from '$lib/community';
</script>

<svelte:head>
  <title>About · NavCom</title>
  <meta
    name="description"
    content="What NavCom is, how to read the directory, and what network it is part of."
  />
</svelte:head>

<div class="wrap">
  <!-- Not "The Watchtower" — that names a specific node's keypair elsewhere in this project
       (docs/spec/bootstrap.spec.md), not NavCom itself. -->
  <p class="eyebrow">About</p>
  <h1>Who will actually take someone tonight.</h1>

  <p class="lead">
    Official listings rot. Hours are wrong, and the rules that decide whether a person gets
    a bed — pets, ID, sobriety, curfew, couples — are usually missing entirely. This
    directory carries those rules, and it always shows how recently anyone checked.
  </p>

  <div class="actions">
    <a class="cta cta--primary" href="/directory/">Open the directory</a>
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
      NavCom is a watch for volunteer patrol networks — someone holds a board while
      operators are out, and answers questions from the street so nobody has to search a
      database one-handed in the cold. Nothing here assigns anyone anywhere; the watch tells
      you what is happening and never dispatches.
    </p>
    <p>
      This directory is the part that is useful to anyone facing the same night, so it is
      public and needs no app. Outreach workers, street medics and mutual aid crews are
      welcome to it on their own terms.
    </p>
  </section>

  <section class="elsewhere">
    <h2>Where else RLSH people are</h2>
    <p>
      NavCom is not the community's front door and does not want to be. These are, and this
      list exists to send you to them — not to keep you here.
    </p>
    <ul class="sites">
      {#each LIVE as site (site.url)}
        <li>
          <a href={site.url} rel="noopener external">{site.name}</a>
          <span class="how" data-how={site.how}>{LIVENESS_WORDING[site.how]} · {site.checked}</span>
          <span class="what">{site.what}</span>
        </li>
      {/each}
    </ul>

    <h3>Gone, but not lost</h3>
    <p>
      These have shut down or been taken over by someone else. <strong
        >The old addresses are printed here, deliberately, without links</strong
      > — one of them now redirects to a squatter, and a domain somebody else controls is not
      a safe place to send anyone. The record itself survives at the Internet Archive.
    </p>
    <ul class="sites">
      {#each GONE as site (site.was)}
        <li>
          <span class="dead">{site.name} — was {site.was}</span>
          <span class="what">{site.what}</span>
          <a href={site.archive} rel="noopener external">Read the archived copy</a>
        </li>
      {/each}
    </ul>
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

  .elsewhere h3 {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
    margin: 1.4rem 0 0;
  }

  .sites {
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    max-width: var(--measure);
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .sites li { display: flex; flex-direction: column; gap: 0.2rem; }
  .sites a { font-weight: 700; align-self: flex-start; }
  .sites .what { color: var(--muted); }

  /* The provenance line, in the directory's own voice: how we know, and when. */
  .sites .how {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }
  /* Weaker evidence must not read the same as a direct check. */
  .sites .how[data-how='cited'] { opacity: 0.75; }

  /* A dead address is shown so it is recognisable, and styled so it is not mistaken for a
     destination. Never a link — see community.ts. */
  .sites .dead {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    color: var(--muted);
    text-decoration: line-through;
    text-decoration-thickness: 1px;
  }
</style>
