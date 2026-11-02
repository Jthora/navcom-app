<script lang="ts">
  /**
   * Signing on.
   *
   * Deliberate, never automatic. It is also the moment the operator is told what the watch
   * can actually do — before committing, not after — because invariant 4 is about belief at
   * this exact instant.
   */
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { pageableNow } from '@navcom/core';
  import { Panel, Slot, Readout, Why } from '$lib/components/panel';
  import { watch } from '$lib/terminal/watch.svelte';
  import { operator } from '$lib/terminal/session.svelte';
  import { precision, setPrecision, type Precision } from '$lib/terminal/position.svelte';
  import { loadConfig, storedWatch } from '$lib/terminal/config';
  import { heard } from '$lib/terminal/heard.svelte';
  import { HeardSlot, HeardWhy } from '$lib/components/heard';
  import { loadContact } from '$lib/terminal/contact';
  import { distressRead } from '$lib/terminal/distress-read';

  /**
   * Whether a Watchtower is configured at all — not whether it is reachable.
   *
   * The distinction that matters for the sentence below is *is there anybody who could
   * nudge me*, and a configured watch that happens to be Dark tonight is still the
   * arrangement the operator set up. Dark is reported on its own, above.
   */
  let configured = $state(false);
  /** Added, and none of its relays reachable from this page. */
  let stranded = $state(false);
  /** The operator's own person, by name: who a Distress reaches when no watch does [contact.ts]. */
  let person = $state<string | null>(null);

  let area = $state('');
  let hours = $state(2);
  let routine = $state<number | null>(60);
  let share = $state<Precision>('off');
  /** Where the watch is heard, read as Status reads it and aged on screen the same way [relay-lists §7]. */
  let nowMs = $state(Date.now());
  const heardNow = $derived(heard.now(nowMs));

  onMount(() => {
    share = precision();
    configured = loadConfig() !== null;
    stranded = !configured && storedWatch() !== null;
    person = loadContact()?.label ?? null;
    watch.start();
    const aging = setInterval(() => (nowMs = Date.now()), 15_000);
    return () => {
      clearInterval(aging);
      watch.stop();
    };
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!area.trim()) return;
    setPrecision(share);
    await operator.signOn(area.trim(), hours, routine);
    if (operator.session) goto('/terminal/');
  }

  /*
   * The receipt, read exactly as the status screen reads it [docs/design/panel.md P3].
   *
   * `pageableNow` is the core's own rule for who can actually be raised, so neither screen
   * reimplements "reachable" and then drifts from the other.
   */
  const nowS = $derived(Math.floor(Date.now() / 1000));
  const reachable = $derived(pageableNow(watch.state.oncall, nowS).map((o) => o.author.callsign));
  const watchRead = $derived(
    // "Dark" is a configured watch that is not answering. An operator who never added one
    // is not in that state, and showing it to them reads as a fault in a setup they never
    // did -- on the panel labelled "what is behind you", read immediately before they
    // decide to go out. Query, Assist and Resupply already separate these two; this screen
    // did not, and it is the one where the distinction is acted on.
    stranded
      ? { value: 'Unreachable', tone: 'warn' as const, sub: 'its relays cannot be reached from here' }
      : !configured
      ? { value: 'No watch', tone: 'cold' as const, sub: 'you have not added one' }
      : watch.state.state === 'dark'
        ? { value: 'Dark', tone: 'cold' as const, sub: null }
        : watch.state.state === 'station'
          ? { value: 'On station', tone: 'good' as const, sub: watch.state.holder }
          : { value: 'Automated', tone: 'warn' as const, sub: 'agent · not a human' }
  );
</script>

<svelte:head>
  <title>Sign on · Field Terminal</title>
  <meta name="description" content="Go on station." />
</svelte:head>

<header>
  <p class="eyebrow"><a href="/terminal/">← Status</a></p>
  <h1>Sign on</h1>
</header>

<!--
  What you are signing on to, said before you sign on, not after — and read the same way it is
  read on the status screen, because two renderings of one fact is how the two drift apart.
-->
<div data-told>
  <Panel label="What is behind you">
    <Slot k="Watch">
      <Readout value={watchRead.value} tone={watchRead.tone} sub={watchRead.sub} />
    </Slot>
    <Slot k="Distress">
      {@const d = distressRead({ reachable: reachable.length, configured: configured && !stranded, station: watch.state.state === 'station', person })}
      <Readout value={d.value} tone={d.tone} sub={d.sub} />
    </Slot>
    {#if reachable.length > 0}
      <Slot k="On call">
        <Readout
          value={reachable.join(', ')} verbatim
          tone="neutral"
          sub={reachable.length === 1 ? 'sole — ladder ends here' : null}
        />
      </Slot>
    {:else}
      <Slot k="On call" />
    {/if}
    {#if configured}
      <HeardSlot heard={heardNow} {nowMs} />
    {/if}
    {#if configured}
      <Why summary="Heard">
        <HeardWhy heard={heardNow} />
      </Why>
    {/if}
  </Panel>
</div>

<!--
  Gated on `configured` for the same reason the check-in note below is: with no watch
  there is no signal to keep trying and nothing to come back up, so both halves of this
  sentence are false for the operator it was reaching. No replacement text -- the true
  version is already said once, in the check-in note, and this file's own header warns that
  two renderings of one fact is how the two drift apart.
-->
{#if configured && watch.state.state === 'dark'}
  <section>
    <p class="error">The watch won't see this. Sign on again once it's back.</p>
  </section>
{/if}

<form onsubmit={submit}>
  <label for="area">Area</label>
  <input
    id="area" bind:value={area} required autocomplete="off"
    placeholder="a district, not an address" />

  <label for="hours">Out for</label>
  <select id="hours" bind:value={hours}>
    <option value={1}>1 hour</option>
    <option value={2}>2 hours</option>
    <option value={4}>4 hours</option>
    <option value={8}>8 hours</option>
  </select>

  <label for="routine">Check in every</label>
  <select id="routine" bind:value={routine}>
    <option value={30}>30 minutes</option>
    <option value={60}>1 hour</option>
    <option value={120}>2 hours</option>
    <option value={null}>Never</option>
  </select>
  <label for="share">Share where you are</label>
  <select id="share" bind:value={share}>
    <option value="off">Off — just the area above</option>
    <option value="coarse">Roughly — about 500m</option>
    <option value="exact">Exactly</option>
  </select>
  <p class="note">Only your watch and paired peers see it.</p>
  {#if operator.error}
    <p class="error">{operator.error}</p>
  {/if}

  <button type="submit" disabled={operator.busy || !area.trim()}>
    {operator.busy ? 'Sending…' : 'Sign on'}
  </button>
</form>

<style>
</style>
