<script>
  import { status } from '../../lib/stores.js';
</script>

<div id="status" class={$status.type}>
  {#if $status.type === 'loading'}
    <div class="spinner"></div>
  {/if}
  <span>{$status.text}</span>
</div>
