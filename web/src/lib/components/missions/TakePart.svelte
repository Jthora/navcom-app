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
   *
   * **What no relay confirmed is said, never called unsent** [audit 11.S, finding 61], and sent
   * again as the same event. **A release that did not go stays here to send** [finding 66]: letting
   * go is instant and free, and the claim it releases is still on relays until it ends.
   */
  import type { Mission } from '@navcom/core';
  import { Action, Readout, Slot } from '$lib/components/panel';
  import { MAY_HAVE_ARRIVED, claimAgain, held, letGo, refusal, takePart, unreleased, type Visibility } from '$lib/missions/claims';
  import { rememberMission } from '$lib/missions/pending';
  import { endsIn, releaseReadout } from './format';

  let { mission: m, now, open }: { mission: Mission; now: number; open?: ReadonlySet<string> } = $props();

  /** A refusal in words: never a code on a screen [11.E]. */
  const WORDS: Record<string, string> = {
    'signed-out': 'Sign on first.',
    ended: 'This mission has ended.',
    taken: 'The poster lists this one as taken.',
    cap: 'You hold three already; let one go to take this one.'
  };

  /** Bumped after every act, so what this device holds is read again. */
  let version = $state(0);
  let choosing = $state(false);
  let sending = $state(false);
  let error = $state<string | null>(null);
  /**
   * How the last claim let go from here was seen. Letting go of an open claim recalls nothing
   * anybody already has, and is itself public, under the same card [core: claim.ts — "a screen
   * offering it must say so"]; the panel went back to Take part and said nothing [audit 11.S].
   */
  let released = $state<Visibility | null>(null);

  const t = $derived(Math.floor(now / 1000));
  const mine = $derived.by(() => {
    void version;
    return held(t).find((h) => h.address === m.address) ?? null;
  });
  const why = $derived.by(() => {
    void version;
    return refusal(m, t, open);
  });
  /** A claim let go here whose release has not reached a relay: still to send [finding 66]. */
  const loose = $derived.by(() => {
    void version;
    return unreleased(t).find((u) => u.address === m.address) ?? null;
  });

  /**
   * When the two choices appeared. A tap this soon after is the rest of the gesture that opened
   * them -- a double tap, or a tap that lands as the screen changes -- not a choice of who sees it,
   * and what it would publish cannot be recalled [audit 11.S]. Measured on the monotonic clock: a
   * wall clock can be stepped back by a time correction, which would hold the choices shut.
   */
  let shownAt = 0;
  const SETTLE_MS = 400;

  /** Whatever happens, the buttons come back: a throw left every one disabled with nothing said [11.E]. */
  async function take(visibility: Visibility) {
    if (performance.now() - shownAt < SETTLE_MS) return;
    sending = true;
    error = null;
    released = null;
    try {
      const r = await takePart(m, visibility, Math.floor(Date.now() / 1000), undefined, open);
      if (!r.ok) error = WORDS[r.because] ?? r.because;
      // Sent, but not recorded: said, because a claim nobody can see cannot be let go [11.E].
      else if (!r.kept && r.held.unconfirmed) error = `${MAY_HAVE_ARRIVED} This device could not record it: its storage is full. It ends by itself within a day.`;
      else if (!r.kept) error = 'It was sent, but this device could not record it: its storage is full. It ends by itself within a day.';
    } catch (err) {
      error = err instanceof Error ? err.message : 'It could not be sent.';
    } finally {
      sending = false;
      choosing = false;
      version += 1;
    }
  }
  /** The same claim again, as it was signed: never a second one [finding 61]. */
  async function again() {
    sending = true;
    error = null;
    try {
      const r = await claimAgain(m.address, Math.floor(Date.now() / 1000));
      if (r === 'refused') error = `${MAY_HAVE_ARRIVED} No relay took it this time.`;
      else if (r === 'unconfirmed') error = MAY_HAVE_ARRIVED;
    } catch {
      error = MAY_HAVE_ARRIVED;
    } finally {
      sending = false;
      version += 1;
    }
  }
  /** Let go, or send a release that did not go before: the same call, the same signed release. */
  async function release() {
    const was = mine?.visibility ?? loose?.visibility ?? null;
    sending = true;
    error = null;
    released = null;
    try {
      const r = await letGo(m, Math.floor(Date.now() / 1000));
      // Off this device's claims either way; walking away is never refused [invariant 8].
      if ('card' in r) error = 'It was taken with a card this device no longer holds, so it cannot be let go from here. It ends by itself within a day.';
      else if (!r.sent) error = r.because;
      else released = was;
    } catch {
      error = 'No relay took the release.';
    } finally {
      sending = false;
      version += 1;
    }
  }
  /** So the terminal can take them back, and the mission reopens once there is somebody to take part. */
  function remember() {
    rememberMission(m.address, m.title);
  }
</script>

<div class="nc-takepart" data-takepart>
  {#if mine}
    <Slot k="You">
      <Readout
        value={mine.unconfirmed ? 'Unconfirmed' : 'Taking part'}
        tone={mine.unconfirmed ? 'warn' : 'good'}
        sub="{mine.unconfirmed ? 'no relay confirmed it; it may have arrived · ' : ''}ends in {endsIn(mine.ends, now)} · {mine.visibility === 'open' ? 'everyone can see' : `only ${m.publisher.name} can see`}"
      />
    </Slot>
    <div class="nc-takepart-row">
      {#if mine.unconfirmed}
        <!-- The same claim, as it was signed: a second would be one nobody could withdraw [finding 61]. -->
        <button type="button" data-sendagain disabled={sending} onclick={again}>Send again</button>
      {:else}
        <button type="button" data-renew disabled={sending} onclick={() => take(mine!.visibility)}>Still on it</button>
      {/if}
      <button type="button" data-letgo disabled={sending} onclick={release}>Let it go</button>
    </div>
  {:else if why === 'signed-out'}
    <!-- What it asks for, by the word the terminal uses: "Sign on" there starts a patrol [finding 51]. -->
    <a class="nc-act" data-act data-signon href="/terminal/setup/" data-sveltekit-reload onclick={remember}>
      <span class="nc-act-label">Choose a callsign to take part</span>
    </a>
  {:else if why === 'ended'}
    <Readout value="Ended" tone="cold" />
  {:else if why === 'taken'}
    <!-- What is known: the poster's list says taken. It may be this device's own claim, just let go [11.E]. -->
    <Readout value="Taken" tone="cold" sub="the poster lists this one as taken" />
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
    <Action label="Take part" onfire={() => ((choosing = true), (shownAt = performance.now()))} />
  {/if}
  {#if loose && !mine}
    <!--
      Let go, and no relay has confirmed the release: the claim may stand until it ends
      [finding 66]. "Unconfirmed" only if the release may be there; with no signal it is not [review].
    -->
    {@const r = releaseReadout(loose, now)}
    <Slot k="Let go">
      <Readout value={r.value} tone="warn" sub={r.sub} />
    </Slot>
    <button type="button" data-sendrelease disabled={sending} onclick={release}>Send the release</button>
  {/if}
  {#if released && !mine}
    <Readout
      value="Let go"
      tone="cold"
      sub={released === 'open'
        ? 'anyone who saw the claim keeps it, and letting go is public too, under the same card'
        : `sealed to ${m.publisher.name}, as the claim was`}
    />
  {/if}
  {#if error}
    <Readout value={error.startsWith('It was sent') ? 'Sent' : error.startsWith(MAY_HAVE_ARRIVED) ? 'Unconfirmed' : 'Not sent'} tone="warn" sub={error} />
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
