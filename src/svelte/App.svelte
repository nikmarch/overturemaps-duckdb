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
      <button id="clearCacheBtn">Clear cache</button>
    </div>

    <div class="release-row">
      <label for="releaseSelect">Release</label>
      <select id="releaseSelect"></select>
    </div>

    <label class="checkbox-row"><input type="checkbox" id="footprintsCheck" checked> show footprints</label>
    <label class="checkbox-row"><input type="checkbox" id="intersectionsCheck"> highlight intersections (points)</label>

    <div id="themeList"></div>
  </div>
</div>
