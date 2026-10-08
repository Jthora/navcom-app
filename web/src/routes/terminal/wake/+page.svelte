<script lang="ts">
  /**
   * Wake the others.
   *
   * Opened by a repeat page: somebody who acknowledged an operator, paged again because that
   * operator's phone is still sending [`escalation.spec.md`, *Wake the others*]. Fixed words, and one
   * action, which asks the watch to page everyone on call about that attempt.
   *
   * **It can only widen who is woken, and it never closes anything.** Nothing about it tells the
   * operator a person has it; that comes only from somebody acknowledging the page it causes, the
   * person who tapped included. There is no acknowledge control here, and there must never be: the
   * attempt this page is about has no ladder to acknowledge, and a one-tap "I have this" would tell
   * the person tapping that the operator had heard them.
   *
   * It says what it did. The watch answers — accepted, with who is being paged, or refused and why —
   * and that answer is the only way the person who tapped learns whether anybody else is being
   * woken, so the screen waits for it and says plainly when none came.
   */
  import { onMount } from 'svelte';
  import { operator, watchClosure, type WakeOutcome } from '$lib/terminal/session.svelte';
  import { Action, Why } from '$lib/components/panel';
  import { wakeFrom, wakeWords, type WakeContext } from '$lib/terminal/wake';

  /** False until the address has been read: a prerendered page knows no attempt yet. */
  let mounted = $state(false);
  let now = $state(Math.floor(Date.now() / 1000));
  let ctx = $state<WakeContext>({ attempt: null, pagedAt: null, ackedAt: null, widensAt: null });
  let sending = $state(false);
  let outcome = $state<WakeOutcome | null>(null);
  /** Whether this watch names its escalation key: on one that does not, no answer can be confirmed. */
  let named = $state(false);

  onMount(() => {
    now = Math.floor(Date.now() / 1000);
    ctx = wakeFrom(location.search, now);
    named = watchClosure()?.executor != null;
    mounted = true;
    // The minutes in the words count down while the screen is open.
    const tick = setInterval(() => (now = Math.floor(Date.now() / 1000)), 15_000);
    return () => clearInterval(tick);
  });

  const words = $derived(wakeWords(ctx, now));

  /** Words from the watch, bounded, as the Distress screen bounds them. */
  const clip = (s: string | null | undefined): string | null =>
    s ? (s.length > 280 ? `${s.slice(0, 279)}…` : s) : null;

  /**
   * Whether the button is still offered: before anything was sent, and after a send no relay took
   * that no answer from the executor followed — the one case where trying again can help.
   */
  const offer = $derived(!outcome || (outcome.took === 0 && outcome.from !== 'executor'));

  /** Only ever from a tap. */
  async function wake() {
    if (!ctx.attempt || sending) return;
    sending = true;
    outcome = null;
    try {
      outcome = await operator.wakeOthers(ctx.attempt);
    } finally {
      sending = false;
    }
  }
</script>

<svelte:head>
  <title>Wake the others · Field Terminal</title>
  <meta name="description" content="Ask the watch to page everyone on call." />
</svelte:head>

<header>
  <p class="eyebrow"><a href="/terminal/">← Status</a></p>
  <h1>Wake the others</h1>
</header>

<section class="again" data-wake>
  <p data-wake-words><strong>{words.lead}</strong> {words.next}</p>
</section>

{#if mounted}
  {#if !ctx.attempt}
    <p class="error" data-wake-no-attempt>
      This page does not say which Distress it is about, so there is nothing to send from here.
      Reach the operator another way.
    </p>
  {:else}
    {#if offer}
      <span data-wake-action>
        <Action
          label={sending ? 'Sending…' : 'Wake the others now'}
          tone="alarm"
          disabled={sending}
          onfire={wake}
        />
      </span>
    {/if}

    {#if outcome && outcome.answer && outcome.from === 'executor'}
      <section class="said" data-wake-answered>
        <p>
          <strong>{outcome.took > 0 ? 'Sent.' : 'It arrived, though no relay confirmed it.'}</strong>
          {outcome.answer.responder?.kind === 'agent' ? 'An agent answered' : 'The watch answered'}:
        </p>
        <p class="words">{clip(outcome.answer.text) ?? 'nothing in words'}</p>
      </section>
    {:else if outcome && outcome.answer}
      <!-- Signed by the watch key, which the daemon beside the agent holds too: shown, never relied on. -->
      <section class="said" data-wake-unconfirmed>
        <p><strong>{outcome.took > 0 ? 'Sent.' : 'No relay confirmed it.'}</strong> An answer came (unconfirmed):</p>
        <p class="words">{clip(outcome.answer.text) ?? 'nothing in words'}</p>
        <p>
          {named
            ? 'It is not signed by this watch’s escalation key, so this phone cannot confirm anybody is being woken.'
            : 'This watch does not name its escalation key, so this phone cannot confirm who sent that.'}
          Reach the operator another way as well.
        </p>
      </section>
    {:else if outcome && outcome.took === 0}
      <p class="error" data-wake-failed>
        <strong>It did not send — {outcome.error}</strong> Nobody else has been woken by this.
        Reach the operator another way.
      </p>
    {:else if outcome}
      <p class="error" data-wake-unanswered>
        <strong>Sent, and the watch has not answered.</strong> This phone cannot say whether anybody
        else is being woken. Reach the operator another way.
      </p>
    {/if}
  {/if}
{/if}

<Why summary="What this does, and does not">
  <p class="cost">
    It asks the watch to page everyone on call about this operator, now. It does not tell the
    operator anybody has it, and it closes nothing: only somebody acknowledging that new page does,
    you included.
  </p>
  <p class="cost">
    It asks about the one operator this page came for. If you acknowledged more than one who is still
    sending, it does not ask about the others.
  </p>
  <p class="cost">
    You were paged because you answered them. If you are with them, you do not need this.
  </p>
</Why>

<style>
  .again { border: 2px solid var(--t-oncall); background: var(--t-raised); padding: 1rem 1.1rem; }
  .again p { color: var(--t-ink); font-size: 1.1rem; line-height: 1.5; margin: 0; }
  .said { border: 2px solid var(--t-line-strong); padding: 1rem 1.1rem; gap: .4rem; }
  .said p { margin: 0; color: var(--t-ink); }
  .said .words { font-size: 1.05rem; }
</style>
