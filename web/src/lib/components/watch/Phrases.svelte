<script lang="ts">
  /**
   * Tonight's phrases under an answer box: one tap puts one in, and the holder still presses Send
   * [phrases.ts]. Nothing here sends anything.
   */
  let {
    list,
    onpick,
    keyOf
  }: {
    list: string[];
    onpick: (phrase: string) => void;
    /** The key that puts phrase i in, for its tooltip, where it has one [watch-keys.ts]. */
    keyOf?: (i: number) => string | undefined;
  } = $props();
</script>

{#if list.length > 0}
  <div class="phrases" data-phrases>
    {#each list as p, i (p)}
      <button class="phrase" onclick={() => onpick(p)} title={keyOf?.(i)} aria-keyshortcuts={keyOf && i < 9 ? `Alt+${i + 1}` : undefined}>{p}</button>
    {/each}
  </div>
{/if}

<style>
  .phrases { display: flex; flex-wrap: wrap; gap: .35rem; margin-block: .4rem; }
  .phrase { min-height: 2.4rem; max-width: 100%; overflow-wrap: anywhere; font-size: .8rem; padding: .3rem .7rem; text-align: start; border-color: var(--t-line); color: var(--t-muted); }
</style>
