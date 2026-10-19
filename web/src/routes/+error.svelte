<script lang="ts">
  import { page } from '$app/state';
</script>

<svelte:head>
  <title>{page.status} · NavCom</title>
  <meta name="description" content="That page does not exist." />
</svelte:head>

<div class="wrap">
  <p class="eyebrow">{page.status}</p>
  <h1>{page.status === 404 ? 'That page does not exist' : 'Something went wrong'}</h1>
  <p class="lead">
    {page.error?.message ?? 'No further detail.'}
  </p>
  <!--
    Reloads: shown inside the terminal, which runs the client router, a link followed without a reload
    would open the root under the terminal's headers, and the root's Content-Security-Policy with them
    would never arrive [docs/product/what-leaves.md; src/lib/outside.test.ts].
  -->
  <p class="links" data-sveltekit-reload>
    <a href="/directory/">Open the directory</a> ·
    <a href="/">Start over</a>
  </p>
</div>

<style>
  h1 { font-size: clamp(1.7rem, 5vw, 2.4rem); line-height: 1.15; margin: 0.5rem 0 1rem; }
  .lead { color: var(--muted); max-width: var(--measure); }
  .links { margin-top: 1.5rem; }
</style>
