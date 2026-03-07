import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../lib/store.js';
import { rerenderAllEnabled } from '../../lib/themes.js';

const DEBOUNCE_MS = 250;

export default function MapSearch() {
  const globalSearch = useStore(s => s.globalSearch);
  const [q, setQ] = useState(globalSearch || '');

  const trimmed = useMemo(() => q.trim(), [q]);

  // Keep local input in sync if globalSearch changes elsewhere.
  useEffect(() => {
    setQ(globalSearch || '');
  }, [globalSearch]);

  // Debounced: set global store + rerender everything.
  useEffect(() => {
    const t = setTimeout(() => {
      useStore.setState({ globalSearch: trimmed });
      rerenderAllEnabled().catch(() => {});
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [trimmed]);

  function clear() {
    setQ('');
    useStore.setState({ globalSearch: '' });
    rerenderAllEnabled().catch(() => {});
  }

  return (
    <div className="map-search">
      <input
        className="map-search__input"
        value={q}
        placeholder="Filter (all loaded tables)…"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            clear();
          }
        }}
        spellCheck={false}
      />

      {trimmed && (
        <button className="map-search__clear" onClick={clear} title="Clear">
          ×
        </button>
      )}
    </div>
  );
}
