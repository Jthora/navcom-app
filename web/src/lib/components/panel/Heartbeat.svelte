<script lang="ts">
  /**
   * One language for *unresolved, and still trying*.
   *
   * This application retries in at least five places and explains each retry in its own
   * paragraph: a stand-down that has not reached a relay, a watch publishing nothing, an answer
   * that did not send, a correction still queued, a withdrawal held locally. Five walls of text
   * for one condition.
   *
   * The pulse **stops dead** when it settles, which is the correct emphasis: stillness is the
   * success signal and you look at what is moving. It also makes the difference a static label
   * cannot carry — *still trying* versus *gave up* — which is the difference between staying on
   * signal and going back inside.
   *
   * Amber only. Retrying is not an emergency and the alarm channel stays sealed.
   */
  let {
    label,
    settled = false
  }: { label: string; settled?: boolean } = $props();
</script>

<span class="nc-beat" data-beat data-settled={settled ? 'true' : 'false'}>
  <span class="nc-beat-dot"></span>
  <span class="nc-beat-label">{label}</span>
</span>
