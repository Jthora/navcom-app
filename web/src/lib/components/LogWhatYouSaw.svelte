<script lang="ts">
  /**
   * Filing an observation about one record.
   *
   * ## Why this is not the "Report a problem" panel
   *
   * That panel files a **correction**: this field is wrong, here is the right value. It says
   * what *is*, and it rots — `volatility.ts` decays it, and a later correction replaces it.
   *
   * This files an **observation**: at this time I saw this. It says what somebody *saw*, and
   * it stays true forever. `raw-intel.md` §1 is explicit that conflating the two produces a
   * system which either forgets its evidence or trusts stale claims, so they are two controls
   * with two vocabularies, not one control with a mode.
   *
   * ## There is no free-text field here, and that is the whole mechanism
   *
   * §6: free text cannot be policed, so it is not published. Everything below is a selected
   * value. There is no box for a description of a person because there is no box for a
   * sentence — an operator's own notes stay on the device, in the wipeable tier, as now.
   *
   * ## The position published is the record's, coarsened
   *
   * Never a reading from this phone. `anchorFromRecord` derives a ±20 km cell from coordinates
   * the directory already publishes, so filing this reveals no position that was not already
   * public — what it withholds is *which* of the places in that cell, until the refinement.
   */
  import { OBSERVATION_VOCABULARY, OBSERVATION_METHODS, TAGS_MAX, observationLabel,
    type ObservationMethod, type ResourceRecord } from '@navcom/core';
  import { report } from '$lib/terminal/observations.svelte';
  import { Why } from '$lib/components/panel';

  let { record, onclose }: { record: ResourceRecord; onclose: () => void } = $props();

  let picked = $state<string[]>([]);
  let method = $state<ObservationMethod>('saw');
  let anonymous = $state(false);
  let busy = $state(false);
  let outcome = $state<{ ok: boolean; text: string } | null>(null);

  /**
   * Names come from core, which is the only place that has them.
   *
   * This was `t.replace(/_/g, ' ')` and the comment argued a placeholder vocabulary deserves a
   * placeholder label. Two things were wrong with that. A replace is an algorithm rather than
   * a string, so it cannot be translated -- `light_out` reads *"light out"* in every language
   * somebody might have the phone set to. And the same argument was made independently at the
   * record row, which upper-cased nothing, so one screen showed `Locked` in its picker and
   * `locked` in the sighting directly below it.
   *
   * Naming a placeholder is not authoring the vocabulary; the terms are still §7's stub.
   *
   * The fallback cannot fire here -- these ids come from `OBSERVATION_VOCABULARY` itself, and
   * a core test asserts every term in it has a name.
   */
  const label = (t: string) => observationLabel(t) ?? t;

  const METHOD_MEANS: Record<ObservationMethod, string> = {
    saw: 'You saw it yourself',
    told: 'Somebody told you',
    inferred: 'You worked it out'
  };

  function toggle(t: string) {
    if (picked.includes(t)) picked = picked.filter((x) => x !== t);
    else if (picked.length < TAGS_MAX) picked = [...picked, t];
  }

  async function send() {
    if (picked.length === 0 || busy) return;
    busy = true;
    try {
      const r = await report({
        record,
        tags: [...picked],
        method,
        // Now, because this is filed at the door. A later screen can offer "earlier today".
        observedAt: Math.floor(Date.now() / 1000),
        anonymous
      });
      // A report that reached nothing must never read like one that landed.
      outcome = r.ok ? { ok: true, text: 'Filed.' } : { ok: false, text: r.because };
    } finally {
      busy = false;
    }
  }
</script>

<div class="log" data-log-observation>
  {#if outcome}
    <p class="cost" data-outcome>{outcome.text}</p>
    <button class="drop" onclick={onclose}>Done</button>
  {:else}
    <p class="cost">What did you see? {TAGS_MAX - picked.length} left.</p>
    <!--
      Grouped, because the published vocabulary is grouped and because twenty buttons in one
      run is a wall somebody has to read at a door at 2am. Six short runs are scannable; the
      group names come from the contract rather than being invented here.
    -->
    <div data-tags>
      {#each Object.entries(OBSERVATION_VOCABULARY) as [group, terms] (group)}
        <p class="group">{label(group)}</p>
        <div class="row">
          {#each terms as t (t)}
            <button
              class="drop"
              class:on={picked.includes(t)}
              aria-pressed={picked.includes(t)}
              disabled={!picked.includes(t) && picked.length >= TAGS_MAX}
              onclick={() => toggle(t)}
            >{label(t)}</button>
          {/each}
        </div>
      {/each}
    </div>

    <p class="cost">How do you know?</p>
    <div class="row">
      {#each OBSERVATION_METHODS as m (m)}
        <button class="drop" class:on={method === m} aria-pressed={method === m} onclick={() => (method = m)}>
          {METHOD_MEANS[m]}
        </button>
      {/each}
    </div>

    <button class="drop" class:on={anonymous} aria-pressed={anonymous} onclick={() => (anonymous = !anonymous)}>
      {anonymous ? 'No name attached' : 'Under your callsign'}
    </button>
    {#if anonymous}
      <!--
        The sentence `raw-intel.md` §2 says an operator must actually see. The field omits a
        callsign; it does not sever a history, because the event is still signed by one contact
        key and every observation filed under it joins on that key for anyone reading a relay.
      -->
      <p class="cost"><strong>Anonymous means no name. It does not mean no history.</strong></p>
    {/if}

    <Why summary="What gets published">
      <p>
        The record's own area, coarsened to about 20 km — <strong>never a reading from this
        phone</strong> — and the words you picked above. There is nowhere in this to put a
        description of anybody, and nothing you type stays only on your device because there is
        nothing to type.
      </p>
    </Why>

    <div class="row">
      <button class="drop" disabled={picked.length === 0 || busy} onclick={send}>
        {busy ? 'Filing…' : 'File it'}
      </button>
      <button class="drop" onclick={onclose}>Cancel</button>
    </div>
  {/if}
</div>

<style>
  .log { display: flex; flex-direction: column; gap: .5rem; }
  .row { display: flex; flex-wrap: wrap; gap: .35rem; }
  .group { margin: .5rem 0 .2rem; font-size: .68rem; letter-spacing: .12em; text-transform: uppercase; color: var(--t-faint); }
  /* Selected reads as pressed rather than as a different control. */
  .on { border-color: var(--t-ink); color: var(--t-ink); }
</style>
