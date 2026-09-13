<script lang="ts">
  /**
   * Who is responsible for what a reader finds here.
   *
   * ## Why this page exists
   *
   * NavCom shows other people's words: cards, and what operators say about themselves, their
   * skills and anything they make. There is no organisation behind the software and nobody
   * reviews any of it, so the only honest position is the one the architecture already takes --
   * a card is signed by its author and is its author's claim. This says that to a reader who
   * never opens a doc, in the register `LICENSING.md` uses for the directory.
   *
   * ## What it must never become
   *
   * A wall of legal text. It is a notice, not a contract: there is no account to agree to and
   * nothing to accept, and a page pretending otherwise would be the overclaim this project keeps
   * catching. It says what is true and stops.
   *
   * Nor a promise of takedowns. NavCom cannot delete anything from a relay, and says so. What its
   * own pages will not show is `hidden.ts`, narrow on purpose, and this states that list with its
   * limit rather than inviting reports -- there is no reporting channel to invite them to.
   */
</script>

<svelte:head>
  <title>Who is responsible for what · NavCom</title>
  <meta
    name="description"
    content="Everyone here speaks for themselves. What NavCom says, what it does not, and what nothing here is."
  />
</svelte:head>

<div class="wrap">
  <p class="eyebrow">Notice</p>
  <h1>Everyone here speaks for themselves.</h1>

  <p class="lead">
    NavCom is free, open-source software kept up by volunteers. It is not a company, a charity or
    a registered organisation, and nobody here acts on anybody else's behalf.
  </p>

  <section>
    <h2>What other people publish</h2>
    <ul class="rules">
      <li>
        <strong>Cards are published by the people they describe</strong>, signed with their own
        keys and carried by public relays NavCom does not run. So are the corrections and places
        operators add from the Field Terminal.
      </li>
      <li>
        <strong>NavCom does not review, test, verify or endorse any of it.</strong> What somebody
        says about themselves, their skills, or anything they make, sell or give away is their
        claim, and theirs to answer for.
      </li>
      <li>
        <strong>A card is named by its key as well as its callsign.</strong> Callsigns are not
        unique. The short run of characters beside a name is, and it is how two people who chose
        the same name are told apart.
      </li>
      <li>
        <strong>NavCom never handles money.</strong> A support address on a card belongs to its
        holder, and anything sent to it goes straight to them.
      </li>
      <li>
        <strong>NavCom cannot delete what somebody else published.</strong> Whether a relay keeps
        serving it is up to that relay. This site's own pages can stop showing a card that was
        named in a legal notice or is unlawful — never over a disagreement between operators —
        and each such decision is recorded, with its date, in the project's public repository.
      </li>
    </ul>
  </section>

  <section>
    <h2>What NavCom itself says</h2>
    <p>
      The app's screens, this site, its documentation, and the published directory — where every
      perishable fact shows how old it is and who checked it, and a check that is too old says
      <em>call first</em>. None of it endorses any product, and none of it promises that any
      person, place or thing will keep anybody safe.
    </p>
  </section>

  <section>
    <h2>What nothing here is</h2>
    <p>
      <strong>Nothing here is medical, legal or safety advice.</strong> Do not rely on anything you
      read here — including anything somebody says will protect you — instead of a professional or
      your own judgement.
    </p>
    <p>
      The software and the documentation are provided as they are, without warranty, under the
      licences described in <a href="/docs/licensing/">Licensing</a>.
    </p>
  </section>
</div>

<style>
  h1 {
    font-size: clamp(1.9rem, 5vw, 2.6rem);
    line-height: 1.1;
    margin-block: 0.6rem 1rem;
    max-width: 20ch;
  }

  .lead { font-size: 1.08rem; color: var(--muted); max-width: var(--measure); }

  section {
    margin-block-start: 2.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    max-width: var(--measure);
  }

  h2 { font-size: 1.3rem; }

  .rules { display: flex; flex-direction: column; gap: 0.75rem; }
  .rules li { border-inline-start: 3px solid var(--line-strong); padding-inline-start: 0.8rem; }
</style>
