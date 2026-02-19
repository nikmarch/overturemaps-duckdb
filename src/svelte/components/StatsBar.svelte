<script>
  import { viewportStats } from '../../lib/stores.js';
</script>

<div id="statsBar">
  <div class="stat">
    <span class="stat-label">Themes:</span>
    <span id="themesStats">{$viewportStats.enabledCount}/{$viewportStats.totalThemes}</span>
  </div>
  <div class="stat">
    <span class="stat-label">Shown:</span>
    <span id="shownStats">{$viewportStats.shownText}</span>
  </div>
  <div class="stat stat-wide">
    <span class="stat-label">Viewport:</span>
    <span id="viewportStats">{$viewportStats.viewportText}</span>
  </div>
</div>
