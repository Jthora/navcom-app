<script lang="ts">
  import FieldRow from '$lib/components/FieldRow.svelte';
  import { displayField, displayRecord } from '$lib/directory';
  import { AVAILABILITY_FIELDS, FIELD_LABELS, INTAKE_FIELDS, labelValue } from '$lib/directory/load';
  import { localTimeNote } from '@navcom/core';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const now = $derived(new Date(data.builtAt));
  const record = $derived(data.record);
  const meta = $derived(displayRecord(record, now));
  /** The build date, for the printed sheet. The site ships no JavaScript, so this is it. */
  const publishedOn = $derived(data.builtAt.slice(0, 10));

  /**
   * Whether this record's most perishable facts have gone stale.
   *
   * Decided with the directory's own rule rather than a number invented here — `displayField`
   * is what the screen uses, and paper must not disagree with the screen about the same
   * record.
   */
  const staleOnPaper = $derived(
    (['hours', 'intake_hours', 'phone'] as const).some(
      // `call-first` is the screen's own verdict for a field a reader must not trust, which
      // is exactly the thing paper has to carry.
      (f) => record[f] && displayField(record, f, now).kind === 'call-first'
    )
  );
</script>

<svelte:head>
  <title>{record.name} · NavCom</title>
  <meta
    name="description"
    content="{record.name} — hours, intake rules, and how recently anyone checked."
  />
</svelte:head>

<div class="wrap">
  <p class="back"><a href="/directory/">&larr; All resources</a></p>

  {#if meta.flagFirst}
    <!-- Rule 3. Above all other content, including the name. -->
    <div class="notice notice--stop" data-flag>
      <p class="notice__label">Flagged</p>
      <p>{meta.flagFirst.label}</p>
    </div>
  {/if}

  {#if meta.seeded}
    <div class="notice notice--warn">
      <p class="notice__label">Unverified public listing</p>
      <p>
        This entry came from a public source. Nobody has been there or called. The intake
        rules below are almost certainly incomplete — that is what is missing from official
        listings, and it is the part that decides whether someone gets in.
      </p>
    </div>
  {/if}

  <header class:seeded={meta.seeded} data-record={record.id} data-seeded={meta.seeded} data-flagged={meta.flagFirst !== null}>
    <h1>{record.name}</h1>
    <p class="type">{labelValue(record.type)}</p>
  </header>

  <!--
    Only on paper, and the reason this whole item is worth doing carefully.

    Every screen in this project shows how old its data is, because a confident wrong answer
    is the worst failure here. A printed page has no such signal — it looks equally
    authoritative the day it was printed and eighteen months later, and it cannot be
    corrected after it leaves somebody's hand.

    So the sheet carries its own age, its source, and the one instruction that survives being
    out of date.
  -->
  <div class="printed" aria-hidden="true" data-print-provenance>
    <p>
      <strong>navcom.app</strong> — this page was printed from a directory kept by
      volunteers.
    </p>
    <p>
      {#if record.last_verified}
        Last checked <strong>{record.last_verified}</strong>{#if record.verified_by}, by
        {record.verified_by}{/if}.
      {:else}
        <strong>Nobody has checked this.</strong> It came from a public listing.
      {/if}
      Hours and intake rules change without notice.
    </p>
    <!--
      The sheet's own date, which it did not carry.
      
      It carried the record's age and not its own, and this spec's opening line names exactly
      why that matters: a printed page looks equally authoritative the day it was printed and
      eighteen months later. A reader holding paper has no way to know which day it is
      relative to — unless the paper says. No JavaScript is involved and none could be: this
      site ships none, so the date is the build's, baked in at prerender.
    -->
    <p>
      Printed from a page published <strong>{publishedOn}</strong>. If that is long ago,
      treat everything here as out of date.
    </p>
    {#if staleOnPaper}
      <!--
        The verdict the screen computes, in words, on the one surface that cannot be
        corrected later. A stale record printed identically to a fresh one apart from a date
        the reader had to interpret for themselves.
      -->
      <p><strong>This check is old enough that it may no longer be true.</strong></p>
    {/if}
    <p><strong>Call before you go.</strong></p>
  </div>

  <section>
    <h2>Contact</h2>
    <dl>
      <FieldRow field="address" label={FIELD_LABELS.address ?? 'Address'} display={displayField(record, 'address', now)} />
      <FieldRow field="phone" label={FIELD_LABELS.phone ?? 'Phone'} display={displayField(record, 'phone', now)} />
    </dl>
    {#if record.lat !== undefined && record.lon !== undefined}
      <p class="map">
        <!-- geo: hands off to the native app on Android and does nothing elsewhere, so the
             universal link is primary and the coordinates stay visible to copy. -->
        <a
          href="https://www.openstreetmap.org/?mlat={record.lat}&mlon={record.lon}#map=17/{record.lat}/{record.lon}"
          rel="noreferrer"
        >Open in maps</a>
        <span class="coords mono">{record.lat}, {record.lon}</span>
      </p>
    {/if}
  </section>

  <section>
    <h2>Availability</h2>
    {#if data.region}
      <p class="hint">{localTimeNote(data.region)}</p>
    {/if}
    <dl>
      {#each AVAILABILITY_FIELDS as field (field)}
        <FieldRow {field} label={FIELD_LABELS[field] ?? field} display={displayField(record, field, now)} />
      {/each}
    </dl>
  </section>

  <section>
    <h2>Will they take this person</h2>
    <p class="hint">
      This is the part official listings leave out. Anything marked unknown means nobody has
      confirmed it — not that there is no restriction.
    </p>
    <dl>
      {#each INTAKE_FIELDS as field (field)}
        <FieldRow {field} label={FIELD_LABELS[field] ?? field} display={displayField(record, field, now)} />
      {/each}
    </dl>
  </section>

  {#if record.notes}
    <section>
      <h2>Notes</h2>
      <p class="notes">{record.notes}</p>
    </section>
  {/if}

  <section>
    <h2>Verification</h2>
    <dl class="verify">
      <div><dt>Last checked</dt><dd>{meta.age ? `${meta.age.absolute} (${meta.age.relative})` : 'never'}</dd></div>
      <div><dt>By</dt><dd>{record.verified_by ?? 'unknown'}</dd></div>
      <div><dt>How</dt><dd>{record.method ? labelValue(record.method) : 'unknown'}</dd></div>
    </dl>
    <p class="hint">
      Confidence is worked out from how it was checked and how long ago — it is never typed
      in by hand. Different facts go stale at different speeds: hours in two weeks, intake
      rules in three months, an address in a year.
    </p>
  </section>
</div>

<style>
  /*
   * Screen sees nothing of this; paper sees it first.
   *
   * `display: none` rather than a visually-hidden pattern, and `aria-hidden` on the element:
   * a screen reader announcing "printed from navcom.app, call before you go" to somebody
   * reading the page they are already on would be noise, and the same facts are already on
   * the screen with their ages attached.
   */
  .printed { display: none; }
  @media print {
    .printed {
      display: block;
      border: 2px solid #000;
      padding: 0.6rem 0.8rem;
      margin: 0 0 1rem;
    }
    .printed p { margin: 0.2rem 0; }
    .back, .map a { display: none; }
  }

  .back { font-size: 0.9rem; margin-bottom: 1rem; }
  .back a { color: var(--muted); }

  .notice { margin-bottom: 1rem; }

  header { margin: 0.5rem 0 2rem; }
  header.seeded h1 { font-weight: 400; }

  h1 { font-size: clamp(1.8rem, 5.5vw, 2.5rem); line-height: 1.12; letter-spacing: -0.02em; }
  .type { color: var(--muted); margin-top: 0.3rem; }

  section { margin-top: 2.25rem; }

  h2 {
    font-size: 0.95rem;
    font-family: var(--font-body);
    font-weight: 700;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--muted);
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--line-strong);
    margin-bottom: 0.5rem;
  }

  dl { margin: 0; }

  .hint { font-size: 0.9rem; color: var(--muted); margin: 0.6rem 0; max-width: var(--measure); }
  .notes { max-width: var(--measure); }
  .map { margin-top: 0.6rem; font-size: 0.95rem; display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: baseline; }
  .coords { font-size: 0.78rem; color: var(--muted); }

  .verify { display: flex; flex-direction: column; gap: 0.4rem; }
  .verify div { display: grid; grid-template-columns: 10.5rem 1fr; gap: 1rem; }
  .verify dt {
    font-size: 0.78rem; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase;
    color: var(--muted);
  }
  .verify dd { margin: 0; }

  @media (max-width: 32rem) {
    .verify div { grid-template-columns: 1fr; gap: 0; }
  }
</style>

  <!--
    The moment somebody knows a listing is wrong is the moment they are looking at it, and this
    page offered them nothing. The mechanism exists and is tested; what was missing was the ask.
  -->
  <section class="notice" data-correct-this>
    <p>
      <strong>Do you know this place?</strong> If any of this is wrong — especially who they
      take, or what happens to somebody with no ID — the fastest fix is the
      <a href="/terminal/directory/{data.region?.slug ?? ''}/">field terminal</a>: pick a
      callsign, find this listing, tap <strong>report a problem</strong>. No account, and it
      works with no signal.
    </p>
    <p class="quiet">
      Your correction is <strong>added</strong> under your callsign — it cannot delete this
      listing or overrule anybody, and nobody has to approve it.
    </p>
  </section>
