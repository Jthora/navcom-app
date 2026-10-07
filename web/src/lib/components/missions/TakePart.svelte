<script lang="ts">
  /**
   * The one lit action on a mission: take part, and let it go [docs/design/missions.md §3].
   *
   * **Who sees it is asked every time, with nothing preselected.** Two options of equal weight,
   * one line each saying who will see it; choosing one is the act. A preference set once in a
   * settings screen would be a decision made in a different mood about a different mission.
   *
   * **Signed out, it asks for sign-on first.** Every mission here is field work, and a person
   * should not set out without `Distress` in their pocket; signing on asks for a callsign and
   * nothing else, and the mission reopens when they come back.
   */
  import type { Mission } from '@navcom/core';
  import { Action, Readout, Slot } from '$lib/components/panel';
  import { held, letGo, refusal, takePart, type Visibility } from '$lib/missions/claims';
  import { endsIn } from './format';

  let { mission: m, now }: { mission: Mission; now: number } = $props();

  /** Bumped after every act, so what this device holds is read again. */
  let version = $state(0);
  let choosing = $state(false);
  let sending = $state(false);
  let error = $state<string | null>(null);

  const t = $derived(Math.floor(now / 1000));
  const mine = $derived.by(() => {
    void version;
    return held(t).find((h) => h.address === m.address) ?? null;
  });
  const why = $derived.by(() => {
    void version;
    return refusal(m, t);
  });

  async function take(visibility: Visibility) {
    sending = true;
    error = null;
    const r = await takePart(m, visibility, Math.floor(Date.now() / 1000));
    sending = false;
    choosing = false;
    if (!r.ok) error = r.because;
    version += 1;
  }
  async function release() {
    sending = true;
    error = null;
    const r = await letGo(m, Math.floor(Date.now() / 1000));
    sending = false;
    // Gone from this device either way; walking away is never refused [invariant 8].
    if (!r.sent) error = 'The release did not reach a relay. It ends by itself within a day.';
    version += 1;
  }
  /** So the mission reopens after sign-on, on the landing page, once there is somebody to take part. */
  function remember() {
    try {
      sessionStorage.setItem('navcom.pending-mission', m.address);
    } catch {
      /* private window: they find it again on the map */
    }
  }
</script>

<div class="nc-takepart" data-takepart>
  {#if mine}
    <Slot k="You">
      <Readout
        value="Taking part"
        tone="good"
        sub="ends in {endsIn(mine.ends, now)} · {mine.visibility === 'open' ? 'everyone can see' : `only ${m.publisher.name} can see`}"
      />
    </Slot>
    <div class="nc-takepart-row">
      <button type="button" data-renew disabled={sending} onclick={() => take(mine!.visibility)}>Still on it</button>
      <button type="button" data-letgo disabled={sending} onclick={release}>Let it go</button>
    </div>
  {:else if why === 'signed-out'}
    <a class="nc-act" data-act data-signon href="/terminal/" data-sveltekit-reload onclick={remember}>
      <span class="nc-act-label">Sign on to take part</span>
    </a>
  {:else if why === 'ended'}
    <Readout value="Ended" tone="cold" />
  {:else if why === 'taken'}
    <Readout value="Taken" tone="cold" sub="somebody else holds this one" />
  {:else if why === 'cap'}
    <Readout value="3 held" tone="warn" sub="let one go to take this one" />
  {:else if choosing}
    <div class="nc-takepart-choices" role="group" aria-label="Who sees that you are taking part">
      <button type="button" data-visibility="open" disabled={sending} onclick={() => take('open')}>
        <span class="nc-takepart-who">Everyone</span>
        <span class="nc-takepart-line">anyone can see this card took this mission</span>
      </button>
      <button type="button" data-visibility="sealed" disabled={sending} onclick={() => take('sealed')}>
        <span class="nc-takepart-who">Only {m.publisher.name}</span>
        <span class="nc-takepart-line">sealed to the poster; relays see only that somebody wrote</span>
      </button>
    </div>
  {:else}
    <Action label="Take part" onfire={() => (choosing = true)} />
  {/if}
  {#if error}
    <Readout value="Not sent" tone="warn" sub={error} />
  {/if}
</div>

<style>
  .nc-takepart {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .nc-takepart-row,
  .nc-takepart-choices {
    display: grid;
    gap: 0.5rem;
  }
  .nc-takepart-row {
    grid-template-columns: 1fr 1fr;
  }
  .nc-takepart button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.2rem;
    min-height: 3rem;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--t-line-strong);
    background: var(--t-sunk);
    color: var(--t-ink);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .nc-takepart button:disabled {
    opacity: 0.6;
    cursor: progress;
  }
  .nc-takepart-who {
    font-weight: 600;
  }
  .nc-takepart-line {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--t-faint);
  }
</style>
