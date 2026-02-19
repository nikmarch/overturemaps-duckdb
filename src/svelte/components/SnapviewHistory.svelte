<script>
  import { sortedSnapviews, activeSnapview } from '../../lib/stores.js';
  import { restoreSnapview } from '../../lib/controller.js';
  import { getThemeColor } from '../../lib/themes.js';

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
</script>

{#if $sortedSnapviews.length > 0}
  <details class="snapview-section" open>
    <summary class="snapview-header">
      Snapviews
      <span class="snapview-badge">{$sortedSnapviews.length}</span>
    </summary>
    <div class="snapview-list">
      {#each $sortedSnapviews as sv (sv.id)}
        <button
          class="snapview-item"
          class:active={$activeSnapview === sv.id}
          class:loading={sv.status === 'loading'}
          class:error={sv.status === 'error'}
          onclick={() => restoreSnapview(sv)}
          title="{sv.keys.length} theme(s) — {sv.status}"
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
        </button>
      {/each}
    </div>
  </details>
{/if}

<style>
  .snapview-section {
    font-size: 12px;
  }
  .snapview-header {
    cursor: pointer;
    color: #666;
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 0;
    display: flex;
    align-items: center;
    gap: 6px;
    list-style: none;
  }
  .snapview-header::-webkit-details-marker {
    display: none;
  }
  .snapview-header::before {
    content: '\25B8';
    font-size: 10px;
    transition: transform 0.15s;
  }
  details[open] > .snapview-header::before {
    transform: rotate(90deg);
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
    max-height: 180px;
    margin-top: 4px;
  }
  .snapview-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: #f8f9fa;
    border: 1px solid #eee;
    border-radius: 6px;
    cursor: pointer;
    font-size: 11px;
    text-align: left;
    color: #333;
    width: 100%;
  }
  .snapview-item:hover {
    background: #e9ecef;
    transform: none;
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

  @keyframes pulse-dot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.8); }
  }
</style>
