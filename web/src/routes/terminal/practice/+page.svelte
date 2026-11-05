<script lang="ts">
  /**
   * Practice: Check in, Query, Assist and Distress, pressed against a pretend watch [practice.ts].
   *
   * Nothing on this screen sends anything, and the real Distress stays one tap away at the top. The
   * hold is the real one's: as long, felt the same way, so the gesture is the thing learned.
   */
  import { onDestroy, onMount } from 'svelte';
  import { Slot, Readout, Elapsed } from '$lib/components/panel';
  import { pulse } from '$lib/terminal/haptic';
  import { loadContact } from '$lib/terminal/contact';
  import { noWatchSays, phaseAt, pretendAnswer, type PracticeItem, type PracticeKind } from '$lib/terminal/practice';

  /** The real Distress's hold, to the millisecond, so practice teaches the same gesture. */
  const HOLD_MS = 1200;

  let noSignal = $state(false);
  let noWatch = $state(false);
  let question = $state('');
  let items = $state<PracticeItem[]>([]);
  let nowMs = $state(Date.now());
  let contactLabel = $state<string | null>(null);
  let next = 1;
  let ticking: ReturnType<typeof setInterval> | null = null;

  onMount(() => {
    contactLabel = loadContact()?.label ?? null;
    ticking = setInterval(() => (nowMs = Date.now()), 500);
  });

  function press(kind: PracticeKind, urgency?: 'soon' | 'now') {
    const at = Date.now();
    items = [{ id: next++, kind, pressedAt: at, noSignal, noWatch, ...(urgency ? { urgency } : {}) }, ...items.filter((i) => i.kind !== kind)];
    nowMs = at;
  }

  const itemOf = (kind: PracticeKind) => items.find((i) => i.kind === kind) ?? null;

  /* The hold, as the real one does it: the fill is animation, the firing a timer. */
  let holdStart = $state<number | null>(null);
  let progress = $state(0);
  let frame: number | null = null;
  let doneAt: ReturnType<typeof setTimeout> | null = null;
  function tick() {
    if (holdStart === null) return;
    progress = Math.min((Date.now() - holdStart) / HOLD_MS, 1);
    frame = requestAnimationFrame(tick);
  }
  function holdDown() {
    pulse('tap');
    holdStart = Date.now();
    frame = requestAnimationFrame(tick);
    doneAt = setTimeout(() => holdUp(true), HOLD_MS);
  }
  function holdUp(complete = false) {
    if (frame !== null) cancelAnimationFrame(frame);
    if (doneAt !== null) clearTimeout(doneAt);
    frame = null;
    doneAt = null;
    holdStart = null;
    progress = 0;
    if (complete) {
      pulse('committed');
      press('distress');
    }
  }

  onDestroy(() => {
    if (ticking !== null) clearInterval(ticking);
    if (frame !== null) cancelAnimationFrame(frame);
    // A hold left before it completed never fires from a screen already gone, as on the real one.
    if (doneAt !== null) clearTimeout(doneAt);
  });

  const LABEL: Record<PracticeKind, string> = { 'check-in': 'Check in', query: 'Query', assist: 'Assist', distress: 'Distress' };
</script>

<svelte:head>
  <title>Practice · Field Terminal</title>
  <meta name="description" content="Check in, Query, Assist and Distress, against a pretend watch. Nothing is sent." />
</svelte:head>

<header>
  <p class="eyebrow"><a href="/terminal/">← Status</a></p>
  <h1>Practice</h1>
</header>

<section class="banner" data-practice-banner>
  <Slot k="Practice">
    <Readout value="Nothing is sent" tone="warn" sub="the watch here is pretend" />
  </Slot>
  <a class="real" href="/terminal/distress/" data-real-distress>Real Distress</a>
</section>

<section>
  <label class="toggle"><input type="checkbox" bind:checked={noSignal} data-practice-no-signal /> No signal</label>
  <label class="toggle"><input type="checkbox" bind:checked={noWatch} data-practice-no-watch /> No watch</label>
</section>

{#snippet outcome(kind: PracticeKind)}
  {@const item = itemOf(kind)}
  {#if item}
    {@const at = phaseAt(item, nowMs)}
    <div data-practice-outcome={kind} data-phase={at.phase}>
      <Slot k={LABEL[kind]}>
        {#if at.phase === 'waiting-signal'}
          <Readout value="Waiting for signal" tone="warn" sub="goes by itself once there is some" />
        {:else if at.phase === 'waiting'}
          <Readout value="Waiting for the watch" tone="neutral" sub={item.urgency ? `Assist, ${item.urgency}` : null} />
          <Elapsed since={Math.floor((at.sentAt ?? item.pressedAt) / 1000)} now={Math.floor(nowMs / 1000)} label="Sent" />
        {:else if at.phase === 'answered'}
          {@const a = pretendAnswer(kind)}
          <Readout value={a.value} tone="good" sub={a.sub} />
        {:else}
          {@const n = noWatchSays(kind)}
          <Readout value={n.value} tone={kind === 'distress' ? 'warn' : 'cold'} sub={contactLabel && kind !== 'check-in' ? `text ${contactLabel}` : n.sub} />
        {/if}
      </Slot>
    </div>
  {/if}
{/snippet}

<section>
  <h2>Check in</h2>
  <button onclick={() => press('check-in')} data-practice-check-in>Check in</button>
  {@render outcome('check-in')}
</section>

<section>
  <h2>Query</h2>
  <label for="practice-q">Ask the watch</label>
  <textarea id="practice-q" bind:value={question} rows="2" placeholder="somewhere warm near here?"></textarea>
  <button onclick={() => press('query')} disabled={!question.trim()} data-practice-query>Send</button>
  {@render outcome('query')}
</section>

<section>
  <h2>Assist</h2>
  <div class="row">
    <button onclick={() => press('assist', 'soon')} data-practice-assist="soon">Soon</button>
    <button onclick={() => press('assist', 'now')} data-practice-assist="now">Now</button>
  </div>
  {@render outcome('assist')}
</section>

<section>
  <h2>Distress</h2>
  <button
    class="raise"
    style="--fill: {progress * 100}%"
    oncontextmenu={(e) => e.preventDefault()}
    onpointerdown={holdDown}
    onpointerup={() => holdUp()}
    onpointerleave={() => holdUp()}
    onpointercancel={() => holdUp()}
    data-practice-distress
  >
    <span>{progress > 0 ? 'Keep holding…' : 'Hold: practice'}</span>
  </button>
  {@render outcome('distress')}
</section>

<section>
  <button onclick={() => (items = [])} disabled={items.length === 0} data-practice-reset>Start again</button>
</section>

<style>
  .banner { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem; justify-content: space-between; }
  .real { color: var(--t-dark); font-weight: 600; min-height: 2.75rem; display: inline-flex; align-items: center; }
  .toggle { display: inline-flex; align-items: center; gap: .4rem; min-height: 2.75rem; margin-inline-end: 1rem; }
  .row { display: flex; gap: .5rem; flex-wrap: wrap; }
  textarea { width: 100%; }
  /* The real hold's shape, dashed: the same gesture, and plainly not the real button. */
  .raise {
    position: relative; overflow: hidden; width: 100%;
    min-height: 4.5rem; font-size: 1.1rem;
    border: 2px dashed var(--t-line-strong); color: var(--t-ink); background: var(--t-sunk);
    touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
  }
  .raise::before {
    content: ''; position: absolute; inset: 0 auto 0 0; width: var(--fill, 0%);
    background: var(--t-muted); opacity: .28;
  }
  .raise span { position: relative; }
</style>
