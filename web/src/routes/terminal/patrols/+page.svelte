<script lang="ts">
  /**
   * Your own record of your own nights.
   *
   * Distinct from `/terminal/log/`, which is the watch's record about you. This one is
   * yours, works with no watch, and leaving the app is a decision you make.
   */
  import { onMount } from 'svelte';
  import {
    formatDuration,
    keepsHistory,
    patrols,
    setKeepHistory,
    type Patrol
  } from '$lib/terminal/patrol';
  import { operator } from '$lib/terminal/session.svelte';
  import { exportContribution } from '$lib/terminal/contribution';
  import { storedCorrections } from '$lib/terminal/corrections.svelte';
  import { storedPlaces } from '$lib/terminal/places.svelte';
  import { loadIdentity } from '$lib/terminal/identity';
  import { Slot, Readout } from '$lib/components/panel';
  import { canShareText, shareText } from '$lib/terminal/share';
  import { RECAP_FILENAME, RECAP_SIZE, canShareFile, drawRecap, recapAlt } from '$lib/terminal/recap';

  let list = $state<Patrol[]>([]);
  let keep = $state(false);
  let callsign = $state<string | null>(null);
  let includeAreas = $state(true);
  /**
   * Off by default, unlike areas, and the asymmetry is deliberate.
   *
   * An area names a district. A note describes what happened — which is exactly where a line
   * about a person gets written despite every rule, by the project's own account of this
   * field. The two mistakes are not symmetric: an operator who wanted their notes in and
   * finds them missing sees that in the preview below and ticks a box. An operator who
   * pastes somebody else's situation into a public post cannot take it back.
   *
   * This control existed in `ExportOptions` and was honoured by `exportPatrols` from the
   * start, and no screen ever bound it — so it silently read as on, and the one field that
   * most needed a switch did not have a reachable one.
   */
  let includeNotes = $state(false);
  /**
   * The fields you corrected and the places you added, beside the nights you were out.
   *
   * On by default, unlike the notes, and the asymmetry is the same reasoning pointed the
   * other way: a correction is **already public under this callsign** — it was published to
   * relays and lands on the face of the record it fixes — so putting it here discloses
   * nothing new. A note has never left the phone.
   */
  let includeContributions = $state(true);
  let mine = $state<string | null>(null);
  let myCorrections = $state<ReturnType<typeof storedCorrections>>([]);
  let myPlaces = $state<ReturnType<typeof storedPlaces>>([]);
  let showExport = $state(false);
  let copied = $state(false);
  /**
   * Whether this phone has a share sheet.
   *
   * Read after mount, not during render: these pages prerender with no `navigator`, and a
   * control that arrives at hydration beats markup that disagrees with itself.
   */
  let canShare = $state(false);
  /**
   * The share outcomes worth saying out loud. Everything else is silent on purpose.
   *
   * `refused` is a sheet that would not take it; `saved` is a browser with no file share, where the
   * image was downloaded instead — which is a different thing that happened, not a failure.
   */
  let shareSaid = $state<'' | 'refused' | 'saved'>('');

  onMount(() => {
    list = patrols();
    keep = keepsHistory();
    callsign = operator.callsign;
    mine = loadIdentity()?.pubkey ?? null;
    myCorrections = storedCorrections();
    myPlaces = storedPlaces();
    canShare = canShareText();
  });

  const total = $derived(list.reduce((n, p) => n + (p.ended - p.started), 0));
  /**
   * Whether this operator has done anything at all worth handing over.
   *
   * The share section used to be gated on `list.length`, so an operator who had corrected a
   * dozen records and never recorded a patrol had contributed real work and no way to show
   * it — the directory's most valuable contributor being told they had nothing.
   */
  const hasContributed = $derived(
    myCorrections.some((c) => c.by === mine) || myPlaces.some((p) => p.by === mine)
  );
  const text = $derived(
    exportContribution({
      callsign,
      // No identity means nothing was authored under one, so the filter matches nothing —
      // which is the correct empty answer rather than an unfiltered one.
      mine: mine ?? '',
      patrols: list,
      corrections: myCorrections,
      places: myPlaces,
      includeAreas,
      includeNotes,
      includeContributions
    })
  );

  function toggleKeep() {
    setKeepHistory(!keep);
    keep = keepsHistory();
    list = patrols();
  }

  /**
   * Hands it to the phone, which is what the artifact was built for.
   *
   * Dismissing the sheet says nothing: that is somebody changing their mind, and printing a
   * failure for it would teach them the control is broken when it did exactly what they asked.
   */
  async function share() {
    shareSaid = '';
    copied = false;
    if ((await shareText(text)) === 'refused') shareSaid = 'refused';
  }

  /**
   * The image, which is the only version of this that reaches Instagram.
   *
   * Drawn at the moment of the tap rather than kept anywhere: it is derived from the record one
   * line at a time, and an image of where somebody has been is not a thing to leave lying in
   * storage. The caption that rides with it is the sentence an operator can also paste as alt text.
   */
  async function shareImage() {
    shareSaid = '';
    copied = false;
    const input = { callsign, patrols: list, includeAreas, includeNotes };
    const canvas = document.createElement('canvas');
    canvas.width = RECAP_SIZE;
    canvas.height = RECAP_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      shareSaid = 'refused';
      return;
    }
    drawRecap(ctx, input);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
    if (!blob) {
      shareSaid = 'refused';
      return;
    }
    const file = new File([blob], RECAP_FILENAME, { type: 'image/png' });
    if (canShareFile(file)) {
      try {
        await navigator.share({ files: [file], text: recapAlt(input) });
      } catch (err: unknown) {
        const name = (err as { name?: string } | null)?.name ?? '';
        if (name !== 'AbortError') shareSaid = 'refused';
      }
      return;
    }
    // No file share here — a desktop, usually. Saving it is the honest alternative, and it is
    // said out loud because the operator asked for one thing and got another.
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = RECAP_FILENAME;
    a.click();
    URL.revokeObjectURL(url);
    shareSaid = 'saved';
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      // Clipboard refused — the text is on screen and selectable, which is the fallback.
      copied = false;
    }
  }

  const when = (p: Patrol) => {
    const d = new Date(p.started * 1000);
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  };
  const clock = (unix: number) =>
    new Date(unix * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
</script>

<svelte:head>
  <title>Your patrols · Field Terminal</title>
  <meta name="description" content="Your own record of your own nights." />
</svelte:head>

<header>
  <p class="eyebrow"><a href="/terminal/">← Status</a></p>
  <h1>Your patrols</h1>
</header>

{#if list.length === 0 && !hasContributed}
  <section>
    <Slot k="Patrols">
      <Readout value="Nothing yet" tone="cold" sub="lands here when you stand down" />
    </Slot>
    <p class="cost">
      Your own record, not the watch's. <strong>It stays on this phone</strong> — nothing
      here is sent to a watch, a relay or anybody else — and it works with no signal at all.
    </p>
  </section>
{:else}
  {#if list.length > 0}
  <section class="tally">
    <Slot k="Patrols">
      <Readout
        value="{list.length} patrol{list.length === 1 ? '' : 's'}"
        tone="neutral"
        sub={formatDuration(total)}
      />
    </Slot>
  </section>

  <section>
    <ol class="patrols">
      {#each [...list].reverse() as p, i (i)}
        <li>
          <span class="date">{when(p)}</span>
          <span class="area">{p.area}</span>
          <span class="times">{clock(p.started)}–{clock(p.ended)} · {formatDuration(p.ended - p.started)}</span>
          {#if p.closedBy}
            <!-- Somebody confirmed you got back. That is the close of the night. -->
            <span class="home">{p.closedBy} confirmed you home</span>
          {/if}
          {#if p.note}<span class="note">{p.note}</span>{/if}
        </li>
      {/each}
    </ol>
  </section>
  {:else}
    <!--
      Corrected records and no nights of your own. A real state: the person who fixes a
      listing from a phone need never have recorded a patrol, and gating the share section on
      `list.length` told the directory's most useful contributor they had nothing.
    -->
    <section>
      <Slot k="Patrols">
        <Readout value="None recorded" tone="cold" sub="your corrections are below" />
      </Slot>
    </section>
  {/if}

  <section class="act">
    <h2>Share it</h2>
    <p>
      <strong>None of this has left your phone.</strong> Sharing is something you do on
      purpose, and this is what would go.
    </p>
    <p class="cost">
      Built so that using it cannot expose anybody who did not agree to anything: no other
      operators, nothing about anyone you helped, and no coordinates at any point.
    </p>
    <label class="opt">
      <input type="checkbox" bind:checked={includeAreas} />
      Include areas
    </label>
    <label class="opt opt--explained">
      <input type="checkbox" bind:checked={includeNotes} />
      Include your notes
      <span class="why">
        Off by default. Your notes are the one place here you wrote freely, and the most
        likely place something about another person ended up.
      </span>
    </label>
    <label class="opt opt--explained">
      <input type="checkbox" bind:checked={includeContributions} />
      Include what you corrected and added
      <span class="why">
        Already public under your callsign — a correction goes out on a relay and lands on the
        face of the record it fixes. This is the same work, gathered.
      </span>
    </label>
    <button onclick={() => (showExport = !showExport)}>
      {showExport ? 'Hide' : 'Show what would be shared'}
    </button>
    {#if showExport}
      <pre data-export>{text}</pre>
      <div class="row">
        {#if canShare}
          <button data-share onclick={share}>Share</button>
        {/if}
        <button data-share-image onclick={shareImage}>Image</button>
        <button onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      {#if shareSaid}
        <!--
          A readout rather than a sentence: the state has a name, and `panel.md` rule 1 is that
          every state gets one. It also keeps this screen's prose where it is.
        -->
        <div data-share-said={shareSaid}>
          <Slot k="Share">
            {#if shareSaid === 'refused'}
              <Readout value="Not sent" tone="warn" sub="still here, and Copy still works" />
            {:else}
              <Readout value="Saved instead" tone="neutral" sub="this browser has no share sheet for images" />
            {/if}
          </Slot>
        </div>
      {/if}
    {/if}
  </section>
{/if}

<section class="limit">
  <h2>If this phone is wiped</h2>
  <Slot k="On panic wipe">
    <Readout
      value={keep ? 'Kept' : 'Destroyed'}
      tone={keep ? 'warn' : 'good'}
      sub={keep ? 'a seized phone shows a year of them' : 'nothing about your nights survives'}
    />
  </Slot>
  <p>
    {#if keep}
      Your patrols <strong>survive a panic wipe</strong>. A year of them survives a bad
      night — and a seized phone shows a year of them.
    {:else}
      Your patrols <strong>are destroyed by a panic wipe</strong>, along with everything else
      from tonight. Nothing about your nights survives a phone being taken.
    {/if}
  </p>
  <button data-keep onclick={toggleKeep}>
    {keep ? 'Destroy them on a panic wipe' : 'Keep them through a panic wipe'}
  </button>
</section>

<style>
  .patrols { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .9rem; }
  .patrols li {
    display: flex; flex-direction: column; gap: .1rem;
    border-inline-start: 2px solid var(--t-line-strong); padding-inline-start: .8rem;
  }
  .date {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .76rem; color: var(--t-faint); text-transform: uppercase; letter-spacing: .08em;
  }
  .area { color: var(--t-ink); font-weight: 650; }
  .times { font-size: .88rem; color: var(--t-muted); }
  .home { font-size: .85rem; color: var(--t-station); }
  .note { font-size: .9rem; color: var(--t-muted); font-style: italic; margin-top: .15rem; }

  .act { gap: .6rem; }
  .opt { display: flex; align-items: center; gap: .6rem; min-height: 2.6rem; color: var(--t-muted); }
  .opt input { width: 1.2rem; height: 1.2rem; min-height: 0; }

  /* The reason sits under the control rather than beside it: on a phone held one-handed
     the row is already at its width, and a clause wrapping mid-sentence beside a checkbox
     reads as a second option. */
  .opt--explained { flex-wrap: wrap; align-items: baseline; min-height: 0; padding-block: .5rem; }
  .opt--explained .why {
    flex-basis: 100%;
    font-size: .8rem;
    line-height: 1.45;
    color: var(--t-dim, var(--t-muted));
    padding-inline-start: 1.8rem;
  }
  pre {
    background: var(--t-sunk); border: 1px solid var(--t-line-strong); padding: .8rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .8rem;
    white-space: pre-wrap; overflow-x: auto; margin: 0; color: var(--t-muted);
  }

  .limit { border-inline-start: 3px solid var(--t-line-strong); padding-inline-start: .9rem; gap: .6rem; }
</style>
