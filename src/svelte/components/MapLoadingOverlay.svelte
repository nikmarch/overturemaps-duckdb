<script>
  import { snapviews } from '../../lib/stores.js';

  const loading = $derived((() => {
    const sv = $snapviews.find(s => s.status === 'loading');
    if (!sv) return null;
    const p = sv.progress;
    const currentType = p.currentKey ? p.currentKey.split('/')[1] : '';
    const ts = sv.themeStats[p.currentKey];
    let fileInfo = '';
    if (ts && ts.filesTotal) {
      fileInfo = `${ts.filesLoaded || 0}/${ts.filesTotal} files`;
    }
    const themePct = p.total > 0 ? Math.round((p.loaded / p.total) * 100) : 0;
    return { currentType, fileInfo, loaded: p.loaded, total: p.total, themePct };
  })());
</script>

{#if loading}
  <div class="map-loading-overlay">
    <div class="map-loading-card">
      <div class="map-loading-bar-track">
        <div class="map-loading-bar-fill" style="width: {loading.themePct}%"></div>
      </div>
      <div class="map-loading-text">
        {#if loading.currentType}
          Loading {loading.currentType}
          {#if loading.fileInfo}
            <span class="map-loading-detail">{loading.fileInfo}</span>
          {/if}
        {:else}
          Loading...
        {/if}
        <span class="map-loading-count">{loading.loaded}/{loading.total} themes</span>
      </div>
    </div>
  </div>
{/if}

<style>
  .map-loading-overlay {
    position: absolute;
    inset: 0;
    z-index: 800;
    background: rgba(0, 0, 0, 0.12);
    backdrop-filter: blur(1px);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    animation: fade-in 0.2s ease-out;
  }

  .map-loading-card {
    background: rgba(255, 255, 255, 0.92);
    border-radius: 10px;
    padding: 14px 22px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    min-width: 220px;
    max-width: 320px;
    pointer-events: auto;
  }

  .map-loading-bar-track {
    height: 5px;
    background: #e9ecef;
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 8px;
  }

  .map-loading-bar-fill {
    height: 100%;
    background: #ffc107;
    border-radius: 3px;
    transition: width 0.4s ease;
    animation: bar-pulse 1.5s ease-in-out infinite;
  }

  .map-loading-text {
    font-size: 13px;
    font-weight: 500;
    color: #333;
    display: flex;
    align-items: baseline;
    gap: 6px;
    flex-wrap: wrap;
  }

  .map-loading-detail {
    font-size: 11px;
    color: #888;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  }

  .map-loading-count {
    font-size: 11px;
    color: #999;
    margin-left: auto;
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes bar-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
</style>
