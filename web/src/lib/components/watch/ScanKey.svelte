<script lang="ts">
  /**
   * A key, off somebody else's screen, by camera [`$lib/terminal/scan`].
   *
   * A watch is handed over in person, and two keys cross when it is: the watch key to the relief,
   * and the relief's holder key back, so the code for operators names them. Both were 64 hex
   * characters typed by hand. Absent where this browser cannot scan, rather than a button that
   * does nothing; the paste field beside it is the answer there.
   */
  import { onMount } from 'svelte';
  import { canScan, pubkeyFrom, scan, ScanError, type Scanner } from '$lib/terminal/scan';

  let { label, onfound }: { label: string; onfound: (key: string) => void } = $props();

  let scannable = $state(false);
  let scanning = $state(false);
  let error = $state<string | null>(null);
  let camera = $state<HTMLVideoElement | null>(null);
  let scanner: Scanner | null = null;

  onMount(() => {
    scannable = canScan();
    return () => scanner?.stop();
  });

  async function start() {
    if (!camera) return;
    error = null;
    scanning = true;
    try {
      scanner = await scan(camera);
      const key = pubkeyFrom(await scanner.found);
      if (!key) throw new ScanError('That code is not a key.');
      onfound(key);
    } catch (err) {
      error = err instanceof ScanError ? err.message : 'Could not scan.';
    } finally {
      scanning = false;
      scanner = null;
    }
  }

  function stop() {
    scanner?.stop();
    scanner = null;
    scanning = false;
  }
</script>

{#if scannable}
  <button type="button" onclick={scanning ? stop : start}>{scanning ? 'Stop' : label}</button>
  <video bind:this={camera} class="camera" class:live={scanning} playsinline muted aria-label="Camera, looking for a code"></video>
  {#if error}<span class="error">{error}</span>{/if}
{/if}

<style>
  .camera { display: none; width: 100%; max-width: 20rem; background: #000; }
  .camera.live { display: block; }
</style>
