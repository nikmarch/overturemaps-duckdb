<script>
  import SnapviewHistory from './components/SnapviewHistory.svelte';
  import MapLoadingOverlay from './components/MapLoadingOverlay.svelte';
  import LoadModal from './components/LoadModal.svelte';
  import ViewportCapPill from './components/ViewportCapPill.svelte';
  import { loadArea } from '../lib/controller.js';

  let modalOpen = $state(false);

  function handleLoad(keys) {
    loadArea(keys);
  }
</script>

<div id="map">
  <MapLoadingOverlay />
</div>

<button class="load-area-btn" onclick={() => modalOpen = true} title="Load themes for current viewport">
  Load Area
</button>

<LoadModal bind:open={modalOpen} onload={handleLoad} />
<ViewportCapPill />
<SnapviewHistory />
