<script lang="ts">
  /**
   * The honest screen `funding.md` requires: the real picture before enabling, not a pitch.
   *
   * Every line here is a cost. There is no line anywhere about how much anybody has
   * received, because there is nowhere in this system that knows.
   */
  import { onMount } from 'svelte';
  import { address, FundingError, setAddress, setSquadAddress, squadAddress } from '$lib/terminal/funding';
  import { Slot, Readout } from '$lib/components/panel';

  let mine = $state('');
  let squad = $state('');
  let error = $state<string | null>(null);
  let saved = $state(false);

  onMount(() => {
    mine = address() ?? '';
    squad = squadAddress() ?? '';
  });

  function keep() {
    error = null;
    saved = false;
    try {
      setAddress(mine);
      setSquadAddress(squad);
      saved = true;
    } catch (e) {
      error = e instanceof FundingError ? e.message : 'Could not save that.';
    }
  }
</script>

<svelte:head>
  <title>Support · Field Terminal</title>
  <meta name="description" content="An address support can reach, and what that costs." />
</svelte:head>

<header>
  <p class="eyebrow"><a href="/terminal/">← Status</a></p>
  <h1>Support</h1>
</header>

<section>
  <p>A Lightning address people can send support to.</p>
  <!-- The one cost that can undo a persona, kept beside the field (2026-11-01). -->
  <p class="cost">Receiving can be pseudonymous. Converting to cash usually is not.</p>
</section>

<section class="act">
  <h2>Your address</h2>
  <label for="mine">Lightning address</label>
  <input id="mine" bind:value={mine} autocomplete="off" spellcheck="false" placeholder="you@wallet.com" />
  <p class="cost">Goes on <a href="/terminal/card/">your public profile</a> if you publish one.</p>

  <h2>Squad supplies</h2>
  <label for="squad">A shared address, if the crew has one</label>
  <input id="squad" bind:value={squad} autocomplete="off" spellcheck="false" placeholder="supplies@wallet.com" />
  <!-- Written on the phone and read back into this box and nowhere else: a card's fields are a
       closed list, and this is not on it. -->
  <p class="cost">Kept on this phone only.</p>

  {#if error}<p class="error">{error}</p>{/if}
  {#if saved}
    <div data-saved>
      <Slot k="Support"><Readout value="Saved" tone="good" sub="clear a field to remove it" /></Slot>
    </div>
  {/if}
  <button onclick={keep}>Save</button>
</section>

<style>
  .act { gap: .6rem; }
  input { width: 100%; }
</style>
