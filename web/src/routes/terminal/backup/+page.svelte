<script lang="ts">
  /**
   * Getting your identity onto another phone, and back after a dropped one.
   *
   * One mechanism, two situations. The screen says both because an operator arrives here
   * for one of them and should not have to work out that the other is the same thing.
   */
  import { onMount } from 'svelte';
  import { Slot, Readout, Why } from '$lib/components/panel';
  import { ageInDays, secretToHex } from '@navcom/core';
  import { RestoreError, lastMade, makeBackup, restore, restoreCode } from '$lib/terminal/backup';
  import { loadIdentity } from '$lib/terminal/identity';

  let identity = $state<ReturnType<typeof loadIdentity>>(null);
  let passphrase = $state('');
  let blob = $state<string | null>(null);
  /** The date of the last backup on this device, read once on mount. */
  let made = $state<string | null>(null);
  let copied = $state(false);
  let showCode = $state(false);

  let restorePass = $state('');
  let restoreBlob = $state('');
  let error = $state<string | null>(null);
  let done = $state<string | null>(null);

  onMount(() => {
    made = lastMade(); identity = loadIdentity(); });

  function make() {
    error = null;
    try {
      blob = makeBackup(passphrase);
      made = lastMade();
      copied = false;
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
        done = 'Your callsign is back. What you held is not — that needs a full backup.';
      } else {
        const { keys } = restore(restorePass, text);
        done = `Restored ${keys} thing${keys === 1 ? '' : 's'}. Reopen the terminal.`;
      }
      identity = loadIdentity();
    } catch (e) {
      error = e instanceof RestoreError || e instanceof Error ? e.message : 'Could not restore that.';
    }
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

<section>
  {#if identity}
    <!--
      The rule was stated and never applied. "A backup you never made does not exist" is true
      and general, and the app had no way to tell an operator which of those two people they
      were — nor that a backup made before they had any standing does not hold it.
    -->
    {#if !made}
      <!-- The marker names the whole statement, not the readout half of it: what the test
           is asserting is that the operator was told, and the telling is both parts. -->
      <div data-never-backed-up>
        <Slot k="Backup">
          <Readout value="Never made" tone="warn" sub="a lost phone is a lost persona" />
        </Slot>
        <p class="cost">
          <strong>You have not made one on this phone.</strong> Nothing here is uploaded or
          synced, so right now a lost phone is a lost persona.
        </p>
      </div>
    {:else}
      <div data-backup-age>
        <Slot k="Backup">
          <Readout
            value="{ageInDays(made, new Date())} days ago"
            tone={ageInDays(made, new Date()) > 60 ? 'warn' : 'good'}
            sub="anything taken up since is not in it"
          />
        </Slot>
        <p class="cost">
        You last made one <strong>{ageInDays(made, new Date())} days ago</strong>. Anything
          you have taken up since — people you paired with, standing somebody handed you — is
          not in it.
        </p>
      </div>
    {/if}
  {/if}

  <Why summary="What a backup is for">
    <p>
      <strong>A backup you can restore is how you move to a new phone.</strong> Same thing,
      whether you are replacing a handset on purpose or replacing one you dropped.
    </p>
  </Why>
  <p class="cost">
    <!--
      The sentence identity.md requires be stated plainly, and the one an operator has to
      read before they need it rather than after.
    -->
    There is no account here, so <strong>there is nobody to ask for your identity back</strong>.
    Nothing is uploaded, nothing is synced, and no server holds a copy — which means
    <strong>a backup you never made does not exist</strong>. Choosing not to make one is a
    real choice, and it means a lost phone is a lost persona.
  </p>
  <p class="cost">
    Keep it wherever you like — a note app, a drive, a printout in a drawer. All of those are
    places somebody else could find it, which is what the passphrase is for. It is not
    ceremony: it is the only thing standing between whoever has the file and your identity.
  </p>
  <p class="cost">
    <!--
      Twelfth time a claim landed behind a conditional the prerendered page cannot reach.
      It belongs here regardless: somebody deciding whether to make a backup needs to know
      what forgetting the passphrase costs, before they choose one.
    -->
    Pick words you will still have in a year. <strong>Nothing can recover this if you forget
    it</strong> — there is nowhere for a reset to come from, and a backup you cannot open is
    the same as one you never made.
  </p>
</section>

{#if identity}
  <section class="act">
    <h2>Make one</h2>
    <label for="pass">Passphrase</label>
    <input id="pass" type="password" bind:value={passphrase} autocomplete="new-password" />
    <p class="cost">Words you will still have in a year, not a password you will reset.</p>
    <button onclick={make} disabled={!passphrase.trim()}>Make a backup</button>

    {#if blob}
      <p class="cost">
        Everything that outlasts a night: your callsign and key, your peers, your standing,
        your card. <strong>Not tonight's patrol</strong> — a backup that carried it would
        carry the thing a panic wipe destroys.
      </p>
      <pre class="blob">{blob}</pre>
      <button onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    {/if}
  </section>

  <section class="act">
    <h2>Your recovery code</h2>
    <p class="cost">
      Short enough to write on paper. It brings back <strong>who you are</strong> and nothing
      you held — no peers, no standing, no card. Anybody who reads it becomes you, so it goes
      somewhere a backup would not.
    </p>
    {#if showCode}
      <p class="blocks">{#each (secretToHex(identity.secretKey).match(/.{1,8}/g) ?? []) as b, i (i)}<span>{b}</span>{/each}</p>
    {:else}
      <button onclick={() => (showCode = true)}>Show it</button>
    {/if}
  </section>
{/if}

<section class="act">
  <h2>Restore</h2>
  {#if identity}
    <p class="cost">
      <strong>This phone already has an identity.</strong> Restoring onto it would replace
      that one and lose whatever it holds, so it is refused — <a href="/terminal/wipe/">burn
      it first</a> if that is genuinely what you mean.
    </p>
  {:else}
    <p class="cost">Paste a backup, or a recovery code. Nothing here goes to a network.</p>
  {/if}
  <label for="rblob">Backup or recovery code</label>
  <textarea id="rblob" bind:value={restoreBlob} rows="3" autocomplete="off" spellcheck="false"></textarea>
  <label for="rpass">Passphrase</label>
  <input id="rpass" type="password" bind:value={restorePass} autocomplete="current-password" />
  <p class="cost">Leave the passphrase blank if you are pasting a recovery code.</p>
  {#if error}<p class="error">{error}</p>{/if}
  {#if done}<p class="ok" data-restored>{done}</p>{/if}
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
  .blocks {
    display: flex; flex-wrap: wrap; gap: .35rem .6rem; margin: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .95rem;
    color: var(--t-ink);
  }
  .blocks span { background: var(--t-sunk); padding: .2rem .4rem; }
  .ok { color: var(--t-station); margin: 0; }
</style>
