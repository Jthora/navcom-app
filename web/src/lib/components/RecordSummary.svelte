<script lang="ts">
  import { displayField, displayRecord, type ResourceRecord } from '$lib/directory';
  import { labelValue, labelValues } from '@navcom/core';

  let { record, now }: { record: ResourceRecord; now: Date } = $props();

  const meta = $derived(displayRecord(record, now));
  const hours = $derived(displayField(record, 'hours', now));
  const accepts = $derived(displayField(record, 'accepts', now));
  const pets = $derived(displayField(record, 'pets', now));
  const sobriety = $derived(displayField(record, 'sobriety', now));
</script>

<!-- Rule 6. Seeded entries are visibly different, not merely tagged: dotted edge,
     lighter title, and an explicit line saying nobody has checked this. -->
<article class="card" class:seeded={meta.seeded} class:suspect={meta.flagFirst !== null}
  data-record={record.id} data-seeded={meta.seeded} data-flagged={meta.flagFirst !== null}>
  {#if meta.flagFirst}
    <!-- Rule 3. The flag comes first, above all other content. -->
    <p class="flag" data-flag>{meta.flagFirst.label}</p>
  {/if}

  {#if meta.seeded}
    <p class="seeded-note" data-seeded-note>Unverified public listing — nobody has checked this</p>
  {/if}

  <h3><a href="/directory/{record.id}/">{record.name}</a></h3>
  <p class="type">{labelValue(record.type)}</p>

  <dl>
    <div><dt>Open</dt><dd>
      {#if hours.kind === 'value'}<span data-display="value" data-field="hours">{labelValues(hours.values)}</span>
      {:else if hours.kind === 'call-first'}<span class="cf" data-display="call-first" data-field="hours">Call first</span>
      {:else}<span class="unk">unknown</span>{/if}
    </dd></div>
    <div><dt>Takes</dt><dd>
      {#if accepts.kind === 'value'}{labelValues(accepts.values)}
      {:else}<span class="unk">unknown</span>{/if}
    </dd></div>
    <div><dt>Pets</dt><dd>
      {#if pets.kind === 'value'}{labelValues(pets.values)}
      {:else}<span class="unk">unknown</span>{/if}
    </dd></div>
    <div><dt>Using</dt><dd>
      {#if sobriety.kind === 'value'}{labelValues(sobriety.values)}
      {:else}<span class="unk">unknown</span>{/if}
    </dd></div>
  </dl>

  <p class="foot">
    {#if meta.age}checked {meta.age.absolute}{:else}never checked{/if}
    {#if record.verified_by}<span class="by">by {record.verified_by}</span>{/if}
  </p>
</article>

<style>
  .card {
    background: var(--surface);
    border: 1px solid var(--line-strong);
    padding: 1rem 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .seeded {
    border-style: dashed;
    background: transparent;
  }
  .seeded h3 a { font-weight: 400; }

  .suspect { border-color: var(--stop); }

  .flag {
    font-weight: 700;
    color: var(--stop);
    background: var(--stop-soft);
    border: 1px solid var(--stop);
    padding: 0.4rem 0.6rem;
    font-size: 0.92rem;
  }

  .seeded-note {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--muted);
  }

  h3 { font-size: 1.3rem; line-height: 1.25; }
  h3 a { color: var(--ink); text-decoration-color: var(--line-strong); }

  .type { font-size: 0.9rem; color: var(--muted); }

  dl { margin: 0.2rem 0 0; display: flex; flex-direction: column; gap: 0.3rem; }
  dl div { display: grid; grid-template-columns: 5rem 1fr; gap: 0.75rem; font-size: 0.95rem; }
  dt {
    font-size: 0.72rem; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase;
    color: var(--muted); padding-top: 0.2rem;
  }
  dd { margin: 0; }

  .cf { font-weight: 700; color: var(--stop); }
  .unk { color: var(--faint); font-style: italic; }

  .foot {
    font-family: var(--font-mono);
    font-size: 0.74rem;
    color: var(--muted);
    border-top: 1px solid var(--line);
    padding-top: 0.5rem;
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
  }

  @media (max-width: 32rem) {
    dl div { grid-template-columns: 4.5rem 1fr; gap: 0.5rem; }
  }
</style>
