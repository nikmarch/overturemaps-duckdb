<script>
  import { themeList, themeUi } from '../../lib/stores.js';
  import { manualToggleTheme, setThemeLimit } from '../../lib/controller.js';
  import { getThemeColor } from '../../lib/themes.js';

  function keyOf(t) {
    return `${t.theme}/${t.type}`;
  }

  async function onToggle(key, e) {
    await manualToggleTheme(key, e.target.checked);
  }

  function onLimit(key, e) {
    const n = parseInt(e.target.value, 10);
    setThemeLimit(key, Number.isFinite(n) ? n : 33000);
  }

  function formatDuration(ms) {
    if (!ms) return '';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }
</script>

<div id="themeList">
  {#each $themeList as t (keyOf(t))}
    {@const key = keyOf(t)}
    {@const ui = $themeUi[key] || { enabled: false, limit: 33000, loading: false, metaText: '' }}
    {@const color = getThemeColor(key)}
    {@const hasStats = ui.rowCount > 0}

    <div class="theme-row" data-key={key} class:loading={ui.loading} class:has-data={hasStats && ui.enabled}>
      <label>
        <span class="theme-dot" style="background: {color.fill};"></span>
        <input type="checkbox" checked={ui.enabled} onchange={(e) => onToggle(key, e)} />
        <span class="theme-name" title={key}>{t.type}</span>
      </label>

      {#if hasStats && ui.enabled}
        <span class="theme-stats">
          {ui.rowCount.toLocaleString()}
          <span class="theme-stats-sep">&middot;</span>
          {formatDuration(ui.loadTimeMs)}
        </span>
      {:else}
        <span class="theme-meta" data-key={key}>{ui.metaText || ''}</span>
      {/if}

      <input
        type="number"
        class="theme-limit"
        min="100"
        max="1000000"
        step="1000"
        value={ui.limit}
        onchange={(e) => onLimit(key, e)}
      />
    </div>
  {/each}
</div>
