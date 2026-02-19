<script>
  import { releases, selectedRelease } from '../../lib/stores.js';
  import { setRelease } from '../../lib/controller.js';

  async function onChange(e) {
    await setRelease(e.target.value);
  }
</script>

<div class="select-row">
  <label for="releaseSelect">Release</label>
  <select id="releaseSelect" onchange={onChange} bind:value={$selectedRelease} disabled={$releases.length === 0}>
    {#each $releases as r}
      <option value={r}>{r}</option>
    {/each}
  </select>
</div>
