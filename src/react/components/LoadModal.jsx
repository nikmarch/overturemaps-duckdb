import { useState, useEffect, useMemo } from 'react';
import { useStore } from '../../lib/store.js';
import { setRelease } from '../../lib/controller.js';
import { getThemeColor } from '../../lib/themes.js';
import { PROXY } from '../../lib/constants.js';
import { getBbox } from '../../lib/map.js';

export default function LoadModal({ open, onClose, onLoad }) {
  const [selected, setSelected] = useState(new Set());
  const [fileCounts, setFileCounts] = useState({});
  const releases = useStore(s => s.releases);
  const selectedRelease = useStore(s => s.selectedRelease);
  const themes = useStore(s => s.themes);
  const themeList = useMemo(
    () => [...themes].sort((a, b) => `${a.theme}/${a.type}`.localeCompare(`${b.theme}/${b.type}`)),
    [themes],
  );
  const themeUi = useStore(s => s.themeUi);

  // Fetch total file counts when modal opens
  useEffect(() => {
    if (!open || !selectedRelease || themeList.length === 0) return;

    let cancelled = false;
    const bbox = getBbox();
    if (!bbox) return;

    const counts = {};
    Promise.all(
      themeList.map(async (t) => {
        const key = `${t.theme}/${t.type}`;
        // Use cached fileCount if available
        const ui = themeUi[key];
        if (ui?.fileCount) {
          counts[key] = ui.fileCount;
          return;
        }
        try {
          const url = `${PROXY}/files?release=${selectedRelease}&theme=${t.theme}&type=${t.type}&xmin=${bbox.xmin}&xmax=${bbox.xmax}&ymin=${bbox.ymin}&ymax=${bbox.ymax}`;
          const res = await fetch(url, { method: 'HEAD' });
          const total = res.headers.get('X-Total-Files');
          counts[key] = total ? parseInt(total, 10) : null;
        } catch {
          counts[key] = null;
        }
      })
    ).then(() => {
      if (!cancelled) setFileCounts({ ...counts });
    });

    return () => { cancelled = true; };
  }, [open, selectedRelease, themeList.length]);

  const keyOf = (t) => `${t.theme}/${t.type}`;

  function toggle(key) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(themeList.map(t => keyOf(t))));
  }

  function selectNone() {
    setSelected(new Set());
  }

  async function onReleaseChange(e) {
    await setRelease(e.target.value);
  }

  function handleLoad() {
    if (selected.size === 0) return;
    onClose();
    onLoad?.([...selected]);
    setSelected(new Set());
  }

  function handleCancel() {
    onClose();
  }

  function onBackdropClick(e) {
    if (e.target === e.currentTarget) handleCancel();
  }

  useEffect(() => {
    if (!open) return;
    function onKeydown(e) {
      if (e.key === 'Escape') handleCancel();
    }
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  }, [open]);

  if (!open) return null;

  return (
    <div className="load-modal-backdrop" onClick={onBackdropClick} role="dialog" tabIndex={-1}>
      <div className="load-modal">
        <div className="load-modal-header">
          <h3>Load Area</h3>
        </div>

        <div className="load-modal-release">
          <label htmlFor="modalRelease">Release</label>
          <select
            id="modalRelease"
            onChange={onReleaseChange}
            value={selectedRelease || ''}
            disabled={releases.length === 0}
          >
            {releases.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        <div className="load-modal-actions-top">
          <button type="button" className="load-modal-link-btn" onClick={selectAll}>Select all</button>
          <button type="button" className="load-modal-link-btn" onClick={selectNone}>Clear</button>
        </div>

        <div className="load-modal-grid">
          {themeList.map(t => {
            const key = keyOf(t);
            const color = getThemeColor(key);
            const ui = themeUi[key] || {};
            const fileCount = fileCounts[key];
            return (
              <label key={key} className={`load-modal-theme ${selected.has(key) ? 'checked' : ''}`}>
                <input
                  type="checkbox"
                  checked={selected.has(key)}
                  onChange={() => toggle(key)}
                />
                <span className="theme-dot" style={{ background: color.fill }} />
                <span className="load-modal-theme-name">{t.type}</span>
                {fileCount && (
                  <span className="load-modal-theme-files">{fileCount} files</span>
                )}
                {ui.rowCount > 0 && (
                  <span className="load-modal-theme-cached">cached</span>
                )}
              </label>
            );
          })}
        </div>

        <div className="load-modal-footer">
          <button type="button" className="load-modal-cancel" onClick={handleCancel}>Cancel</button>
          <button
            type="button"
            className="load-modal-submit"
            onClick={handleLoad}
            disabled={selected.size === 0}
          >
            Load {selected.size > 0 ? `(${selected.size})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
