<script>
  import { groupedSnapviews, activeSnapview } from '../../lib/stores.js';
  import { restoreSnapview } from '../../lib/controller.js';

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

  function isActive(group) {
    const a = $activeSnapview;
    if (!a) return false;
    return a.bbox.xmin === group.bbox.xmin && a.bbox.ymin === group.bbox.ymin &&
           a.bbox.xmax === group.bbox.xmax && a.bbox.ymax === group.bbox.ymax;
  }
</script>

{#if $groupedSnapviews.length > 0}
  <details class="snapview-section" open>
    <summary class="snapview-header">
      Snapviews
      <span class="snapview-badge">{$groupedSnapviews.length}</span>
    </summary>
    <div class="snapview-list">
      {#each $groupedSnapviews as group}
        <button
          class="snapview-item"
          class:active={isActive(group)}
          onclick={() => restoreSnapview(group)}
          title="Restore {group.keys.length} theme(s) at this viewport"
        >
          <div class="snapview-dots">
            {#each group.entries.slice(0, 4) as sv}
              <span class="snapview-dot" style="background: {sv.color?.fill || '#999'};"></span>
            {/each}
          </div>
          <span class="snapview-info">
            <span class="snapview-keys">{group.keys.join(', ')}</span>
            <span class="snapview-stats">
              {group.totalRows.toLocaleString()} rows &middot; {formatDuration(group.totalTimeMs)} &middot; {formatTs(group.ts)}
            </span>
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
    content: '▸';
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
</style>
