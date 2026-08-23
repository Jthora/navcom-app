<script lang="ts">
  /**
   * The reason, one layer down.
   *
   * **Rule 3, and it is the rule that makes the rest of the doctrine safe.** This system's
   * central failure is a confident wrong answer, and every caveat in it was written as a
   * careful sentence for that reason. `CALL FIRST` without its reason is just a shorter way to
   * be unhelpful; `DARK` without "it still works offline" reads as the app being broken.
   *
   * So terseness does not delete the prose — it relocates it. This component takes the
   * existing wording **verbatim** and changes none of it. If `Why` is ever cut for space, the
   * doctrine has become the thing it was built to prevent.
   *
   * A `<details>` rather than anything custom: it is keyboard-operable, screen-reader
   * announced, and its content is in the DOM whether or not it is open — which means the
   * facts stay findable, and the tests that assert on them keep working.
   */
  import type { Snippet } from 'svelte';

  let {
    summary = 'Why',
    children
  }: { summary?: string; children: Snippet } = $props();
</script>

<details class="nc-why" data-why>
  <summary>{summary}</summary>
  <div class="nc-why-body">{@render children()}</div>
</details>
