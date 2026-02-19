<script>
  import { releases, selectedRelease, themeList, themeUi } from '../../lib/stores.js';
  import { setRelease } from '../../lib/controller.js';
  import { getThemeColor } from '../../lib/themes.js';

  let { open = $bindable(false), onload } = $props();

  let selected = $state(new Set());

  function keyOf(t) {
    return `${t.theme}/${t.type}`;
  }

  function toggle(key) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selected = next;
  }

  function selectAll() {
    selected = new Set($themeList.map(t => keyOf(t)));
  }

  function selectNone() {
    selected = new Set();
  }

  async function onReleaseChange(e) {
    await setRelease(e.target.value);
  }

  function handleLoad() {
    if (selected.size === 0) return;
    open = false;
    onload?.([...selected]);
    selected = new Set();
  }

  function handleCancel() {
    open = false;
  }

  function onBackdropClick(e) {
    if (e.target === e.currentTarget) handleCancel();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') handleCancel();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="load-modal-backdrop" onclick={onBackdropClick} onkeydown={onKeydown} role="dialog" tabindex="-1">
    <div class="load-modal">
      <div class="load-modal-header">
        <h3>Load Area</h3>
      </div>

      <div class="load-modal-release">
        <label for="modalRelease">Release</label>
        <select id="modalRelease" onchange={onReleaseChange} bind:value={$selectedRelease} disabled={$releases.length === 0}>
          {#each $releases as r}
            <option value={r}>{r}</option>
          {/each}
        </select>
      </div>

      <div class="load-modal-actions-top">
        <button type="button" class="load-modal-link-btn" onclick={selectAll}>Select all</button>
        <button type="button" class="load-modal-link-btn" onclick={selectNone}>Clear</button>
      </div>

      <div class="load-modal-grid">
        {#each $themeList as t (keyOf(t))}
          {@const key = keyOf(t)}
          {@const color = getThemeColor(key)}
          {@const ui = $themeUi[key] || {}}
          <label class="load-modal-theme" class:checked={selected.has(key)}>
            <input type="checkbox" checked={selected.has(key)} onchange={() => toggle(key)} />
            <span class="theme-dot" style="background: {color.fill};"></span>
            <span class="load-modal-theme-name">{t.type}</span>
            {#if ui.rowCount > 0}
              <span class="load-modal-theme-cached">cached</span>
            {/if}
          </label>
        {/each}
      </div>

      <div class="load-modal-footer">
        <button type="button" class="load-modal-cancel" onclick={handleCancel}>Cancel</button>
        <button type="button" class="load-modal-submit" onclick={handleLoad} disabled={selected.size === 0}>
          Load {selected.size > 0 ? `(${selected.size})` : ''}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .load-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fade-in 0.15s ease-out;
  }

  .load-modal {
    background: white;
    border-radius: 14px;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.25);
    padding: 20px 24px;
    min-width: 340px;
    max-width: 480px;
    width: 90vw;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .load-modal-header h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: #333;
  }

  .load-modal-release {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .load-modal-release label {
    font-size: 13px;
    color: #666;
    font-weight: 500;
    flex-shrink: 0;
  }
  .load-modal-release select {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 13px;
    background: white;
  }

  .load-modal-actions-top {
    display: flex;
    gap: 8px;
  }
  .load-modal-link-btn {
    background: none;
    border: none;
    color: #007bff;
    font-size: 12px;
    font-weight: 500;
    padding: 2px 4px;
    cursor: pointer;
  }
  .load-modal-link-btn:hover {
    text-decoration: underline;
    background: none;
    transform: none;
  }

  .load-modal-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 12px;
    overflow-y: auto;
    max-height: 50vh;
    padding: 4px 0;
  }

  .load-modal-theme {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    transition: background 0.1s;
  }
  .load-modal-theme:hover {
    background: #f0f4f8;
  }
  .load-modal-theme.checked {
    background: #e8f4fd;
  }
  .load-modal-theme input[type="checkbox"] {
    width: 15px;
    height: 15px;
    accent-color: #007bff;
    cursor: pointer;
    flex-shrink: 0;
  }
  .load-modal-theme-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .load-modal-theme-cached {
    font-size: 9px;
    color: #999;
    margin-left: auto;
    flex-shrink: 0;
  }

  .load-modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 4px;
    border-top: 1px solid #eee;
  }
  .load-modal-cancel {
    padding: 8px 16px;
    background: #f0f0f0;
    color: #666;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
  }
  .load-modal-cancel:hover {
    background: #e0e0e0;
    transform: none;
  }
  .load-modal-submit {
    padding: 8px 20px;
    background: #007bff;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
  }
  .load-modal-submit:disabled {
    background: #ccc;
    cursor: not-allowed;
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
