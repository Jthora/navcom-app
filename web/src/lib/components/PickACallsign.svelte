<script lang="ts">
  /**
   * What a screen says when it needs a callsign and there is not one yet.
   *
   * Four screens carried this sentence byte-for-byte — Card, Peers, Standing and Watch — and
   * a fifth would have carried a fifth copy. One component instead, for the reason the
   * observation labels became a table: four copies of a string are four things to keep in
   * agreement, and they only stay in agreement by luck. Three of the four already sat inside
   * an identical `<section class="act">`; the wrapper stays at the call site because Peers
   * does not have one, and moving it would have changed that screen's layout to tidy this.
   *
   * It is a `<p>` and not a `Readout`. This is not a state the panel is reporting — it is one
   * sentence telling somebody what to do next, and the link is the doing.
   */
</script>

<p>Pick a callsign first — <a href="/terminal/setup/">it takes one screen</a>.</p>
