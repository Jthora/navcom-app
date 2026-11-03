<script lang="ts">
  import { DEFAULT_RELAYS, keyPrint } from '@navcom/core';
  import { ConfigError, forgetOfferedWatch, saveConfig, watchForm } from '$lib/terminal/config';
  import { setWatchTeams } from '$lib/terminal/teams';
  import { WatchCodeError, codeChanges, looksLikeWatchCode, parseWatchCode } from '$lib/terminal/watch-code';
  import { canScan, scan, ScanError, type Scanner } from '$lib/terminal/scan';
  import type { Refused } from '$lib/terminal/relay-url';
  import { ContactError, clearContact, loadContact, saveContact } from '$lib/terminal/contact';
  import { createIdentity, loadIdentity, setCallsign } from '$lib/terminal/identity';
  import { askToKeep } from '$lib/terminal/persist';
  import { backTo, pendingMission, type PendingMission } from '$lib/missions/pending';
  import { Slot, Readout } from '$lib/components/panel';
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
  /** The callsign was made on this visit: the screen says what is next, since nothing else on it is. */
  let justMade = $state(false);
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
  let pending = $state<{ pubkey: string; executor: string | null; executorAt: number | null; text: string; teams: string[] } | null>(null);
  /** The operator has said this code came from whoever runs the watch, where it changes the escalation key. */
  let keyConfirmed = $state(false);
  let codeText = $state('');
  /** Which extras start open: by a link's hash, by what they hold, by a code that arrived. */
  let personOpen = $state(false);
  let watchOpen = $state(false);
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
        pending = { pubkey: w.pubkey.toLowerCase(), executor: w.executor, executorAt: w.executorAt ?? null, text: w.escalation, teams: [] };
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
    personOpen = !!identity || !!contact || fromLink === 'person';
    watchOpen = configured || fromBackup || fromLink === 'watch' || fromLink === 'relays' || looksLikeWatchCode(fromLink);
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
      pending = { pubkey: code.pubkey, executor: code.executor ?? null, executorAt: code.issuedAt, text: code.text, teams: [...(code.teams ?? [])] };
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
      error = 'A name is needed: it is what others see.';
      return;
    }
    identity = createIdentity(name);
    justMade = true;
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
      error = 'A name is needed: it is what others see.';
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
      // A code brings tonight's teams with it, or says there are none; an edit by hand leaves them.
      if (pendingFor) setWatchTeams(pendingFor.teams);
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
  <title>Your profile · Field Terminal</title>
  <meta name="description" content="Create your profile, and the optional extras: someone to call, a watch." />
</svelte:head>

<header>
  <p class="eyebrow"><a href="/terminal/">&larr; Status</a></p>
  <h1>Your profile</h1>
</header>

{#if error}
  <p class="error" role="alert">{error}</p>
{/if}

<section>
  {#if identity}
    <Slot k="Name">
      <Readout value={identity.callsign ?? '—'} verbatim tone="good" sub="{identity.pubkey.slice(0, 16)}…" />
    </Slot>
    {#if leftMission}
      <!-- The name was the only thing the mission asked for, so the way back is the next thing here. -->
      <a class="nc-act" data-act data-back-to-mission href="/" data-sveltekit-reload>
        <span class="nc-act-label">{backTo(leftMission)}</span>
      </a>
    {:else if justMade}
      <a class="nc-act" data-act data-setup-done href="/terminal/">
        <span class="nc-act-label">Done — to Status</span>
      </a>
    {/if}
    <form onsubmit={rename}>
      <label for="rename">Change your name</label>
      <input id="rename" bind:value={renamed} autocomplete="off" spellcheck="false" />
      <button type="submit" data-rename>Change it</button>
    </form>
    <p class="note"><a href="/terminal/backup/" data-backup-link>Back up your profile</a></p>
    <!-- Making a profile turns the terminal dim: said once, here, so it never reads as broken. -->
    <p class="note" data-signature-explained>Dimmed for night use. Document mode is one tap away.</p>
  {:else}
    <form onsubmit={makeIdentity}>
      <label for="callsign">Your name</label>
      <input id="callsign" bind:value={callsign} autocomplete="off" spellcheck="false" placeholder="a callsign, a nickname or your own name" />
      <!--
        Inert until there is something to submit: a prerendered page is tappable before it hydrates,
        and a form tapped in that window does a native GET that reloads the page and loses what was
        typed. Disabled also blocks Enter on a phone keyboard until there is a name.
      -->
      <button type="submit" disabled={!callsign.trim()}>Create profile</button>
    </form>
    <!-- The second device: the same profile carried over, never a second one made by mistake. -->
    <p class="note" data-elsewhere>
      Already on another device? <a href="/terminal/backup/#restore">Sign in with your backup</a>
    </p>
  {/if}
</section>

<!--
  The extras, each a row that opens: whenever somebody likes, never a step. Open when a link points
  at one, when it already holds something, and — someone to call — once there is a profile.
-->
<details class="extra" id="person" bind:open={personOpen}>
  <summary data-person-open>Someone to call</summary>
  <p class="note">Distress opens a message to them, ready for you to send.</p>
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
</details>

<details class="extra later" id="watch" bind:open={watchOpen}>
  <summary data-watch-open>Watch — if somebody gave you one</summary>
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
    <!-- Who can read what you send is the one thing to know before filling this in: one line, kept. -->
    <p class="note" data-holders-note>Everyone listed can read what you send.</p>
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
</details>

<style>
  header { display: flex; flex-direction: column; gap: .2rem; }
  .eyebrow {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .72rem; letter-spacing: .16em; text-transform: uppercase; margin: 0;
  }
  .eyebrow a { color: var(--t-faint); text-decoration: none; }
  h1 { font-size: 1.7rem; margin: 0; }
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
  /* The extras: a row each, closed until wanted, so the profile is the whole first screen. */
  .extra { border-top: 1px solid var(--t-line); padding-top: .4rem; display: flex; flex-direction: column; gap: .5rem; }
  .extra > summary {
    min-height: 3rem; display: flex; align-items: center; cursor: pointer;
    font-size: .95rem; color: var(--t-muted);
  }
  .extra[open] > summary { color: var(--t-ink); }
  .forget {
    min-height: 2.2rem; font-size: .8rem; padding: 0 .7rem;
    border-color: var(--t-line); color: var(--t-faint);
  }
  .note { font-size: .9rem; color: var(--t-faint); margin: 0 0 .3rem; line-height: 1.5; }
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
