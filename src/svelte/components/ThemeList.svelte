<script>
  import { themeList, themeUi } from '../../lib/stores.js';
  import { toggleTheme, setThemeLimit } from '../../lib/controller.js';

  function keyOf(t) {
    return `${t.theme}/${t.type}`;
  }

  async function onToggle(key, e) {
    await toggleTheme(key, e.target.checked);
  }

  function onLimit(key, e) {
    const n = parseInt(e.target.value, 10);
    setThemeLimit(key, Number.isFinite(n) ? n : 33000);
  }
</script>

<div id="themeList">
  {#each $themeList as t (keyOf(t))}
    {@const key = keyOf(t)}
    {@const ui = $themeUi[key] || { enabled: false, limit: 33000, loading: false, metaText: '' }}

    <div class="theme-row" data-key={key} class:loading={ui.loading}>
      <label>
        <span class="theme-dot" style="background: var(--theme-dot, #999);"></span>
        <input type="checkbox" checked={ui.enabled} on:change={(e) => onToggle(key, e)} />
        <span class="theme-name" title={key}>{t.type}</span>
      </label>

      <span class="theme-meta" data-key={key}>{ui.metaText || ''}</span>
      <input
        type="number"
        class="theme-limit"
        min="100"
        max="1000000"
        step="1000"
        value={ui.limit}
        on:change={(e) => onLimit(key, e)}
      />
    </div>
  {/each}
</div>
