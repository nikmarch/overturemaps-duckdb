import { useState, useRef, useEffect } from 'react';
import { useStore } from '../../lib/store.js';

export default function ViewportCapPill() {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const inputRef = useRef(null);
  const viewportCap = useStore(s => s.viewportCap);
  const totalRendered = useStore(s => s.viewportStats.totalRendered);

  function startEdit() {
    setInputVal(String(viewportCap));
    setEditing(true);
  }

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  function commitEdit() {
    const n = parseInt(inputVal, 10);
    if (Number.isFinite(n) && n >= 100) {
      useStore.setState({ viewportCap: n });
    }
    setEditing(false);
  }

  function onKeydown(e) {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') setEditing(false);
  }

  if (totalRendered <= 0 && !editing) return null;

  return (
    <div className="viewport-cap-pill">
      {editing ? (
        <label className="viewport-cap-label">
          Cap:
          <input
            ref={inputRef}
            className="viewport-cap-input"
            type="number"
            min="100"
            step="500"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={onKeydown}
            onBlur={commitEdit}
          />
        </label>
      ) : (
        <button className="viewport-cap-btn" onClick={startEdit} title="Click to adjust render cap">
          {totalRendered.toLocaleString()}
          <span className="viewport-cap-sep">/</span>
          <span className="viewport-cap-max">{viewportCap.toLocaleString()}</span>
        </button>
      )}
    </div>
  );
}
