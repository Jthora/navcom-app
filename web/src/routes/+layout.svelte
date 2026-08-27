<script lang="ts">
  /**
   * The root holds nothing but the outlet.
   *
   * Three genuinely different surfaces live under it — a public document in `(site)`, the
   * root console at `/`, and the Field Terminal, an application for the opposite situation.
   * Chrome belongs to whichever one you are in, so none of them inherits another's header,
   * stylesheet or assumptions.
   */
  let { children } = $props();
</script>

{@render children()}
