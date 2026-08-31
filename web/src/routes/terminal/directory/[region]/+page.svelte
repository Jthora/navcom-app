<script lang="ts">
  /**
   * The cached directory — the Dark fallback.
   *
   * **There is no search box, and that is deliberate.** `Query` goes to the watch: someone
   * with both hands free does the lookup, can ask a follow-up, and can be wrong out loud.
   * Searching a list one-handed in the cold is the problem the watch exists to solve, so
   * offering search here as a first-class action would quietly undo the design.
   *
   * The record rendering is the site's own components, unchanged. They are the only
   * implementation of the display rules that the built-artifact tests check, and the
   * directory is where a rule the output does not honour would do real harm.
   */
  import FieldRow from '$lib/components/FieldRow.svelte';
  import {
    displayField,
    displayRecord,
    RESOURCE_TYPES,
    type ResourceField,
    type ResourceRecord,
    type ResourceType
  } from '$lib/directory';
  import { AVAILABILITY_FIELDS, FIELD_LABELS, INTAKE_FIELDS, labelValue } from '$lib/directory/load';
  import { displayMerged, mergeCorrections, needsChecking, CORRECTABLE_FIELDS, FIELD_OPTIONS,
    isAddedPlace, isSeeded, withPlaces, PlaceError } from '@navcom/core';
  import { corrections } from '$lib/terminal/corrections.svelte';
  import { locateOnce, metresApart, type Fix } from '$lib/console/position-once';
  import { places } from '$lib/terminal/places.svelte';
  import { Slot, Readout, Why, Heartbeat } from '$lib/components/panel';
  import { clearNote, keepNote, notes } from '$lib/terminal/notes';
  import { onMount } from 'svelte';

  let { data } = $props();

  /**
   * Collapsed groups, not open ones — everything starts open.
   *
   * Two reasons, and they point the same way. In the field it is fewer taps for someone
   * working one-handed. In the build it means the records are actually IN the prerendered
   * HTML, where the display-rule regression tests can see them; a collapsed-by-default
   * accordion would have shipped this screen with the rules unchecked.
   */
  let collapsed = $state<Set<ResourceType>>(new Set());
  const isOpen = (t: ResourceType) => !collapsed.has(t);

  function toggle(t: ResourceType) {
    const next = new Set(collapsed);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    collapsed = next;
  }
  /**
   * Build time until the page hydrates, then the operator's real clock.
   *
   * A prerendered page necessarily freezes staleness into HTML — that is what the daily
   * rebuild and the staleness margin exist for. The terminal can do better the moment it is
   * actually running, and does: every verdict below recomputes against the real clock, so a
   * cached page opened three weeks later does not still claim three-week-old confidence.
   */
  let hydrated = $state(false);
  const now = $derived(hydrated ? new Date() : new Date(data.built));

  /** Which record's report control is open. One at a time — this is not a form. */
  let reporting = $state<string | null>(null);
  /** Which field is being corrected, once somebody has picked one. */
  let correcting = $state<ResourceField | null>(null);
  let typed = $state('');
  /**
   * Whether the value about to be sent is flagged as weakly backed despite the method used.
   * The case this exists for: staff confirmed *that the website is right* rather than
   * reading out the current value themselves — a phone call about a website, not a phone
   * call about the fact itself.
   */
  let bridgedFlag = $state(false);

  /** Scribbles, kept on this phone. Reloaded on mount because they are read from storage. */
  let jotted = $state<Record<string, string>>({});
  let jotting = $state<string | null>(null);
  let jotText = $state('');

  function jot(id: string) {
    keepNote(id, jotText);
    jotted = notes();
    jotting = null;
    jotText = '';
  }

  function dropNote(id: string) {
    clearNote(id);
    jotted = notes();
  }

  async function report(id: string, flag: string) {
    await corrections.submit(id, { flag });
    reporting = null;
  }

  async function fix(id: string, field: ResourceField, value: string) {
    if (!value.trim()) return;
    await corrections.submit(id, { [field]: value.trim() }, 'in_person', bridgedFlag);
    reporting = null;
    correcting = null;
    typed = '';
    bridgedFlag = false;
  }

  /**
   * Adding a place the published directory does not have.
   *
   * The one path that lets an operator in an empty region do anything at all. Closed by
   * default and one at a time, like every other control on this screen — it is an errand,
   * not a form somebody sits down to.
   */
  let adding = $state(false);
  let draft = $state({ name: '', type: 'shelter' as ResourceType, address: '', phone: '', hours: '' });
  /** How this operator knows. Refused for anything they only read — see `places.ts`. */
  let how = $state<'in_person' | 'staff_confirmed' | 'phone'>('in_person');
  /** The schema's own refusal, shown verbatim. Those messages are written for a person. */
  let addError = $state<string | null>(null);
  let addBusy = $state(false);

  async function addPlace() {
    if (addBusy) return;
    addBusy = true;
    addError = null;
    try {
      await places.add(data.region.slug, { ...draft }, how);
      draft = { name: '', type: 'shelter', address: '', phone: '', hours: '' };
      adding = false;
    } catch (e) {
      addError = e instanceof PlaceError ? e.message : 'That could not be saved.';
    } finally {
      addBusy = false;
    }
  }

  /** Options for the field being corrected, or null where it is free text. */
  const options = $derived(correcting ? (FIELD_OPTIONS[correcting] ?? null) : null);

  onMount(() => {
    hydrated = true;

    // Scoped to the area actually carried. Asking a relay for every correction on the
    // network would pull places this operator will never go, on a phone counting bytes.
    jotted = notes();
    corrections.start(data.records.map((r: ResourceRecord) => r.id));
    // By region, not by record id: an area that ships empty has no ids to ask for, which
    // is the entire reason a place is a separate kind.
    places.start(data.region.slug);

    // Ask to be saved for offline.
    //
    // Opening an area is what saves it -- but arriving here by tapping a link is a
    // client-side navigation, which fetches this page's DATA and never its HTML. Without
    // this the document was never cached, and an operator who browsed to their area and
    // then lost signal found nothing. Reloading by hand cached it; nobody reloads by hand.
    //
    // **Waits for a worker rather than asking whichever one happens to exist.** On a first
    // visit `controller` is null -- the worker is still installing -- so the optional call
    // that used to be here silently did nothing, and an operator whose very first action was
    // opening their area got it uncached. The same failure as the client-navigation one
    // above, one layer down, and invisible for the same reason: nothing errored.
    void navigator.serviceWorker?.ready
      .then((registration) => {
        const worker = navigator.serviceWorker.controller ?? registration.active;
        worker?.postMessage({ cache: location.pathname });
      })
      .catch(() => undefined);

    // Last, and it must stay last: everything above runs on mount, and an early `return`
    // here silently makes the rest of this function dead code. That is exactly what
    // happened when corrections were added -- the caching call sat below a return for an
    // afternoon, nothing errored, and the area simply stopped being saved.
    return () => {
      corrections.stop();
      places.stop();
    };
  });

  /**
   * What shipped, plus what operators added.
   *
   * `withPlaces` never lets an added row shadow a published one — if a place later ships in
   * the curated directory under the same derived id, the curated row is the one a person
   * stood behind.
   */
  const shown = $derived(withPlaces(data.records as ResourceRecord[], places.all));

  /** The ways of knowing that count as a person having checked, everywhere in this system. */
  const HUMAN_METHODS = new Set(['in_person', 'staff_confirmed', 'phone']);

  /**
   * Whether *anything* in this region has ever been confirmed by a person.
   *
   * Answers the question the Academy asked directly in the EIN round: field-level provenance
   * already exists — a value shows "Wren, phone" beneath it — but nothing said, at the level of
   * the region, that a reader is looking at zero confirmed places among however many are listed.
   * Field-level honesty, region-level silence, and the silence was the gap.
   *
   * A record counts as confirmed if any of three things is true: it is an operator-added place
   * (which can only exist via in_person, staff_confirmed or phone — see places.ts), or its own
   * base method is one of those, or a correction actually written by a person changed one of its
   * fields. The third case is why this merges corrections rather than reading `record.method`
   * alone — a scraped record with one in-person correction on `hours` has been touched by a
   * person, even though the record's own base method never changes to reflect that.
   */
  const anyConfirmed = $derived(
    shown.some((record) => {
      if (isAddedPlace(record) || !isSeeded(record)) return true;
      const merged = mergeCorrections(record, corrections.about(record.id), now);
      return Object.values(merged.sources).some(
        (source) => source?.correction && HUMAN_METHODS.has(source.correction.method)
      );
    })
  );

  /**
   * Nearest first — asked for, never assumed.
   *
   * "Which of these is closest" is a real question at a door at 11pm, and it is one of the
   * few useful things this screen can answer **without waiting on 6.9**: an address is enough
   * to order by, so it works on the scraped skeletons whose intake rules nobody has filled in
   * yet.
   *
   * Deliberately a control rather than a default. Sorting on arrival would fire a permission
   * prompt nobody asked for and reorder a list somebody may have learned; both are things
   * that happen *to* an operator rather than things they do.
   *
   * The fix is coarsened to ~500m before it is held and is **never sent anywhere** — no
   * relay, no watch, no peer. It is discarded when this screen closes.
   */
  let here = $state<Fix | null>(null);
  let locating = $state(false);
  let located = $state<'idle' | 'ok' | 'refused'>('idle');

  async function sortByDistance() {
    if (here) {
      // A second tap puts it back. The list an operator learned is theirs to get back.
      here = null;
      located = 'idle';
      return;
    }
    locating = true;
    const got = await locateOnce();
    locating = false;
    here = got;
    /*
     * Reported rather than silently ignored, unlike the console's ambient use of the same
     * helper. There it is a guess nobody asked for and silence is correct; here the operator
     * tapped a button, and a button that does nothing without saying why is the worst of both.
     */
    located = got ? 'ok' : 'refused';
  }

  /** Records with no coordinates keep their place at the end rather than being hidden. */
  function nearestFirst(list: ResourceRecord[]): ResourceRecord[] {
    if (!here) return list;
    const at = (r: ResourceRecord) =>
      typeof r.lat === 'number' && typeof r.lon === 'number'
        ? metresApart(here as Fix, { lat: r.lat, lon: r.lon })
        : Number.POSITIVE_INFINITY;
    return [...list].sort((a, b) => at(a) - at(b));
  }

  /** How many in this region could not be placed, so the ordering does not overclaim. */
  const unplaceable = $derived(
    shown.filter((r: ResourceRecord) => typeof r.lat !== 'number' || typeof r.lon !== 'number').length
  );

  const byType = $derived(
    RESOURCE_TYPES.map((type) => ({
      type,
      records: nearestFirst(shown.filter((r: ResourceRecord) => r.type === type))
    })).filter((g) => g.records.length > 0)
  );

  /** How old the whole copy is — the age nothing on a record would ever mention. */
  const snapshotDays = $derived(
    Math.floor((now.getTime() - Date.parse(data.built)) / 86_400_000)
  );
</script>

<svelte:head>
  <title>{data.region.name} · Field Terminal</title>
  <meta name="description" content="What this device holds when there is no watch." />
</svelte:head>

<header>
  <p class="eyebrow"><a href="/terminal/directory/">← All areas</a></p>
  <h1>{data.region.name}</h1>
</header>

{#if corrections.unsentCount > 0}
  <!--
    Held on this device and not yet anywhere else. Said because the correction appears in
    this operator's own directory either way, so without this they have positive evidence it
    worked — which is worse than a silent failure.
  -->
  <Slot k="Corrections">
    <Heartbeat
      label={corrections.unsentCount === 1 ? 'One not sent' : `${corrections.unsentCount} not sent`}
    />
  </Slot>
  <p class="cost" data-corrections-unsent>
    {corrections.unsentCount === 1
      ? 'One correction you made has not reached a relay yet'
      : `${corrections.unsentCount} corrections you made have not reached a relay yet`} —
    you can see them, nobody else can. They go out on their own the next time this opens with
    signal.
  </p>
{/if}

{#if corrections.partial}
  <!--
    A correction is the one thing a stranger can write into this device. Bounded, and said
    plainly — a directory holding a fraction of what was published looks exactly like a
    directory nobody has corrected.
  -->
  <p class="cost" data-corrections-partial>
    More corrections are being published for this area than this phone will hold, so some are
    not shown. What is here is still what you were carrying before they started arriving.
  </p>
{/if}

<section>
  <p>
    This is what this phone is holding, and it works with no signal at all.
  </p>
  <Why summary="When to ask a person instead">
    <p class="cost">
      If a watch is up, <strong><a href="/terminal/query/">ask it instead</a></strong> — somebody
      with both hands free and a real screen can answer things this list cannot. This is what
      you have when nobody is watching, and it is worse, on purpose.
    </p>
  </Why>
  <p class="cost">
    <!--
      Tenth time this session a claim landed behind a conditional the prerendered page cannot
      reach — here, behind the report control itself. The rule holds again, and for the usual
      reason: what a report can and cannot do is read before somebody makes one, not after.
    -->
    <strong>You can report a problem with any listing below.</strong> It goes out under your
    callsign, or anonymously if you have not picked one, and <strong>adds</strong> what you
    saw — it cannot delete this listing or overrule anybody, and nobody has to approve it.
    Reporting is meant to be easier than fixing.
  </p>
</section>

<!-- A cached copy has two ages, and only one of them is written on the records. -->
<section class="snapshot" class:old={snapshotDays > 7} data-snapshot-age={snapshotDays}>
  <h2>This copy</h2>
  <!--
    A cached copy has two ages and only one of them is written on the records. This is the
    other one, and it is exactly the shape of fact the display rules already govern: volatile
    data shows its age, and past the point where the age can be trusted it reads "call first"
    rather than a number somebody might rely on.
  -->
  <Slot k="Refreshed">
    {#if snapshotDays <= 0}
      <Readout value="Today" tone="good" />
    {:else if snapshotDays === 1}
      <Readout value="Yesterday" tone="good" />
    {:else if snapshotDays > 7}
      <Readout value="Call first" tone="warn" sub="{snapshotDays} days ago — on everything" />
    {:else}
      <Readout value="{snapshotDays} days ago" tone="neutral" />
    {/if}
  </Slot>
  {#if snapshotDays > 7}
    <!-- Stays visible: it changes what the reader must do with everything below it. -->
    <p class="cost">
      Places close and hours change inside a week. <strong>Call first, on everything.</strong>
    </p>
  {/if}
</section>

{#if shown.length === 0}
  <!-- Rule 6. Silence is a positive readout, not an empty screen. -->
  <section>
    <Slot k="Held">
      <Readout value="Nothing yet" tone="cold" sub="nobody has put this area in" />
    </Slot>
  </section>
{/if}

{#if shown.length > 0 && !anyConfirmed}
  <!--
    The region-level counterpart to the per-field "said-by" line. A reader scrolling this
    screen sees provenance on every value that has any — and nothing, anywhere on the page,
    told them that not one of these has any. This is that missing sentence.
  -->
  <section>
    <Slot k="Provenance">
      <Readout
        value="Unconfirmed"
        tone="warn"
        sub="none of what's below has been checked by a person — every field here came from a website"
      />
    </Slot>
  </section>
{/if}


<!--
  Ordering, offered rather than applied. See `sortByDistance` for why this is a tap and not a
  default. The type grouping is left alone — it is how somebody navigates this list at a door,
  and sorting *within* each group answers "which of these" without dismantling "which kind".
-->
<section class="ordering">
  <button data-nearest onclick={sortByDistance} disabled={locating}>
    {#if locating}Finding you…{:else if here}Back to listed order{:else}Nearest first{/if}
  </button>
  {#if located === 'refused'}
    <p class="cost" data-nearest-refused>
      This phone did not give a location, so the order is unchanged. Nothing was sent
      anywhere, and nothing about this screen depends on it.
    </p>
  {:else if here}
    <p class="cost" data-nearest-on>
      Nearest first, worked out on this phone and <strong>sent nowhere</strong>. Rounded to
      about 500m, so anything closer together than that is in no meaningful order.
      {#if unplaceable > 0}
        {unplaceable} of these carry no coordinates and stay at the end of their group.
      {/if}
    </p>
  {/if}
</section>

{#each byType as group (group.type)}
  <section class="group">
    <button
      class="head"
      aria-expanded={isOpen(group.type)}
      onclick={() => toggle(group.type)}
    >
      <span>{labelValue(group.type)}</span>
      <span class="chev" aria-hidden="true">{isOpen(group.type) ? '−' : '+'}</span>
    </button>

    {#if isOpen(group.type)}
      <div class="records">
        {#each group.records as published (published.id)}
          <!--
            Live corrections merged over the published record before anything is displayed.
            The rules that weigh them are the directory's own -- an in-person check from last
            night beats a website scrape from March because confidence already said so.
          -->
          {@const merged = mergeCorrections(published, corrections.about(published.id), now)}
          {@const asks = needsChecking(published, corrections.about(published.id), now)}
          {@const record = merged.record}
          {@const meta = displayRecord(record, now)}
          <article
            class="rec"
            class:seeded={meta.seeded}
            data-record={record.id}
            data-seeded={meta.seeded}
            data-flagged={meta.flagFirst !== null}
          >
            <!-- Rule 3. The flag is read before the name, not beside it. -->
            {#if meta.flagFirst}
              <p class="flag" data-flag>{meta.flagFirst.label}</p>
            {/if}
            <!-- Rule 6. Seeded entries say so in words, not with a subtle border. -->
            {#if meta.seeded}
              <p class="seeded-note" data-seeded-note>
                Unverified public listing — nobody has checked this
              </p>
            {/if}

            <h3>{record.name}</h3>

            <!--
              Rule 3, and the reason this kind exists at all. An added place has never been
              through a maintainer, so the row says so on its face rather than looking like a
              curated one — the record-level version of the same honesty every field already
              carries. Who added it and how is right underneath, as provenance always is.
            -->
            {#if isAddedPlace(record)}
              <p class="added" data-added={record.id}>
                <strong>Added by an operator.</strong> Not in the published directory —
                {record.verified_by ?? 'anonymous'},
                {(record.method ?? '').replace(/_/g, ' ')}, {record.last_verified}.
              </p>
            {/if}

            <!--
              Rule 3 applied to reports, which are NOT properties of the record: a hostile
              flag must not make a shelter unusable for everybody. Attributed and dated, so a
              reader weighs them like any other attestation.
            -->
            {#each merged.reports as r (r.by)}
              <p class="report" data-report>
                <strong>{r.verified_by}</strong> reported this
                {labelValue(r.fields.flag ?? '')} on {r.last_verified}.
                The listing below is unchanged.
              </p>
            {/each}

            <dl>
              {#each ['address', 'phone', ...AVAILABILITY_FIELDS, ...INTAKE_FIELDS] as ResourceField[] as field (field)}
                {@const shown = displayMerged(merged, field, now)}
                <FieldRow {field} label={FIELD_LABELS[field] ?? field} display={shown.display} />
                {#if shown.by}
                  <!--
                    7.6. Standing lives in the artifacts rather than in a profile: your
                    callsign is on records people rely on. Provenance by name, never a total,
                    and there is nothing here to compare between two operators.
                  -->
                  <p class="said-by" data-said-by={field}>
                    {shown.by.verified_by}, {shown.by.method.replace(/_/g, ' ')}
                    {#if shown.by.bridged?.includes(field)}
                      <!--
                        The caveat a correction can carry about itself. Never changes the
                        confidence this field earned from its method and date -- surfaced
                        alongside it, for a reader to weigh, not a silent downgrade.
                      -->
                      <span class="bridged" data-bridged-caveat={field}>— flagged as uncertain</span>
                    {/if}
                  </p>
                {/if}
              {/each}
            </dl>

            <!--
              6.5, and the reason it is on the record rather than in a list of its own. An
              errand is something you do while you are already there; a task list is
              something you open on purpose, which nobody does.
            -->
            {#if asks.length > 0}
              <p class="asks" data-asks>
                <strong>Nobody knows</strong>
                {asks.map((f) => (FIELD_LABELS[f] ?? f).toLowerCase()).join(', ')}.
                If you are there, ask.
              </p>
            {/if}

            {#if merged.reports.length > 0 || Object.keys(merged.sources).length > 0}
              <p class="corrected" data-corrected>
                Carries {Object.keys(merged.sources).length > 0 ? 'corrections' : 'a report'}
                from operators. Nothing was removed — the published listing is still underneath.
              </p>
            {/if}

            <!--
              6.2. Reporting must always be easier than fixing, and until now it was
              impossible while fixing needed a pull request. One tap, no form, no account.
            -->
            <!--
              6.6. Capture cold, correct warm. Shown above the report control because in the
              moment it matters this is the only thing that can be done one-handed.
            -->
            {#if jotted[record.id]}
              <p class="note" data-note>
                <strong>Your note:</strong> {jotted[record.id]}
                <button class="drop" onclick={() => dropNote(record.id)}>Done with it</button>
              </p>
            {/if}

            {#if jotting === record.id}
              <input class="fix" bind:value={jotText} autocomplete="off"
                placeholder="shut intake 20:30" />
              <p class="cost">
                Stays on this phone. Nobody else ever sees it, and a panic wipe takes it —
                so <strong>turn it into a correction</strong> when you are somewhere warm.
                Write about the place, never the person.
              </p>
              <div class="row">
                <button class="drop" onclick={() => jot(record.id)}>Keep</button>
                <button class="drop" onclick={() => (jotting = null)}>Cancel</button>
              </div>
            {:else if reporting !== record.id}
              <button class="drop" onclick={() => { jotting = record.id; jotText = jotted[record.id] ?? ''; }}>
                Note for later
              </button>
            {/if}

            {#if reporting === record.id && correcting}
              <!--
                Most of what an operator learns at a door is an enum, so most corrections are
                a tap. That is the difference between one made standing outside in the cold
                and one meant for later that never happens.
              -->
              <p class="cost">{FIELD_LABELS[correcting] ?? correcting}</p>
              {#if options}
                <div class="row">
                  {#each options as opt (opt)}
                    <button class="drop" onclick={() => fix(record.id, correcting!, opt)}>
                      {labelValue(opt)}
                    </button>
                  {/each}
                </div>
              {:else}
                <input class="fix" bind:value={typed} autocomplete="off"
                  placeholder={String(record[correcting] ?? '')} />
                <p class="cost">
                  <strong>Write about the place, not the person.</strong> What the door does —
                  never who was at it, or why.
                </p>
                <!--
                  Ratified network-wide (R4) after Starcom Academy's own credential format used
                  the same pattern for its modules: a claim can name its own weak backing rather
                  than a consumer having to guess. This is that, for one field of one correction
                  -- "they confirmed the website" is not the same claim as "they read me the
                  current hours", and this is how the difference survives into what gets sent.

                  Offered here and not on the enum-tap path above: most of what an operator
                  learns at a door is a clean yes/no/enum, and the checkbox would slow the
                  fast, common case for a caveat that rarely applies to it. Free text is where
                  somebody is already typing something specific, which is exactly where "and
                  I'm not fully sure" is worth one more tap.
                -->
                <label class="bridged-toggle">
                  <input type="checkbox" bind:checked={bridgedFlag} data-bridged-toggle />
                  Not fully sure about this
                </label>
                <div class="row">
                  <button class="drop" onclick={() => fix(record.id, correcting!, typed)}>Send</button>
                </div>
              {/if}
              <button class="drop" onclick={() => { correcting = null; typed = ''; bridgedFlag = false; }}>Back</button>
            {:else if reporting === record.id}
              <div class="row">
                <button class="drop" onclick={() => report(record.id, 'reported_closed')}>Closed</button>
                <button class="drop" onclick={() => report(record.id, 'reported_wrong')}>Wrong</button>
              </div>
              <p class="cost">Or say what changed:</p>
              <div class="row">
                {#each CORRECTABLE_FIELDS as field (field)}
                  <button class="drop" onclick={() => { correcting = field; typed = ''; }}>
                    {FIELD_LABELS[field] ?? field}
                  </button>
                {/each}
              </div>
              <p class="cost">Goes out under your callsign, or anonymously if you have not picked one.</p>
              <button class="drop" onclick={() => (reporting = null)}>Cancel</button>
            {:else}
              <button class="drop" data-report onclick={() => { reporting = record.id; correcting = null; }}>
                Report a problem
              </button>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </section>
{/each}

<!--
  The only thing an operator in an empty area can do, so it is on the screen whether or not
  there is anything above it.

  It is not a banner and it is not a prompt. It sits at the bottom, closed, and says what it
  costs — the same treatment every other contribution control on this screen gets.
-->
<section class="add">
  {#if !adding}
    <button class="drop" data-add-place onclick={() => { adding = true; addError = null; }}>
      Add a place that isn't here
    </button>
    <p class="cost">
      Somewhere you have been, or phoned. Not somewhere you read about — that goes to the
      maintainers, because a place nobody checked can send somebody to a locked door.
    </p>
  {:else}
    <h2>A place that isn't here</h2>

    <label for="pl-name">What is it called</label>
    <input id="pl-name" bind:value={draft.name} autocomplete="off" enterkeyhint="next" />

    <label for="pl-addr">Where is it</label>
    <input
      id="pl-addr"
      bind:value={draft.address}
      autocomplete="off"
      enterkeyhint="next"
      placeholder="enough to walk to"
    />

    <label for="pl-type">What is it</label>
    <select id="pl-type" bind:value={draft.type}>
      {#each RESOURCE_TYPES as t (t)}
        <option value={t}>{labelValue(t)}</option>
      {/each}
    </select>

    <label for="pl-how">How do you know</label>
    <select id="pl-how" bind:value={how}>
      <option value="in_person">I went there</option>
      <option value="staff_confirmed">Staff told me</option>
      <option value="phone">I phoned them</option>
    </select>

    <label for="pl-phone">Phone, if you have it</label>
    <input id="pl-phone" bind:value={draft.phone} autocomplete="off" inputmode="tel" />

    <label for="pl-hours">Hours, if you saw them</label>
    <input id="pl-hours" bind:value={draft.hours} autocomplete="off" />

    <!--
      Rule 5, at the point it matters most. The fields that decide whether somebody gets a
      bed are deliberately not on this form: nobody can read them off a doorway, and asking
      for them here would collect a guess with an operator's name attached.
    -->
    <p class="limit">
      Nothing about pets, ID, sobriety, curfew or intake hours. Those come from asking, and
      they stay <strong>unknown</strong> until somebody does.
    </p>

    {#if addError}
      <p class="err" data-add-error>{addError}</p>
    {/if}

    <button class="drop" data-add-save disabled={addBusy} onclick={addPlace}>
      {addBusy ? 'Saving…' : 'Add it'}
    </button>
    <button class="drop" onclick={() => { adding = false; addError = null; }}>Back</button>
  {/if}
</section>

<Why summary="Why there is no search here">
  <p>
    <strong>Query goes to the watch.</strong> Someone with both hands free does the lookup,
    can ask a follow-up, and can be wrong out loud. Searching a list one-handed in the cold
    is the problem the watch exists to solve — so this stays something to browse when there
    is nobody to ask, and not a substitute for asking.
  </p>
</Why>

<style>
  .snapshot { border-inline-start: 3px solid var(--t-line-strong); padding-inline-start: .9rem; }
  .snapshot.old { border-inline-start-color: var(--t-oncall); }
  .snapshot.old strong { color: var(--t-oncall); }

  .group { border-top: 1px solid var(--t-line); }
  .head {
    width: 100%; justify-content: space-between; border: 0; background: transparent;
    padding: 0; min-height: 3.5rem; font-size: 1.05rem; color: var(--t-ink);
  }
  .chev { color: var(--t-faint); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

  .records { display: flex; flex-direction: column; gap: 1.1rem; padding-bottom: 1.1rem; }
  .rec { border: 1px solid var(--t-line-strong); padding: .9rem 1rem; }
  .rec.seeded { border-style: dashed; }
  .rec h3 { font-size: 1.15rem; margin: 0 0 .4rem; color: var(--t-ink); }
  dl { margin: 0; }

  .report {
    margin: 0 0 .5rem; color: var(--t-oncall); font-size: .9rem;
    border-inline-start: 2px solid var(--t-oncall); padding-inline-start: .6rem;
  }
  .said-by {
    margin: -.2rem 0 .4rem; color: var(--t-station); font-size: .78rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .bridged {
    color: var(--t-oncall); font-style: italic;
  }
  .bridged-toggle {
    display: flex; align-items: center; gap: .5rem; margin: .5rem 0;
    font-size: .85rem; color: var(--t-dim);
  }
  .note {
    margin: .4rem 0 0; color: var(--t-ink); font-size: .9rem;
    border-inline-start: 2px solid var(--t-station); padding-inline-start: .6rem;
  }
  .asks {
    margin: .4rem 0 0; color: var(--t-muted); font-size: .88rem;
    border-inline-start: 2px solid var(--t-line-strong); padding-inline-start: .6rem;
  }
  .fix { width: 100%; margin-top: .4rem; }
  .corrected { margin: .4rem 0 0; color: var(--t-faint); font-size: .82rem; }
  .row { display: flex; gap: .5rem; flex-wrap: wrap; margin-top: .5rem; }
  .drop { min-height: 2.4rem; font-size: .85rem; padding: 0 .8rem;
          border-color: var(--t-line); color: var(--t-faint); margin-top: .5rem; }
  .flag {
    color: var(--t-dark); border: 1px solid var(--t-dark);
    padding: .4rem .6rem; margin: 0 0 .5rem; font-weight: 700; font-size: .92rem;
  }
  .seeded-note {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .68rem; letter-spacing: .09em; text-transform: uppercase;
    color: var(--t-faint); margin: 0 0 .4rem;
  }

  .limit { border-inline-start: 3px solid var(--t-line-strong); padding-inline-start: .9rem; }

  /*
    The add path. Deliberately the same weight as the correction controls above it rather
    than a call to action -- CLAUDE.md bans nudges, and this has to read as one more thing an
    operator can do, not as the thing the screen wants from them.
  */
  .add { border-block-start: 1px solid var(--t-line); padding-block-start: 1.1rem; }
  .add h2 { font-size: 1rem; margin: 0 0 .8rem; }
  .add label {
    display: block; font-size: .8rem; color: var(--t-faint);
    margin: .8rem 0 .25rem;
  }
  .add input, .add select {
    inline-size: 100%; min-height: 3rem; font: inherit; font-size: 1rem;
    color: var(--t-ink); background: var(--t-sunk);
    border: 1px solid var(--t-line-strong); padding: 0 .7rem;
  }
  .add .drop { margin-block-start: 1rem; }
  .add .err {
    border-inline-start: 3px solid var(--t-alarm); padding-inline-start: .7rem;
    color: var(--t-ink); font-size: .9rem;
  }

  /* Loud enough to be read before the fields under it, quiet enough not to be an alarm. */
  .added {
    border-inline-start: 2px solid var(--t-oncall); padding-inline-start: .6rem;
    font-size: .85rem; color: var(--t-dim); margin: .1rem 0 .6rem;
  }
</style>
