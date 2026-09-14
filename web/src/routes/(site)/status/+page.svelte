<script lang="ts">
  /**
   * The public status page required by docs/spec/escalation.spec.md, which says drill
   * results are published.
   *
   * ## It says only what a static page can know
   *
   * This page ships no JavaScript and reads nothing at runtime. It cannot see a Watchtower, a
   * roster or a drill — nothing discovers a Watchtower, by design, because a list of them is a
   * list of where operators are. An earlier version said drill results and watch state "appear
   * here" and that it "rebuilds daily"; none of the three had anything behind it. Every sentence
   * now describes this project's own position or the build it came from, and says plainly what
   * it cannot see.
   */
  // Derived at build time, not written by hand. See +page.server.ts for why.
  import { formatDate } from '$lib/directory';

  let { data } = $props();
  const components = $derived(
    data.components.map((c) => ({ ...c, state: c.built ? 'built' : 'not built' }))
  );
  /** The same absolute-date formatter the directory uses, for the same reason. */
  const buildDate = $derived(formatDate(data.version.builtAt.slice(0, 10)));
</script>

<svelte:head>
  <title>Status · NavCom</title>
  <meta
    name="description"
    content="What works, what has been proven, and what has not — and what this page cannot see."
  />
</svelte:head>

<div class="wrap">
  <p class="eyebrow">Status</p>
  <h1>What works, and what has been proven</h1>

  <div class="notice notice--stop">
    <p class="notice__label">Escalation</p>
    <p>
      <strong>Built, unproven, and running with nobody on-call.</strong> The ladder exists
      and its seven failure paths are tested — but no drill has ever run, and no watch this
      project runs has a roster. A Distress sent to a watch with nobody on-call pages nobody,
      reaches the end of the ladder at once, and tells the operator so.
    </p>
    <p>
      That is the ladder working correctly. <strong>It is not the ladder helping.</strong>
      Nothing here should be relied on in an emergency.
    </p>
  </div>

  <section>
    <h2>Drills</h2>
    <p class="hint">
      A watch tests its own escalation path on an unannounced schedule and publishes the result
      itself — how many were paged, how many acknowledged, and how long the first acknowledgement
      took. <strong>This page does not read those results.</strong>
    </p>
    <p class="empty">No drill results are shown here.</p>
    <p class="hint">
      A passing drill is reported as <em>no evidence of failure</em>, never as
      <em>verified</em>. It means the path worked that time.
    </p>
  </section>

  <section>
    <h2>Components</h2>
    <ul class="components">
      {#each components as c (c.name)}
        <li>
          <span class="dot {c.state.replace(' ', '-')}" aria-hidden="true"></span>
          <span class="name">{c.name}</span>
          <span class="state">{c.state}</span>
          <span class="note">{c.note}</span>
        </li>
      {/each}
    </ul>
    <p class="hint">
      Derived from the repository at build time rather than written by hand. <strong>"Built"
      means the code is here</strong> — it is a much weaker claim than it looks, and the
      list below is what it does not cover.
    </p>
    <!--
      Absolute, not "3 days ago": this page ships no JavaScript, so a relative age would be
      frozen at build time and start lying the moment somebody read it. A date stays true.

      It said "It rebuilds daily" after the scheduled rebuild had been deleted with CI, which
      made an old date read as a fault when it was the ordinary state. The daily rebuild is back
      as a timer on the watch box (`packages/watchtower/ops/systemd`), and a timer runs only while
      a box does — so this states what an old date means rather than promising a fresh one.
    -->
    <p class="stamp" data-version={data.version.commit}>
      This page was built from
      <code>{data.version.commit}</code>{#if data.version.dirty}&nbsp;(with uncommitted changes){/if}
      on <time datetime={data.version.builtAt}>{buildDate}</time>. It rebuilds whenever it is
      deployed, and once a day while a rebuild timer is running — a date more than a day old
      means none is, and everything on this page is that old.
      <a href="/version.json">version.json</a> says the same thing to a machine.
    </p>
  </section>

  <section>
    <h2>What is not proven</h2>
    <p class="hint">
      The things that are true and that no build can check. These matter more than the list
      above.
    </p>
    <ul class="unproven">
      {#each data.unproven as line (line)}
        <li>{line}</li>
      {/each}
    </ul>
  </section>

  <section>
    <h2>Watch state</h2>
    <p class="hint">
      <strong>This page cannot see any Watchtower, by design.</strong> Nothing discovers one,
      because a list of Watchtowers is a list of where operators are. A watch publishes its own
      state to the people who hold its key, and an operator sees it on the Field Terminal before
      signing on.
    </p>
    <p class="empty">No watch state is shown here.</p>
  </section>
</div>

<style>
  h1 { font-size: clamp(1.7rem, 5vw, 2.3rem); line-height: 1.15; margin: 0.5rem 0 1.25rem; }
  .notice { margin-bottom: 1rem; }
  section { margin-top: 2.5rem; }
  h2 {
    font-size: 0.95rem; font-family: var(--font-body); font-weight: 700;
    letter-spacing: 0.09em; text-transform: uppercase; color: var(--muted);
    padding-bottom: 0.5rem; border-bottom: 1px solid var(--line-strong); margin-bottom: 0.8rem;
  }
  .hint { font-size: 0.92rem; color: var(--muted); max-width: var(--measure); margin: 0.6rem 0; }
  .empty {
    font-family: var(--font-mono); font-size: 0.85rem; color: var(--faint);
    padding: 0.8rem 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
  }

  .components { display: flex; flex-direction: column; }
  .components li {
    display: grid;
    grid-template-columns: 0.7rem 12rem 6rem 1fr;
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.7rem 0;
    border-bottom: 1px solid var(--line);
    font-size: 0.94rem;
  }
  .dot { width: 0.6rem; height: 0.6rem; border-radius: 50%; display: inline-block; }
  .dot.live { background: var(--ok); }
  .dot.building { background: var(--accent); }
  .dot.not-built { background: transparent; border: 1px solid var(--faint); }
  .name { font-weight: 600; }
  .state { font-family: var(--font-mono); font-size: 0.76rem; color: var(--muted); }
  .note { color: var(--muted); font-size: 0.88rem; }

  @media (max-width: 40rem) {
    .components li { grid-template-columns: 0.7rem 1fr; gap: 0.4rem 0.75rem; }
    .state, .note { grid-column: 2; }
  }
</style>
