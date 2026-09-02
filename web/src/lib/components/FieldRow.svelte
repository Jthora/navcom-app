<script lang="ts">
  import type { FieldDisplay } from '$lib/directory';
  import { labelValues } from '@navcom/core';

  let {
    label,
    field,
    display
  }: { label: string; field: string; display: FieldDisplay } = $props();
</script>

<!--
  The data-* attributes are not decoration: scripts/../rendered.test.ts asserts the display
  rules against the built HTML using them. Removing them removes the regression guard.
-->
<div class="row">
  <dt>{label}</dt>
  <dd data-display={display.kind} data-field={field} data-class={display.cls ?? 'none'}>
    {#if display.kind === 'unknown'}
      <!-- Rule 5. Blank is unknown, never absence of a restriction. -->
      <span class="unknown">unknown</span>
    {:else if display.kind === 'call-first'}
      <!--
        Rules 2 and 7. The old value is structurally absent here — it cannot be rendered.

        The reason has to be right, not merely present. "Last check is too old" for a
        weather-activated centre verified this morning is a plain lie, and it points the
        reader at a fix that would not help: re-verifying it changes nothing, because the
        door is locked tonight for a reason that has nothing to do with when anybody looked.
      -->
      <span class="call-first">Call first</span>
      <span class="why">
        {display.because === 'weather-activated'
          ? 'only opens when the city activates it'
          : display.because === 'out-of-season'
            ? 'out of season — these are last season\'s hours'
            : display.confidence === 'suspect'
              ? 'this entry is flagged'
              : 'last check is too old to rely on'}
      </span>
    {:else}
      <span class="value">{labelValues(display.values)}</span>
      {#if display.age}
        <!-- Rule 1. A volatile value is never shown without its age. The absolute date is
             primary because it stays true no matter when the page is read. -->
        <time class="age" data-age datetime={display.age.iso}>
          checked {display.age.absolute}
        </time>
      {/if}
    {/if}
  </dd>
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: 10.5rem 1fr;
    gap: 0.25rem 1rem;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--line);
  }
  .row:last-child { border-bottom: none; }

  dt {
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--muted);
    padding-top: 0.15rem;
  }

  dd { margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.2rem 0.55rem; }

  .value { font-weight: 500; }

  .unknown { color: var(--faint); font-style: italic; }

  .call-first {
    font-weight: 700;
    color: var(--stop);
    border-bottom: 2px solid var(--stop);
  }

  .why { font-size: 0.85rem; color: var(--muted); }

  .age {
    font-family: var(--font-mono);
    font-size: 0.76rem;
    color: var(--muted);
    white-space: nowrap;
  }

  @media (max-width: 32rem) {
    .row { grid-template-columns: 1fr; gap: 0.1rem; }
  }
</style>
