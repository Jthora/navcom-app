<script lang="ts">
  /**
   * Getting your identity onto another phone, and back after a dropped one.
   *
   * One mechanism, two situations. The screen says both because an operator arrives here
   * for one of them and should not have to work out that the other is the same thing.
   *
   * **And the same persona on two devices** — a tablet and a laptop's browser, the owner's first
   * test (2026-11-01). Still no account: the backup is shown as a QR code on the device that has it
   * and scanned by the one that does not, or copied across as text where no camera can scan.
   */
  import { onMount } from 'svelte';
  import encodeQR from '@paulmillr/qr';
  import { canScan, scan, ScanError, type Scanner } from '$lib/terminal/scan';
  import { Slot, Readout } from '$lib/components/panel';
  import { ageInDays, keyPrint, secretToHex } from '@navcom/core';
  import { RestoreError, lastMade, makeBackup, restore, restoreCode, type NamedWatch } from '$lib/terminal/backup';
  import { carryOf } from '$lib/terminal/fields';
  import { ConfigError, addOfferedWatch, forgetOfferedWatch, offeredWatch } from '$lib/terminal/config';
  import { refusedOf, usable } from '$lib/terminal/relay-url';
  import { loadIdentity } from '$lib/terminal/identity';

  let identity = $state<ReturnType<typeof loadIdentity>>(null);
  let passphrase = $state('');
  let blob = $state<string | null>(null);
  /** The date of the last backup on this device, read once on mount. */
  let made = $state<string | null>(null);
  let copied = $state(false);
  let showCode = $state(false);
  /** The backup as a QR code, for the other device's camera; null when it is too big for one. */
  let asCode = $state<string | null>(null);
  let codeError = $state<string | null>(null);
  /** Scanning a backup another device shows: offered only where this browser can scan. */
  let scannable = $state(false);
  let scanning = $state(false);
  let scanner: Scanner | null = null;
  let camera = $state<HTMLVideoElement>();

  let restorePass = $state('');
  let restoreBlob = $state('');
  let error = $state<string | null>(null);
  let done = $state<string | null>(null);
  /**
   * A watch the backup named, waiting for the operator to say yes: nothing routes there until then.
   * Read back from storage, so leaving this screen — which its own success line says to do — does
   * not lose it [audit: relay paths, review].
   */
  let named = $state<NamedWatch | null>(null);
  let watchError = $state<string | null>(null);
  let watchAdded = $state(false);
  /** The relays it would be added with, and the ones left out with why: the same rule as everywhere. */
  const reach = $derived(named ? { relays: usable(named.relays), left: refusedOf(named.relays) } : null);

  onMount(() => {
    made = lastMade(); identity = loadIdentity(); named = offeredWatch(); scannable = canScan();
    return () => scanner?.stop();
  });

  /**
   * The backup as a QR code. Low error correction, since it is read off a screen and the most it can
   * hold matters more; a kit too big for one code says so and is copied as text instead.
   */
  function showAsCode() {
    codeError = null;
    try {
      asCode = blob ? encodeQR(blob, 'svg', { ecc: 'low', border: 2 }) : null;
    } catch {
      asCode = null;
      codeError = 'Too much for one code. Copy it as text instead.';
    }
  }

  async function startScan() {
    if (!camera) return;
    error = null;
    scanning = true;
    try {
      scanner = await scan(camera);
      restoreBlob = (await scanner.found).trim();
    } catch (e) {
      error = e instanceof ScanError ? e.message : 'Could not scan.';
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

  function make() {
    error = null;
    try {
      blob = makeBackup(passphrase);
      made = lastMade();
      copied = false;
      asCode = null;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not make a backup.';
    }
  }

  async function copy() {
    if (!blob) return;
    try {
      await navigator.clipboard.writeText(blob);
      copied = true;
    } catch {
      copied = false;
    }
  }

  function take() {
    error = null;
    done = null;
    try {
      const text = restoreBlob.trim();
      if (/^[0-9a-f]{64}$/i.test(text)) {
        restoreCode(text);
        done = 'Signed in with your key. A full backup also brings your name and the rest.';
      } else {
        const { keys, watch, withheld, watchKeyStayed } = restore(restorePass, text);
        named = watch;
        watchAdded = false;
        watchError = null;
        const restored = 'Signed in.';
        // Not "reopen the terminal" while a watch is still to be decided on below it.
        done = !watch
          ? restored
          : keys === 0
            ? 'This backup holds only a watch. Add it or forget it below.'
            : `${restored} It also names a watch: add it or forget it below, then reopen the terminal.`;
        /*
         * What stayed behind, said rather than dropped. A backup no longer carries the watch key
         * (`fields.ts`), and one an older build made does and is refused it: told only "Restored",
         * a holder would believe they still held the watch. Other fields this phone keeps for
         * itself it learns again, and are not worth a sentence.
         */
        if (watchKeyStayed) {
          done += ' The watch key stayed on the other device.';
        }
        const unknown = withheld.filter((k) => carryOf(k) === null).length;
        if (unknown > 0) {
          done += ` ${unknown} unknown item${unknown === 1 ? '' : 's'} left out.`;
        }
      }
      identity = loadIdentity();
    } catch (e) {
      error = e instanceof RestoreError || e instanceof Error ? e.message : 'Could not restore that.';
    }
  }

  /**
   * Adds the named watch with the relays this page can reach — the ones left out are listed above
   * the button — through the setup screen's checks on everything else, or says what is wrong.
   */
  function addWatch() {
    if (!named) return;
    watchError = null;
    try {
      addOfferedWatch(named);
      watchAdded = true;
    } catch (e) {
      watchError = e instanceof ConfigError ? e.message : 'That watch could not be added.';
    }
  }

  /** Declining is something the operator does, not what happens to them by leaving the screen. */
  function forgetWatch() {
    forgetOfferedWatch();
    named = null;
    watchError = null;
  }
</script>

<svelte:head>
  <title>Backup · Field Terminal</title>
  <meta name="description" content="Carrying an identity to another phone." />
</svelte:head>

<header>
  <p class="eyebrow"><a href="/terminal/">← Status</a></p>
  <h1>Backup</h1>
</header>
{#if identity}
  <section class="act">
    <h2>Back up your profile</h2>
    {#if !made}
      <div data-never-backed-up>
        <Slot k="Last backup"><Readout value="Never" tone="warn" /></Slot>
      </div>
    {:else}
      <div data-backup-age>
        <Slot k="Last backup">
          <Readout value="{ageInDays(made, new Date())} days ago" tone={ageInDays(made, new Date()) > 60 ? 'warn' : 'good'} />
        </Slot>
      </div>
    {/if}
    <label for="pass">Passphrase</label>
    <input id="pass" type="password" bind:value={passphrase} autocomplete="new-password" />
    <button onclick={make} disabled={!passphrase.trim()}>Make a backup</button>
    {#if blob}
      <pre class="blob">{blob}</pre>
      <div class="row">
        <button onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        <button onclick={showAsCode} data-show-backup-code>Show as a code</button>
      </div>
      {#if asCode}
        <p class="cost">Scan it from Backup on your other device.</p>
        <div class="qr" data-backup-code>{@html asCode}</div>
      {/if}
      {#if codeError}<p class="error">{codeError}</p>{/if}
    {/if}
  </section>
  <section class="act">
    <h2>Recovery code</h2>
    {#if showCode}
      <p class="blocks">{#each (secretToHex(identity.secretKey).match(/.{1,8}/g) ?? []) as b, i (i)}<span>{b}</span>{/each}</p>
    {:else}
      <button onclick={() => (showCode = true)}>Show it</button>
    {/if}
  </section>
{/if}
<section class="act" id="restore">
  <h2>Sign in with a backup</h2>
  {#if identity}
    <p class="cost">This device already has a profile. <a href="/terminal/wipe/">Burn it</a> to sign in with another.</p>
  {/if}
  <label for="rblob">Backup or recovery code</label>
  <textarea id="rblob" bind:value={restoreBlob} rows="3" autocomplete="off" spellcheck="false"></textarea>
  {#if scannable}
    <button type="button" data-scan-backup onclick={scanning ? stopScan : startScan}>{scanning ? 'Stop scanning' : 'Scan a code'}</button>
    <video bind:this={camera} class="camera" class:on={scanning} playsinline muted></video>
  {/if}
  <label for="rpass">Passphrase</label>
  <input id="rpass" type="password" bind:value={restorePass} autocomplete="current-password" />
  {#if error}<p class="error">{error}</p>{/if}
  {#if done}<p class="ok" data-restored>{done}</p>{/if}
  {#if named && reach && !watchAdded}
    <!--
      Where a Distress will go, and who can read it, said before anything routes there.

      By key, not only by relay: the relays a setup screen prefills are the same two for nearly
      every watch, so they told one watch from another not at all, and a kit handed over with its
      passphrase could name somebody else's key on them [audit: relay paths, review]. And an
      empty holder list is a box reading with its own key — "no holders" sat directly above
      "whoever holds it can read everything you send".
    -->
    <div class="named" data-named-watch>
      <Slot k="Watch">
        <Readout
          value="Named in this backup"
          tone="warn"
          sub={`${reach.relays.length} of ${named.relays.length} relay${named.relays.length === 1 ? '' : 's'} usable from here`}
        />
      </Slot>
      <Slot k="Address">
        <span data-named-print>
          <Readout value={keyPrint(named.pubkey) ?? 'Not a key'} verbatim tone="neutral" sub="check every character against what you were given" />
        </span>
      </Slot>
      <Slot k="Read by">
        {#each named.holders as h, i (i)}
          <span data-holder-print><Readout value={keyPrint(h) ?? 'Not a key'} verbatim tone="neutral" /></span>
        {:else}
          <Readout value="Its own key" tone="neutral" sub="a box holds the watch itself" />
        {/each}
      </Slot>
      {#if named.executor}
        <!-- The key whose answer ends a Distress on that box [G3]: added with the watch, never typed. -->
        <Slot k="Escalation key">
          <span data-named-executor>
            <Readout value={keyPrint(named.executor) ?? 'Not a key'} verbatim tone="neutral" sub="added with the watch" />
          </span>
        </Slot>
      {/if}
      <p>Not added yet. Every Distress you send would go to it.</p>
      <p class="prints">{#each reach.relays as r (r)}<span>{r}</span>{/each}</p>
      {#if reach.left.length > 0}
        <!-- Left out by the rule every relay list follows, and named rather than dropped. -->
        <ul class="left" data-relays-left-out>
          {#each reach.left as r, i (i)}<li>{r.why}</li>{/each}
        </ul>
      {/if}
      {#if watchError}<p class="error" role="alert">{watchError}</p>{/if}
      <div class="row">
        {#if reach.relays.length > 0}
          <button onclick={addWatch} data-add-watch>Add this watch</button>
        {:else}
          <!-- Nothing here to add it with. Setup has it filled in, where a line can be fixed. -->
          <a class="fix" href="/terminal/setup/#relays" data-fix-watch>Fix its relays in setup</a>
        {/if}
        <button class="drop" onclick={forgetWatch} data-forget-watch>Not my watch</button>
      </div>
    </div>
  {:else if named && watchAdded}
    <p class="ok" data-watch-added>Watch added.</p>
  {/if}
  <button onclick={take} disabled={!restoreBlob.trim()}>Restore</button>
</section>

<style>
  .act { gap: .6rem; }
  input, textarea { width: 100%; }
  .blob {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .7rem;
    background: var(--t-sunk); border: 1px solid var(--t-line); padding: .6rem;
    overflow-x: auto; margin: 0; color: var(--t-muted); max-height: 9rem;
  }
  .blocks, .prints {
    display: flex; flex-wrap: wrap; gap: .35rem .6rem; margin: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .95rem;
    color: var(--t-ink);
  }
  .blocks span, .prints span { background: var(--t-sunk); padding: .2rem .4rem; overflow-wrap: anywhere; }
  .ok { color: var(--t-station); margin: 0; }
  .named { display: flex; flex-direction: column; gap: .6rem; }
  .left { margin: 0; padding-inline-start: 1.1rem; display: grid; gap: .3rem; overflow-wrap: anywhere; }
  .row { display: flex; gap: .6rem; flex-wrap: wrap; align-items: center; }
  .drop { border-color: var(--t-line); color: var(--t-faint); }
  /* White ground whatever the theme, and large: a backup is a dense code, read off one screen by another's camera. */
  .qr { background: #fff; padding: .8rem; align-self: flex-start; line-height: 0; }
  .qr :global(svg) { width: min(86vw, 26rem); height: auto; display: block; }
  .camera { width: 100%; max-height: 0; border-radius: 2px; background: var(--t-sunk); }
  .camera.on { max-height: 20rem; object-fit: cover; }
</style>
