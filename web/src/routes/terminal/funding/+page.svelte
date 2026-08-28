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
  <p>
    Operators buy supplies out of pocket, and somebody working under a persona cannot take
    PayPal without giving up the persona. A Lightning address lets support reach a callsign.
  </p>
  <p class="cost">
    <strong>This app never touches money.</strong> It stores a string and shows it. No
    custody, no keys, no amounts, no wallet — a seized phone yields an address, not a
    financial trail, and <strong>NavCom can never help with a payment problem</strong>
    because it never sees one.
  </p>
  <p class="cost">
    <strong>Nothing here counts anything.</strong> No totals, no supporters, no rankings, not
    now and not later. Money is a stronger status signal than any badge, and a visible total
    would rebuild the leaderboard this project refused. You see your balance in your wallet.
  </p>
</section>

<section>
  <h2>What this costs you, before you turn it on</h2>
  <ul class="picture">
    <li>
      <strong>Receiving can be pseudonymous. Converting to cash usually is not.</strong>
      Identity generally re-enters at the off-ramp. If that matters, plan for it before
      accepting anything.
    </li>
    <li>
      <strong>Self-custody means a lost phone can mean lost funds.</strong> Back up your
      wallet's recovery phrase somewhere other than the phone —
      <a href="/terminal/backup/">a NavCom backup does not carry it</a>, because NavCom
      never had it.
    </li>
    <li>
      <strong>Value moves.</strong> Sats received today may buy more or less later.
    </li>
    <li>
      <strong>Impersonation is possible.</strong> Somebody can claim to be you and collect.
      <a href="/terminal/standing/">Standing</a> makes that harder, not impossible.
    </li>
  </ul>
</section>

<section class="act">
  <h2>Your address</h2>
  <label for="mine">Lightning address</label>
  <input id="mine" bind:value={mine} autocomplete="off" spellcheck="false" placeholder="you@wallet.com" />
  <p class="cost">
    Goes on <a href="/terminal/card/">your card</a> if you publish one. With no card it is
    still yours to hand over however you like — being supportable and being findable are
    separate choices, and <strong>this one works from Ghost</strong>.
  </p>

  <h2>Squad supplies</h2>
  <label for="squad">A shared address, if the crew has one</label>
  <input id="squad" bind:value={squad} autocomplete="off" spellcheck="false" placeholder="supplies@wallet.com" />
  <p class="cost">
    Kept separate from anybody's own. Money for socks arriving somewhere that is nobody's is
    a different thing from money arriving at a person, and it sidesteps personal incentive
    entirely.
  </p>

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
  .picture { margin: 0; padding-inline-start: 1.1rem; color: var(--t-muted); }
  .picture li { margin-block-end: .7rem; }
  .picture strong { color: var(--t-ink); }
</style>
