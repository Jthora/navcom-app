<script lang="ts">
  import { ConfigError, loadConfig, saveConfig } from '$lib/terminal/config';
  import { ContactError, clearContact, loadContact, saveContact } from '$lib/terminal/contact';
  import { createIdentity, loadIdentity } from '$lib/terminal/identity';
  import { Slot, Readout, Why } from '$lib/components/panel';
  import { onMount } from 'svelte';

  let callsign = $state('');
  let pubkey = $state('');
  let relays = $state('wss://relay.damus.io\nwss://nos.lol');
  let holders = $state('');
  let error = $state<string | null>(null);
  let contactLabel = $state('');
  let contactNumber = $state('');
  let contact = $state<ReturnType<typeof loadContact>>(null);
  let identity = $state<ReturnType<typeof loadIdentity>>(null);
  let configured = $state(false);

  onMount(() => {
    identity = loadIdentity();
    contact = loadContact();
    if (contact) {
      contactLabel = contact.label;
      contactNumber = contact.number;
    }
    const c = loadConfig();
    configured = c !== null;
    if (c) {
      pubkey = c.pubkey;
      relays = c.relays.join('\n');
      holders = c.holders.join('\n');
    }
  });

  function makeIdentity(event: SubmitEvent) {
    event.preventDefault();
    error = null;
    const name = callsign.trim();
    if (!name) {
      error = 'A callsign is needed. It is what the board shows.';
      return;
    }
    identity = createIdentity(name);
  }

  function keepContact(event: SubmitEvent) {
    event.preventDefault();
    error = null;
    try {
      contact = saveContact(contactLabel, contactNumber);
    } catch (e) {
      error = e instanceof ContactError ? e.message : 'Could not save that.';
    }
  }

  function forgetContact() {
    clearContact();
    contact = null;
    contactLabel = '';
    contactNumber = '';
  }

  function connect(event: SubmitEvent) {
    event.preventDefault();
    error = null;
    try {
      saveConfig(pubkey, relays, holders);
      configured = true;
    } catch (e) {
      error = e instanceof ConfigError ? e.message : 'Could not save that.';
    }
  }
</script>

<svelte:head>
  <title>Set up · Field Terminal</title>
  <meta name="description" content="Identity and Watchtower, both entered here." />
</svelte:head>

<header>
  <p class="eyebrow"><a href="/terminal/">&larr; Status</a></p>
  <h1>Set up</h1>
</header>

{#if error}
  <p class="error" role="alert">{error}</p>
{/if}

<section>
  <h2>Your callsign — the only step</h2>
  {#if identity}
    <Slot k="Callsign">
      <Readout value={identity.callsign ?? '—'} tone="good" sub="{identity.pubkey.slice(0, 16)}…" />
    </Slot>
    <p class="note">
      Generated here. Never transmitted, never registered — there is no account, so there is
      nothing anyone could revoke. <strong>There is also no recovery.</strong> Lose this
      device and you lose this identity.
    </p>
    <!--
      Said at the moment it happens, and only here.

      Taking a callsign is what flips the terminal to low signature by default, so this is the
      one place where the change can be explained rather than discovered. An operator who finds
      a dim amber screen and no explanation reasonably concludes the app is broken — which is
      the same failure the Alone state exists to avoid.
    -->
    <p class="note" data-signature-explained>
      <strong>The terminal is dim and amber now.</strong> That is deliberate: it keeps your
      night vision, and it stops your phone lighting you up on a dark street.
      <strong>Document mode is one tap away</strong> — the control is on every screen, and it
      stays wherever you leave it.
    </p>
  {:else}
    <form onsubmit={makeIdentity}>
      <label for="callsign">Callsign</label>
      <p class="note">
        How you are known. Never a legal name. Once this exists the app is ready — the
        section below is optional and most operators will not have one at first.
      </p>
      <p class="note">
        <!--
          5.7, stated at the moment the trade is made rather than in a policy nobody reads.
          There is no account here and no legal name anywhere, and an operator could
          reasonably read that as anonymity. It is not, and the difference matters most to
          the people with the most reason to care.
        -->
        <strong>This is a pseudonym, not anonymity.</strong> It is a key generated on this
        phone, and <strong>everything you sign with it links together</strong> — patrols,
        answers, anything you add to the directory. That is what lets your work count as
        yours. If you need something genuinely unlinkable, it has to be a separate identity,
        and nothing here can retroactively unlink what this one has already signed.
      </p>
      <Why summary="What else is made from it">
        <p class="note">
          <!--
            Said where the key is generated, because the post-quantum key is derived from it
            and there is consequently nothing for an operator to create, copy or back up.
          -->
          <strong>A second key is derived from it</strong> and published, so messages to you
          can be sealed against a future quantum computer as well as a present one. If
          somebody you send to has not published theirs yet, <strong>the message still
          goes</strong> with ordinary encryption and <strong>Status says so</strong> — nothing
          is held back, and nothing pretends to cover more than it did.
        </p>
      </Why>
      <p class="note">
        <!--
          identity.md: "no recovery method means no recovery", stated plainly at persona
          creation rather than after a phone is dropped, when it is only a fact about the past.
        -->
        <strong>Nobody can give this back to you.</strong> There is no account, so a lost
        phone is a lost persona unless you have made
        <a href="/terminal/backup/">a backup</a> — and choosing not to is a real choice
        rather than an oversight.
      </p>
      <input id="callsign" bind:value={callsign} autocomplete="off" spellcheck="false" />
      <!--
    Inert until there is something to submit.

    A prerendered page is tappable before it hydrates, and a `<form>` tapped in that window
    does a native GET: the page reloads and what was just typed is **gone**. The peers screen
    already learned this and fixed it there; the same defect was still on all three forms
    here — including the callsign, which is the first thing every operator types.

    `disabled` rather than a plain button, because it also blocks implicit submission: with
    the default button disabled, Enter on the phone keyboard does not submit either. Query,
    Resupply and Sign-on already render this way.
  -->
  <button type="submit" disabled={!callsign.trim()}>Generate keypair</button>
    </form>
  {/if}
</section>

<!--
  Placed directly after the callsign and before the watch, because for an operator with no
  watch this IS the safety net rather than a nice extra.
-->
<section>
  <h2>Someone you would call</h2>
  <p class="note">
    One tap on the Distress screen opens a message to them, already written. <strong>Nothing
    is sent automatically and you have to press send</strong> — a web app cannot do it for
    you, and this app will not pretend it can.
  </p>
  <p class="note">
    Their number stays on this phone. It is never sent to a watch, a relay, or anyone else's
    machine — there is no list of operators' contacts anywhere for anyone to take.
    <strong>A burn erases it; a panic wipe does not</strong>, so it is still there the next
    night.
  </p>
  <form onsubmit={keepContact}>
    <label for="clabel">Who</label>
    <input id="clabel" bind:value={contactLabel} autocomplete="off" placeholder="Sam" />
    <label for="cnumber">Number</label>
    <input id="cnumber" bind:value={contactNumber} type="tel" autocomplete="off" placeholder="+1 555 0100" />
    <button type="submit" disabled={!contactLabel.trim() || !contactNumber.trim()}>{contact ? 'Update' : 'Save'}</button>
  </form>
  {#if contact}
    <Slot k="Your person">
      <Readout value={contact.label} tone="good" sub={contact.number ?? null} />
    </Slot>
    <button class="forget" type="button" onclick={forgetContact}>Remove</button>
  {/if}
</section>

<section class="later">
  <h2>A watch — optional, and only if somebody gave you one</h2>
  <p class="note">
    <strong>Skip this.</strong> You do not need a watch to use NavCom, and having none is
    how most operators work. Come back when somebody hands you one.
  </p>
  <p class="note">
    What it adds: Query, Assist and Distress — the three things that need a person on the
    other end. What it does not change: everything else, which already works.
  </p>
  <p class="note">
    Handed to you in person, on paper or by whatever you already use. <strong>Nothing
    discovers a Watchtower on its own</strong> — a list of them would be a list of where
    operators are.
  </p>
  <form onsubmit={connect}>
    <label for="pubkey">Pubkey</label>
    <input id="pubkey" bind:value={pubkey} autocomplete="off" spellcheck="false" placeholder="64 hex characters" />
    <label for="relays">Relays</label>
    <textarea id="relays" bind:value={relays} rows="3" autocomplete="off" spellcheck="false"></textarea>

    <label for="holders">Who holds it</label>
    <textarea id="holders" bind:value={holders} rows="3" autocomplete="off" spellcheck="false"
      placeholder="leave empty unless you were given a list"></textarea>
    <p class="note">
      <!--
        Stated before the field, because the answer for most operators is "leave it empty"
        and a blank box with no explanation reads as something missing.
      -->
      <strong>Usually empty.</strong> A watch running on a box holds its own key, and that is
      what most people are given. A squad with no box holds the watch on their phones instead,
      and lists one key per phone here — <strong>whoever is on this list can read everything
      you send</strong>, on watch or off. It comes from the same person who gave you the
      pubkey; nothing discovers it.
    </p>
    <button type="submit" disabled={!pubkey.trim()}>{configured ? 'Update' : 'Connect'}</button>
  </form>
  {#if configured}
    <Slot k="Watch config">
      <Readout value="Saved" tone="good" />
    </Slot>
    <p class="done"><a href="/terminal/">Back to status</a></p>
  {/if}
</section>

<style>
  header { display: flex; flex-direction: column; gap: .2rem; }
  .eyebrow {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .72rem; letter-spacing: .16em; text-transform: uppercase; margin: 0;
  }
  .eyebrow a { color: var(--t-faint); text-decoration: none; }
  h1 { font-size: 1.7rem; margin: 0; }
  h2 {
    font-size: .78rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
    color: var(--t-faint); margin: 0 0 .5rem;
  }
  section { display: flex; flex-direction: column; }
  form { display: flex; flex-direction: column; gap: .5rem; }
  label { font-size: .9rem; color: var(--t-muted); }
  input, textarea {
    background: var(--t-sunk); border: 2px solid var(--t-line-strong); color: var(--t-ink);
    font: inherit; font-size: 1rem; padding: .8rem; border-radius: 2px; min-height: 3.2rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  textarea { min-height: 5rem; }
  button { margin-top: .4rem; }
  /* Visibly secondary, so nobody reads it as a step they are failing to complete. */
  .later { border-top: 1px solid var(--t-line); padding-top: 1.2rem; opacity: .82; }
  .forget {
    min-height: 2.2rem; font-size: .8rem; padding: 0 .7rem;
    border-color: var(--t-line); color: var(--t-faint);
  }
  .note { font-size: .9rem; color: var(--t-faint); margin: 0 0 .3rem; line-height: 1.5; }
  .note strong { color: var(--t-ink); }
  .done { color: var(--t-muted); display: flex; gap: .6rem; align-items: baseline; flex-wrap: wrap; }
  .error {
    color: var(--t-dark); border: 2px solid var(--t-dark); padding: .7rem .9rem; margin: 0;
  }
</style>
