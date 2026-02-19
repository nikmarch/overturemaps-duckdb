<script>
  import { viewportCap, viewportStats } from '../../lib/stores.js';

  let editing = $state(false);
  let inputVal = $state('');

  function startEdit() {
    inputVal = String($viewportCap);
    editing = true;
    // Focus input after Svelte renders it
    setTimeout(() => document.querySelector('.viewport-cap-input')?.focus(), 0);
  }

  function commitEdit() {
    const n = parseInt(inputVal, 10);
    if (Number.isFinite(n) && n >= 100) {
      viewportCap.set(n);
    }
    editing = false;
  }

  function onKeydown(e) {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') editing = false;
  }
</script>

{#if $viewportStats.totalRendered > 0 || editing}
  <div class="viewport-cap-pill">
    {#if editing}
      <label class="viewport-cap-label">
        Cap:
        <input
          class="viewport-cap-input"
          type="number"
          min="100"
          step="500"
          bind:value={inputVal}
          onkeydown={onKeydown}
          onblur={commitEdit}
        />
      </label>
    {:else}
      <button class="viewport-cap-btn" onclick={startEdit} title="Click to adjust render cap">
        {$viewportStats.totalRendered.toLocaleString()}
        <span class="viewport-cap-sep">/</span>
        <span class="viewport-cap-max">{$viewportCap.toLocaleString()}</span>
      </button>
    {/if}
  </div>
{/if}

<style>
  .viewport-cap-pill {
    position: absolute;
    bottom: 28px;
    right: 120px;
    z-index: 1000;
  }

  .viewport-cap-btn {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 10px;
    background: rgba(255, 255, 255, 0.88);
    backdrop-filter: blur(6px);
    border: 1px solid #ddd;
    border-radius: 14px;
    font-size: 11px;
    font-weight: 500;
    color: #555;
    cursor: pointer;
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.1);
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  }
  .viewport-cap-btn:hover {
    background: rgba(255, 255, 255, 0.95);
    border-color: #bbb;
    transform: none;
  }
  .viewport-cap-sep {
    color: #ccc;
  }
  .viewport-cap-max {
    color: #999;
  }

  .viewport-cap-label {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    background: white;
    border: 1px solid #007bff;
    border-radius: 14px;
    font-size: 11px;
    font-weight: 500;
    color: #555;
    box-shadow: 0 1px 8px rgba(0, 123, 255, 0.15);
  }
  .viewport-cap-input {
    width: 70px;
    border: none;
    outline: none;
    font-size: 11px;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-weight: 600;
    color: #333;
    background: transparent;
    text-align: right;
  }
  .viewport-cap-input::-webkit-inner-spin-button {
    opacity: 1;
  }
</style>
