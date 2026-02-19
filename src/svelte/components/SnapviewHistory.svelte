<script>
  import { sortedSnapviews, activeSnapview, themeUi, highlightIntersections } from '../../lib/stores.js';
  import { restoreSnapview, deleteSnapview, toggleSnapviewTheme, setHighlightIntersections } from '../../lib/controller.js';
  import { getThemeColor } from '../../lib/themes.js';

  let expandedId = $state(null);

  function formatTs(ms) {
    const d = new Date(ms);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `${time} ${date}`;
  }

  function formatDuration(ms) {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function shortKeys(keys) {
    return keys.map(k => k.split('/')[1]).join(', ');
  }

  function progressPct(sv) {
    if (!sv.progress || sv.progress.total === 0) return 0;
    return (sv.progress.loaded / sv.progress.total) * 100;
  }

  function progressText(sv) {
    if (!sv.progress) return '';
    const p = sv.progress;
    const currentType = p.currentKey ? p.currentKey.split('/')[1] : '';
    const ts = sv.themeStats[p.currentKey];
    let fileInfo = '';
    if (ts && ts.filesTotal) {
      fileInfo = ` (${ts.filesLoaded || 0}/${ts.filesTotal} files)`;
    }
    return `Loading ${currentType}${fileInfo}`;
  }

  function statsText(sv) {
    const parts = [];
    if (sv.totalRows != null) parts.push(`${sv.totalRows.toLocaleString()} rows`);
    if (sv.totalFiles != null && sv.totalFiles > 0) parts.push(`${sv.totalFiles} files`);
    return parts.join(' \u00b7 ');
  }

  function handleDelete(e, svId) {
    e.stopPropagation();
    if (expandedId === svId) expandedId = null;
    deleteSnapview(svId);
  }

  function handleHeaderClick(sv) {
    expandedId = expandedId === sv.id ? null : sv.id;
  }

  function handleThemeToggle(e, sv, key) {
    e.stopPropagation();
    const checked = e.target.checked;
    toggleSnapviewTheme(sv.id, key, checked);
  }

  function handleRestore(e, sv) {
    e.stopPropagation();
    restoreSnapview(sv);
  }

  function handleIntersections(e) {
    e.stopPropagation();
    setHighlightIntersections(!$highlightIntersections);
  }

  function themeRowCount(sv, key) {
    const ts = sv.themeStats[key];
    if (ts && ts.rows != null) return ts.rows.toLocaleString();
    return '?';
  }
</script>

{#if $sortedSnapviews.length > 0}
  <div class="snapview-panel">
    <div class="snapview-panel-header">
      <span class="snapview-panel-title">Snapviews</span>
      <span class="snapview-badge">{$sortedSnapviews.length}</span>
    </div>
    <div class="snapview-list">
      {#each $sortedSnapviews as sv (sv.id)}
        {@const isExpanded = expandedId === sv.id}
        <div
          class="snapview-item"
          class:active={$activeSnapview === sv.id}
          class:loading={sv.status === 'loading'}
          class:error={sv.status === 'error'}
          class:expanded={isExpanded}
        >
          <div
            class="snapview-header"
            role="button"
            tabindex="0"
            onclick={() => handleHeaderClick(sv)}
            onkeydown={(e) => e.key === 'Enter' && handleHeaderClick(sv)}
          >
            <div class="snapview-dots">
              {#each sv.keys.slice(0, 4) as key}
                {@const color = getThemeColor(key)}
                <span
                  class="snapview-dot"
                  class:pulse={sv.status === 'loading'}
                  style="background: {color?.fill || '#999'};"
                ></span>
              {/each}
            </div>
            <span class="snapview-info">
              <span class="snapview-keys">{shortKeys(sv.keys)}</span>

              {#if sv.status === 'loading'}
                <div class="snapview-progress">
                  <div class="snapview-progress-bar" style="width: {progressPct(sv)}%"></div>
                  <span class="snapview-progress-text">
                    {sv.progress.loaded}/{sv.progress.total} themes
                  </span>
                </div>
                <span class="snapview-loading-detail">{progressText(sv)}</span>
              {:else if sv.status === 'error'}
                <span class="snapview-error-text">Error: {sv.error || 'unknown'}</span>
              {:else}
                <span class="snapview-stats">
                  {statsText(sv)} &middot; {formatDuration(sv.totalTimeMs)} &middot; {formatTs(sv.ts)}
                </span>
              {/if}
            </span>
            <button
              class="snapview-delete-btn"
              title="Delete snapview"
              onclick={(e) => handleDelete(e, sv.id)}
            >&times;</button>
          </div>

          {#if isExpanded && sv.status === 'done'}
            <div class="snapview-expanded">
              <div class="snapview-theme-list">
                {#each sv.keys as key}
                  {@const color = getThemeColor(key)}
                  {@const enabled = $themeUi[key]?.enabled ?? false}
                  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
                  <label class="snapview-theme-row" onclick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onchange={(e) => handleThemeToggle(e, sv, key)}
                    />
                    <span class="snapview-theme-dot" style="background: {color?.fill || '#999'};"></span>
                    <span class="snapview-theme-name">{key.split('/')[1]}</span>
                    <span class="snapview-theme-count">{themeRowCount(sv, key)} rows</span>
                  </label>
                {/each}
              </div>
              <div class="snapview-actions">
                <button class="snapview-action-btn" onclick={(e) => handleRestore(e, sv)}>
                  Restore viewport
                </button>
                <button
                  class="snapview-action-btn"
                  class:active-toggle={$highlightIntersections}
                  onclick={handleIntersections}
                >
                  {$highlightIntersections ? 'Hide' : 'Show'} intersections
                </button>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .snapview-panel {
    position: absolute;
    bottom: 28px;
    left: 10px;
    z-index: 1000;
    background: rgba(255, 255, 255, 0.92);
    backdrop-filter: blur(8px);
    border-radius: 10px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
    padding: 8px;
    max-width: 320px;
    min-width: 200px;
    font-size: 12px;
  }
  .snapview-panel-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 4px 6px;
  }
  .snapview-panel-title {
    color: #666;
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .snapview-badge {
    font-size: 10px;
    font-weight: 700;
    background: #e9ecef;
    color: #555;
    border-radius: 10px;
    padding: 1px 6px;
    line-height: 1.3;
  }
  .snapview-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
    max-height: 400px;
  }
  .snapview-item {
    background: rgba(248, 249, 250, 0.8);
    border: 1px solid #eee;
    border-radius: 6px;
    font-size: 11px;
    text-align: left;
    color: #333;
  }
  .snapview-item:hover {
    background: #e9ecef;
  }
  .snapview-item.active {
    background: #e8f4fd;
    border-color: #b3d9f2;
  }
  .snapview-item.loading {
    border-color: #ffc107;
    background: #fffcf0;
  }
  .snapview-item.error {
    border-color: #e74c3c;
    background: #fdf2f2;
  }
  .snapview-item.expanded {
    background: #f8f9fa;
  }
  .snapview-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 6px;
    cursor: pointer;
  }
  .snapview-dots {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex-shrink: 0;
  }
  .snapview-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }
  .snapview-dot.pulse {
    animation: pulse-dot 1.2s ease-in-out infinite;
  }
  .snapview-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1;
  }
  .snapview-keys {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
  }
  .snapview-stats {
    color: #888;
    font-size: 10px;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    white-space: nowrap;
  }
  .snapview-loading-detail {
    color: #856404;
    font-size: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .snapview-error-text {
    color: #e74c3c;
    font-size: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .snapview-progress {
    position: relative;
    height: 12px;
    background: #e9ecef;
    border-radius: 3px;
    overflow: hidden;
    margin-top: 2px;
  }
  .snapview-progress-bar {
    height: 100%;
    background: #ffc107;
    border-radius: 3px;
    transition: width 0.3s;
  }
  .snapview-progress-text {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    font-weight: 600;
    color: #333;
  }
  .snapview-delete-btn {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: #bbb;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
  }
  .snapview-delete-btn:hover {
    background: rgba(231, 76, 60, 0.1);
    color: #e74c3c;
    transform: none;
  }

  /* Expanded section */
  .snapview-expanded {
    padding: 4px 6px 6px;
    border-top: 1px solid #e0e0e0;
  }
  .snapview-theme-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: 6px;
  }
  .snapview-theme-row {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 2px 2px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
  }
  .snapview-theme-row:hover {
    background: rgba(0, 0, 0, 0.04);
  }
  .snapview-theme-row input[type="checkbox"] {
    margin: 0;
    width: 13px;
    height: 13px;
    cursor: pointer;
  }
  .snapview-theme-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .snapview-theme-name {
    flex: 1;
    font-weight: 500;
  }
  .snapview-theme-count {
    color: #999;
    font-size: 10px;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  }
  .snapview-actions {
    display: flex;
    gap: 4px;
  }
  .snapview-action-btn {
    flex: 1;
    padding: 3px 6px;
    font-size: 10px;
    font-weight: 500;
    background: #eef1f5;
    border: 1px solid #ddd;
    border-radius: 4px;
    cursor: pointer;
    color: #555;
    white-space: nowrap;
  }
  .snapview-action-btn:hover {
    background: #dde3ea;
    border-color: #ccc;
  }
  .snapview-action-btn.active-toggle {
    background: #e8f4fd;
    border-color: #b3d9f2;
    color: #1a73e8;
  }

  @keyframes pulse-dot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.8); }
  }
</style>
