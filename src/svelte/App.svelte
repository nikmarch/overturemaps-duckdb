<script>
  import StatusBar from './components/StatusBar.svelte';
  import StatsBar from './components/StatsBar.svelte';
  import ReleaseSelect from './components/ReleaseSelect.svelte';
  import ThemeList from './components/ThemeList.svelte';
  import SnapviewHistory from './components/SnapviewHistory.svelte';
  import { clearCache, setShowSnapviewsCtrl, setHighlightIntersections } from '../lib/controller.js';
  import { showSnapviews, highlightIntersections } from '../lib/stores.js';

  let controlsCollapsed = $state(localStorage.getItem('controlsCollapsed') === 'true');

  function toggleCollapse() {
    controlsCollapsed = !controlsCollapsed;
    localStorage.setItem('controlsCollapsed', controlsCollapsed);
  }
</script>

<div id="map"></div>
<div id="controls">
  <div id="controlsHeader">
    <StatusBar />
    <button id="collapseBtn" title="Toggle controls" onclick={toggleCollapse}>
      {controlsCollapsed ? '+' : '−'}
    </button>
  </div>

  <StatsBar />

  {#if !controlsCollapsed}
    <div id="controlsBody">
      <ReleaseSelect />

      <div class="checkbox-row">
        <label>
          <input type="checkbox" checked={$showSnapviews} onchange={(e) => setShowSnapviewsCtrl(e.target.checked)}>
          show snapviews
        </label>
        <label>
          <input type="checkbox" checked={$highlightIntersections} onchange={(e) => setHighlightIntersections(e.target.checked)}>
          highlight intersections (points)
        </label>
      </div>

      <ThemeList />

      <SnapviewHistory />

      <button class="clear-cache-btn" type="button" onclick={clearCache}>Clear cache</button>
    </div>
  {/if}
</div>
