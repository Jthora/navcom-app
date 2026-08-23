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
  import { capabilitySentence, pageableNow } from '@navcom/core';
  import { Panel, Slot, Readout, Why } from '$lib/components/panel';
  import { watch } from '$lib/terminal/watch.svelte';
  import { operator } from '$lib/terminal/session.svelte';
  import { precision, setPrecision, type Precision } from '$lib/terminal/position.svelte';

  let area = $state('');
  let hours = $state(2);
  let routine = $state<number | null>(60);
  let share = $state<Precision>('off');

  onMount(() => {
    share = precision();
    watch.start();
    return () => watch.stop();
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
    watch.state.state === 'dark'
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
      {#if reachable.length === 0}
        <Readout value="No addressee" tone="warn" sub="pages nobody, and says so" />
      {:else}
        <Readout value="Pages on-call" tone="neutral" />
      {/if}
    </Slot>
    {#if reachable.length > 0}
      <Slot k="On call">
        <Readout
          value={reachable.join(', ')}
          tone="neutral"
          sub={reachable.length === 1 ? 'sole — ladder ends here' : null}
        />
      </Slot>
    {:else}
      <Slot k="On call" />
    {/if}
    <Why open={watch.state.state === 'dark'}>
      <p>{capabilitySentence(watch.state, nowS)}</p>
    </Why>
  </Panel>
</div>

{#if watch.state.state === 'dark'}
  <section>
    <p class="error">
      Nothing is watching. You can still sign on — the signal will keep trying — but
      <strong>nobody will see it</strong> until a watch comes back up.
    </p>
  </section>
{/if}

<form onsubmit={submit}>
  <label for="area">Area</label>
  <input
    id="area" bind:value={area} required autocomplete="off"
    placeholder="Downtown, Riverfront" />
  <p class="note">
    Coarse. A district, never an address — this goes on the board and travels with a
    Distress.
  </p>

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
  <p class="note">
    A missed check-in gets you a nudge, and <strong>nothing else</strong>. It never
    escalates, never pages anyone, and never counts as distress.
  </p>

  <label for="share">Share where you are</label>
  <select id="share" bind:value={share}>
    <option value="off">Off — just the area above</option>
    <option value="coarse">Roughly — about 500m</option>
    <option value="exact">Exactly</option>
  </select>
  <p class="note">
    <!--
      Three facts, all of which change what an operator would choose, and none of which
      they can discover by using it.
    -->
    Goes to <strong>the watch and the peers you paired with, and nowhere else</strong>.
    There is no setting that makes it public. Only the latest is kept — nobody sees where
    you were, and it stops the moment you stand down.
  </p>
  <p class="note">
    A browser cannot follow you with the app closed, so this updates while it is open and
    freezes at the last fix when it is not.
  </p>

  {#if operator.error}
    <p class="error">{operator.error}</p>
  {/if}

  <button type="submit" disabled={operator.busy || !area.trim()}>
    {operator.busy ? 'Sending…' : 'Sign on'}
  </button>
</form>

<style>
</style>
