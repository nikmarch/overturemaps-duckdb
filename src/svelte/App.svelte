<script>
  import ReleaseSelect from './components/ReleaseSelect.svelte';
  import ThemeList from './components/ThemeList.svelte';
  import { clearCache, setShowFootprints, setHighlightIntersections } from '../lib/controller.js';
  import { showFootprints, highlightIntersections } from '../lib/stores.js';
</script>

<div id="map"></div>
<div id="controls">
  <div id="controlsHeader">
    <div id="status" class="loading">
      <div class="spinner"></div>
      <span>Initializing...</span>
    </div>
    <button id="collapseBtn" title="Toggle controls">−</button>
  </div>

  <div id="statsBar">
    <div class="stat"><span class="stat-label">Cached:</span> <span id="cachedStats">-</span></div>
    <div class="stat"><span class="stat-label">Shown:</span> <span id="shownStats">-</span></div>
  </div>

  <div id="controlsBody">
    <div class="btn-row">
      <button id="clearCacheBtn" on:click={clearCache}>Clear cache</button>
    </div>

    <ReleaseSelect />

    <label class="checkbox-row">
      <input type="checkbox" bind:checked={$showFootprints} on:change={(e) => setShowFootprints(e.target.checked)}>
      show footprints
    </label>

    <label class="checkbox-row">
      <input type="checkbox" bind:checked={$highlightIntersections} on:change={(e) => setHighlightIntersections(e.target.checked)}>
      highlight intersections (points)
    </label>

    <ThemeList />
  </div>
</div>
