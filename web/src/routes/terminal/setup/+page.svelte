<script lang="ts">
  import { DEFAULT_RELAYS, keyPrint } from '@navcom/core';
  import { ConfigError, forgetOfferedWatch, saveConfig, watchForm } from '$lib/terminal/config';
  import { WatchCodeError, codeChanges, looksLikeWatchCode, parseWatchCode } from '$lib/terminal/watch-code';
  import { canScan, scan, ScanError, type Scanner } from '$lib/terminal/scan';
  import type { Refused } from '$lib/terminal/relay-url';
  import { ContactError, clearContact, loadContact, saveContact } from '$lib/terminal/contact';
  import { createIdentity, loadIdentity, setCallsign } from '$lib/terminal/identity';
  import { askToKeep } from '$lib/terminal/persist';
  import { backTo, pendingMission, type PendingMission } from '$lib/missions/pending';
  import { Slot, Readout, Why } from '$lib/components/panel';
  import { onMount } from 'svelte';

  let callsign = $state('');
  let pubkey = $state('');
  // The shipped starting point, read from the one place it is defined, never a copy that can drift.
  let relays = $state(DEFAULT_RELAYS.join('\n'));
  let holders = $state('');
  let error = $state<string | null>(null);
  /**
   * Why the watch was not saved, shown beside the button that was pressed. It shared the error at
   * the top of the page, two sections up and off a phone's screen, while the readout under the
   * button still said Saved [audit: relay paths, review].
   */
  let watchError = $state<string | null>(null);
  let contactLabel = $state('');
  let contactNumber = $state('');
  let contact = $state<ReturnType<typeof loadContact>>(null);
  let identity = $state<ReturnType<typeof loadIdentity>>(null);
  /** The mission somebody came here from to take part, so this screen can take them back [finding 47]. */
  let leftMission = $state<PendingMission | null>(null);
  let configured = $state(false);
  /** Lines of the watch as saved that this page will not dial, each with why. */
  let refused = $state<Refused[]>([]);
  /** How many of its saved relays this page can reach. */
  let reachable = $state(0);
  /** The last Update was refused, so what is saved is still the watch as it was before. */
  let notUpdated = $state(false);
  /** The form holds a watch a backup named, which is not added until it is saved here. */
  let fromBackup = $state(false);
  /** The callsign field in the identity branch — a rename, not a second identity. */
  let renamed = $state('');
  /**
   * The escalation executor's key this phone keeps for its watch, as saved [G3]. Never a field: it
   * arrives only in a watch code the watch signed, scanned or pasted, because a typed one is wrong
   * often enough to leave a watch on the old rule without a word (`watch-code.ts`).
   */
  let savedExecutor = $state<string | null>(null);
  /** When the watch signed the code that key came in. */
  let savedExecutorAt = $state<number | null>(null);
  /** The address of the watch saved here, so a code for it can be told from a code for another. */
  let savedPubkey = $state<string | null>(null);
  /** The relays and holders saved here, so what a code would change can be said before it is saved. */
  let savedRelays = $state<string[]>([]);
  let savedHolders = $state<string[]>([]);
  /**
   * What a watch code, or a backup, named for the watch it named: its escalation key or none, when
   * the watch signed it, and the signed code itself, which is what a save keeps. A backup that named
   * no key leaves nothing pending.
   */
  let pending = $state<{ pubkey: string; executor: string | null; executorAt: number | null; text: string } | null>(null);
  /** The operator has said this code came from whoever runs the watch, where it changes the escalation key. */
  let keyConfirmed = $state(false);
  let codeText = $state('');
  let codeError = $state<string | null>(null);
  let scannable = $state(false);
  let scanning = $state(false);
  let camera = $state<HTMLVideoElement | null>(null);
  let scanner: Scanner | null = null;

  /** The watch the form holds now, as saving would read it. */
  const formKey = $derived(pubkey.trim().toLowerCase());
  /** The escalation key a save of this form keeps: one handed over for this watch, else the saved one. */
  const pendingFor = $derived(pending && pending.pubkey === formKey ? pending : null);
  /** The form is the watch saved here, edited. */
  const sameWatch = $derived(configured && savedPubkey === formKey);
  const shownExecutor = $derived(pendingFor ? pendingFor.executor : sameWatch ? savedExecutor : null);
  const lines = (raw: string) => raw.split(/[\s,]+/).map((l) => l.trim()).filter(Boolean);
  /**
   * What saving this form, filled from a code, would change about the watch saved here: every line,
   * and how the escalation key would change — added counting as much as replaced (`codeChanges`).
   */
  const changed = $derived(
    pendingFor && sameWatch && savedPubkey
      ? codeChanges(
          { pubkey: savedPubkey, relays: savedRelays, holders: savedHolders, executor: savedExecutor, executorAt: savedExecutorAt },
          { pubkey: formKey, relays: lines(relays), holders: lines(holders) },
          pendingFor
        )
      : { key: null, older: false, lines: [] as string[] }
  );
  const keyChange = $derived(changed.key);
  const olderCode = $derived(changed.older);
  const changes = $derived(changed.lines);
  /** The day the watch signed a code, as a date nobody can misread. */
  const signedOn = (at: number | null) => (at === null ? null : new Date(at * 1000).toISOString().slice(0, 10));
  /**
   * A squad's members sign their own answers, so a squad needs no escalation key: only a box with
   * neither is the watch on which anything holding the watch key can end a Distress.
   */
  const listsHolders = $derived(holders.split(/[\s,]+/).some((h) => h.trim() !== ''));

  onMount(() => {
    identity = loadIdentity();
    leftMission = pendingMission();
    renamed = identity?.callsign ?? '';
    contact = loadContact();
    if (contact) {
      contactLabel = contact.label;
      contactNumber = contact.number;
    }
    /*
     * The watch as it was saved, with its key and its holders, even when this page reaches none of
     * its relays.
     *
     * Prefilled from the filtered config, a watch whose every relay is refused here opened as a
     * blank form: no key, no holders, a Connect button. The operator needed the key and the
     * holders back from a person, and a squad member who re-entered only the key saved a watch
     * with no holders, which seals every Distress to nobody's phone [audit: relay paths, review].
     * A watch a backup named fills it the same way when nothing is saved yet, and is added only
     * by saving it here. Which lines go in the field, and which are named beside it, is
     * `watchForm`'s rule.
     */
    const w = watchForm();
    configured = w?.from === 'saved';
    fromBackup = w?.from === 'backup';
    if (w) {
      pubkey = w.pubkey;
      relays = w.relays.join('\n');
      holders = w.holders.join('\n');
      refused = w.refused;
      reachable = w.reachable;
      if (w.from === 'saved') {
        savedExecutor = w.executor ?? null;
        savedExecutorAt = w.executorAt ?? null;
        savedPubkey = w.pubkey.toLowerCase();
        savedRelays = [...w.relays];
        savedHolders = w.holders.map((h) => h.toLowerCase());
      }
      // A backup's escalation key is kept when its watch is saved here, as a code's is: in the signed
      // code it came in, which the save checks again.
      else if (w.executor && w.escalation) {
        pending = { pubkey: w.pubkey.toLowerCase(), executor: w.executor, executorAt: w.executorAt ?? null, text: w.escalation };
      }
    }
    scannable = canScan();
    // A watch code's link opens straight into the form, filled in: the camera on a phone with no
    // scanner here opens it, as a pairing link opens the peers screen. Nothing is saved until the
    // operator saves it.
    const fromLink = location.hash.replace(/^#/, '');
    if (looksLikeWatchCode(fromLink)) {
      codeText = fromLink;
      useCode();
    }
  });

  /**
   * Fills the watch form from a code: all of it, or nothing, with what is wrong said beside it. A
   * code the watch did not sign, or naming an escalation key that is not a key, fills in nothing.
   */
  function useCode() {
    codeError = null;
    watchError = null;
    try {
      const code = parseWatchCode(codeText);
      pubkey = code.pubkey;
      relays = code.relays.join('\n');
      holders = code.holders.join('\n');
      // The saved watch's refused lines no longer describe what is in the field.
      refused = [];
      pending = { pubkey: code.pubkey, executor: code.executor ?? null, executorAt: code.issuedAt, text: code.text };
      keyConfirmed = false;
      codeText = '';
    } catch (e) {
      codeError = e instanceof WatchCodeError ? e.message : 'That watch code could not be read.';
    }
  }

  async function startScan() {
    if (!camera) return;
    codeError = null;
    scanning = true;
    try {
      scanner = await scan(camera);
      codeText = await scanner.found;
      useCode();
    } catch (err) {
      codeError = err instanceof ScanError ? err.message : 'Could not scan.';
    } finally {
      scanning = false;
      scanner = null;
    }
  }

  function stopScan() {
    scanner?.stop();
    scanner = null;
    scanning = false;
  }

  function makeIdentity(event: SubmitEvent) {
    event.preventDefault();
    error = null;
    const name = callsign.trim();
    if (!name) {
      error = 'A callsign is needed. It is what the board shows.';
      return;
    }
    identity = createIdentity(name);
    /*
     * The one moment this is asked. Deliberate, unhurried, and chosen by the operator — the
     * only kind of moment a browser permission prompt is acceptable in a field tool. Fired
     * without awaiting, because nothing here waits on a browser policy.
     */
    void askToKeep();
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

  /**
   * Changing the name the board shows.
   *
   * `setCallsign` shipped exported, and called by nothing. The form that takes a callsign sits
   * in the `{:else}` half of this screen, so once an identity existed there was no field at all
   * — and the only way to change a callsign was to burn the device, which destroys the standing
   * the callsign was carrying in order to change what it is called.
   */
  function rename(event: SubmitEvent) {
    event.preventDefault();
    error = null;
    const name = renamed.trim();
    if (!name) {
      error = 'A callsign is needed. It is what the board shows.';
      return;
    }
    setCallsign(name);
    identity = loadIdentity();
    renamed = identity?.callsign ?? name;
  }

  function connect(event: SubmitEvent) {
    event.preventDefault();
    error = null;
    watchError = null;
    // Asked before it is saved, never after: the escalation key decides who can end this phone's Distress.
    if (keyChange && !keyConfirmed) {
      watchError = 'This code changes the escalation key. Say where it came from below before saving it.';
      return;
    }
    try {
      // The signed code goes with the watch it named, and decides its escalation key; an edit with no
      // code keeps the one saved for the same watch (`saveConfig`): never typed, so never dropped by an edit.
      const saved = saveConfig(pubkey, relays, holders, pendingFor?.text ?? undefined);
      configured = true;
      notUpdated = false;
      refused = [];
      reachable = saved.relays.length;
      savedExecutor = saved.executor ?? null;
      savedExecutorAt = saved.executor ? (pendingFor?.executorAt ?? savedExecutorAt) : null;
      savedPubkey = saved.pubkey;
      savedRelays = [...saved.relays];
      savedHolders = [...saved.holders];
      pending = null;
      keyConfirmed = false;
      // Saved by the operator's own hand, so the backup's offer has been answered.
      if (fromBackup) forgetOfferedWatch();
      fromBackup = false;
    } catch (e) {
      // Nothing was written: `saveConfig` checks every part before it stores any of them.
      watchError = e instanceof ConfigError ? e.message : 'Could not save that.';
      notUpdated = configured;
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
      <Readout value={identity.callsign ?? '—'} verbatim tone="good" sub="{identity.pubkey.slice(0, 16)}…" />
    </Slot>
    {#if leftMission}
      <!-- The callsign was the only thing the mission asked for, so the way back is the next thing here. -->
      <a class="nc-act" data-act data-back-to-mission href="/" data-sveltekit-reload>
        <span class="nc-act-label">{backTo(leftMission)}</span>
      </a>
    {/if}
    <p class="note">
      <strong>There is no recovery.</strong> Lose this device and you lose this identity.
    </p>
    <form onsubmit={rename}>
      <label for="rename">Change your callsign</label>
      <input id="rename" bind:value={renamed} autocomplete="off" spellcheck="false" />
      <button type="submit" data-rename>Change it</button>
    </form>
    <p class="note">Your key does not change, so your standing comes with you.</p>
    <Why summary="What a new callsign does not change">
      <p class="note">
        Nobody has to re-add you, and nothing you hold is reissued. What you have already
        signed keeps the old name — a correction, an observation, an endorsement somebody gave
        you — and <a href="/terminal/card/">a published card</a> shows the old one until you
        publish it again.
      </p>
    </Why>
    <!--
      Said at the moment it happens, and only here.

      Taking a callsign is what flips the terminal to low signature by default, so this is the
      one place where the change can be explained rather than discovered. An operator who finds
      a dim amber screen and no explanation reasonably concludes the app is broken — which is
      the same failure the Alone state exists to avoid.
    -->
    <p class="note" data-signature-explained>
      <strong>The terminal is dim and amber now</strong> — it keeps your night vision.
      <strong>Document mode is one tap away.</strong>
    </p>
    <Why summary="Why it looks like this">
      <p class="note">
        Generated here. Never transmitted, never registered — there is no account, so there is
        nothing anyone could revoke.
      </p>
      <p class="note">
        The dim amber also stops your phone lighting you up on a dark street. The document
        mode control is on every screen, and it stays wherever you leave it.
      </p>
    </Why>
  {:else}
    <form onsubmit={makeIdentity}>
      <label for="callsign">Callsign</label>
      <!--
        Three claims, then one disclosure. This was 130 words standing between somebody
        opening the app for the first time and the only field they have to fill in — the
        largest single block of prose in front of a control anywhere in the terminal.

        All three sentences left here are load-bearing and none of them is behind a tap.
        `Nobody can give this back to you` is additionally asserted **visible** by a browser
        test rather than merely present, because a person who reads it after dropping the
        phone is only being told a fact about the past.
      -->
      <p class="note">
        How you are known. <strong>Never a legal name.</strong> Once this exists the app is
        ready — the section below is optional.
      </p>
      <p class="note"><strong>This is a pseudonym, not anonymity.</strong></p>
      <p class="note">
        <strong>Nobody can give this back to you.</strong>
        <a href="/terminal/backup/">Make a backup</a>, or decide not to.
      </p>
      <Why summary="What this key is, and is not">
        <p class="note">
          <!--
            5.7, stated at the moment the trade is made rather than in a policy nobody reads.
            There is no account here and no legal name anywhere, and an operator could
            reasonably read that as anonymity. It is not, and the difference matters most to
            the people with the most reason to care.
          -->
          It is a key generated on this
          phone, and <strong>everything you sign with it links together</strong> — patrols,
          answers, anything you add to the directory. That is what lets your work count as
          yours. If you need something genuinely unlinkable, it has to be a separate identity,
          and nothing here can retroactively unlink what this one has already signed.
        </p>
        <p class="note">
          <!--
            identity.md: "no recovery method means no recovery", stated plainly at persona
            creation rather than after a phone is dropped, when it is only a fact about the past.
          -->
          There is no account, so a lost phone is a lost persona unless you have made a
          backup — and choosing not to is a real choice rather than an oversight.
        </p>
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
        <p class="note">
          Most operators will not have a watch at first, and the section below is optional.
        </p>
      </Why>
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
    One tap on Distress opens a message to them, already written. <strong>Nothing is sent
    automatically and you have to press send.</strong>
  </p>
  <p class="note">
    Their number stays on this phone. <strong>A burn erases it; a panic wipe does not.</strong>
  </p>
  <Why summary="Where their number goes">
    <p class="note">
      A web app cannot press send for you, and this app will not pretend it can.
    </p>
    <p class="note">
      The number is never sent to a watch, a relay, or anyone else's machine — there is no
      list of operators' contacts anywhere for anyone to take. It is still there the next
      night.
    </p>
  </Why>
  <form onsubmit={keepContact}>
    <label for="clabel">Who</label>
    <input id="clabel" bind:value={contactLabel} autocomplete="off" placeholder="Sam" />
    <label for="cnumber">Number</label>
    <input id="cnumber" bind:value={contactNumber} type="tel" autocomplete="off" placeholder="+1 555 0100" />
    <button type="submit" disabled={!contactLabel.trim() || !contactNumber.trim()}>{contact ? 'Update' : 'Save'}</button>
  </form>
  {#if contact}
    <Slot k="Your person">
      <Readout value={contact.label} verbatim tone="good" sub={contact.number ?? null} />
    </Slot>
    <button class="forget" type="button" onclick={forgetContact}>Remove</button>
  {/if}
</section>

<section class="later">
  <h2>A watch — optional, and only if somebody gave you one</h2>
  <!-- "Skip this" stays whole. The Alone operator is the common case, not the edge one, and
       this is the sentence that stops an empty watch section reading as unfinished setup. -->
  <p class="note">
    <strong>Skip this.</strong> You do not need a watch to use NavCom, and having none is
    how most operators work.
  </p>
  <p class="note"><strong>Nothing discovers a Watchtower on its own.</strong></p>
  <Why summary="What a watch adds">
    <p class="note">
      What it adds: Query, Assist and Distress — the three things that need a person on the
      other end. What it does not change: everything else, which already works.
    </p>
    <p class="note">
      Handed to you in person, on paper or by whatever you already use — a list of them
      would be a list of where operators are. Come back when somebody hands you one.
    </p>
  </Why>
  <!-- The code first: it fills everything below, and it is the only way the escalation key arrives. -->
  <div class="code" data-watch-code>
    <label for="code">Watch code</label>
    {#if scannable}
      <button type="button" onclick={scanning ? stopScan : startScan}>
        {scanning ? 'Stop' : 'Scan a watch code'}
      </button>
      <video bind:this={camera} class="camera" class:live={scanning} playsinline muted
        aria-label="Camera, looking for a watch code"></video>
    {/if}
    <textarea id="code" bind:value={codeText} rows="2" autocomplete="off" spellcheck="false"
      placeholder="paste the code or link you were given"></textarea>
    {#if codeError}<p class="error" role="alert" data-code-error>{codeError}</p>{/if}
    <button type="button" onclick={useCode} disabled={!codeText.trim()}>Fill in from the code</button>
  </div>
  <form onsubmit={connect}>
    {#if fromBackup}
      <Slot k="Watch">
        <span data-from-backup>
          <Readout value="From your backup" tone="warn" sub="not added until you save it here" />
        </span>
      </Slot>
    {/if}
    <label for="pubkey">Pubkey</label>
    <input id="pubkey" bind:value={pubkey} autocomplete="off" spellcheck="false" placeholder="64 hex characters" />
    <label for="relays">Relays</label>
    <textarea id="relays" bind:value={relays} rows="3" autocomplete="off" spellcheck="false"></textarea>
    {#if refused.length > 0}
      <!-- Each line this page will not dial, and why, beside the field. Left out of it while the
           watch has a relay this page reaches, so that an edit to anything else still saves; in
           it, to be fixed, when there is none. -->
      <div data-relays-refused>
        <Slot k={reachable > 0 ? 'Left out' : 'Relays'}>
          <Readout
            value="Not reachable from here"
            tone="warn"
            sub={reachable > 0
              ? 'not in the list above, and not kept when you save'
              : 'nothing reaches this watch until one is fixed above'}
          />
        </Slot>
        <ul class="refused">{#each refused as r, i (i)}<li>{r.why}</li>{/each}</ul>
      </div>
    {/if}

    <label for="holders">Who holds it</label>
    <textarea id="holders" bind:value={holders} rows="3" autocomplete="off" spellcheck="false"
      placeholder="leave empty unless you were given a list"></textarea>
    <!--
      Stated before the field, because the answer for most operators is "leave it empty"
      and a blank box with no explanation reads as something missing. Both claims stay in
      front of the field they govern: who can read what you send is the one thing an operator
      must know before filling this in, so it never goes behind a tap.
    -->
    <p class="note">
      <strong>Usually empty</strong> — <strong>whoever is on this list can read everything you
      send</strong>, on watch or off.
    </p>
    <Why summary="When it is not empty">
      <p class="note">
        A watch running on a box holds its own key, and that is what most people are given. A
        squad with no box holds the watch on their phones instead, and lists one key per phone
        here. It comes from the same person who gave you the pubkey; nothing discovers it.
      </p>
    </Why>
    {#if changes.length > 0}
      <!-- What this code would change about the watch saved here, said before it is saved. -->
      <div data-code-changes>
        <Slot k="This code changes">
          <Readout value="The watch saved here" tone="warn" sub="check each line with whoever gave you the code" />
        </Slot>
        <ul class="refused">{#each changes as c, i (i)}<li>{c}</li>{/each}</ul>
      </div>
    {/if}
    {#if formKey && (shownExecutor || !listsHolders || keyChange)}
      <!-- Shown, never a field: it arrives only in a code the watch signed. -->
      <Slot k="Escalation key">
        {#if shownExecutor}
          <span data-escalation-key="named">
            <Readout
              value={keyPrint(shownExecutor) ?? 'Not a key'}
              verbatim
              tone={keyChange ? 'warn' : 'good'}
              sub={keyChange === 'replaced'
                ? `not the one saved here${olderCode ? ', and from an older code' : ''}: it decides who can end your Distress`
                : keyChange === 'added'
                  ? 'new for this watch: it decides who can end your Distress'
                  : pendingFor
                    ? `signed by the watch on ${signedOn(pendingFor.executorAt)}, kept when you save`
                    : 'only its answer ends your Distress'}
            />
          </span>
        {:else if keyChange === 'dropped'}
          <span data-escalation-key="dropped">
            <Readout
              value="Not named in this code"
              tone="warn"
              sub={`saving drops the key saved here${olderCode ? ', from an older code' : ''}`}
            />
          </span>
        {:else}
          <span data-escalation-key="none">
            <Readout value="Not named" tone="warn" sub="a person’s answer cannot be told from the agent’s" />
          </span>
        {/if}
      </Slot>
      {#if keyChange}
        <label class="confirm" data-key-confirm>
          <input type="checkbox" bind:checked={keyConfirmed} />
          This code came from whoever runs this watch, and I checked the change with them.
        </label>
      {/if}
      <Why summary="What the escalation key is">
        <p class="note">
          A box names the key only its escalation process holds. Your phone then ends a Distress
          only on an answer that key signed, and the agent running beside it cannot send one.
          Without it, anything holding the watch key can tell you a person has it. It comes only in
          a watch code the watch signed, never typed. A code is still only as good as whoever handed
          it to you, so this phone asks before one changes the key.
        </p>
      </Why>
    {/if}
    {#if watchError}
      <p class="error" role="alert" data-watch-error>{watchError}</p>
    {/if}
    <button type="submit" disabled={!pubkey.trim() || (!!keyChange && !keyConfirmed)}>{configured ? 'Update' : 'Connect'}</button>
  </form>
  {#if configured}
    <Slot k="Watch config">
      {#if notUpdated}
        <span data-not-updated>
          <Readout value="Not updated" tone="warn" sub="the watch as it was saved before is unchanged" />
        </span>
      {:else if reachable === 0}
        <Readout value="Saved, not reachable" tone="warn" sub="fix a relay above" />
      {:else}
        <Readout value="Saved" tone="good" />
      {/if}
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
  .refused {
    margin: .2rem 0 .3rem; padding-inline-start: 1.1rem; display: grid; gap: .3rem;
    font-size: .9rem; color: var(--t-ink); overflow-wrap: anywhere;
  }
  .error {
    color: var(--t-dark); border: 2px solid var(--t-dark); padding: .7rem .9rem; margin: 0;
  }
  .code { display: flex; flex-direction: column; gap: .5rem; margin-bottom: .8rem; }
  .confirm { display: flex; gap: .6rem; align-items: flex-start; color: var(--t-ink); line-height: 1.4; }
  .confirm input { min-height: 1.4rem; min-width: 1.4rem; margin-top: .1rem; }
  .camera { width: 100%; max-height: 0; border-radius: 2px; background: var(--t-sunk); }
  .camera.live { max-height: 16rem; object-fit: cover; }
</style>
