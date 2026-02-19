import { useEffect, useState, useRef } from 'react';
import { useStore } from '../../lib/store.js';

const QUIPS = [
  'Hang tight...',
  'Crunching parquet files...',
  'Almost there...',
  'Please don\'t judge, this is a lot for one tab...',
  'DuckDB is doing its best...',
  'Streaming bytes across the wire...',
  'Your browser is a database now...',
  'SELECT patience FROM user LIMIT 1...',
  'This is fine. Everything is fine.',
  'Turning cloud data into map dots...',
  'One parquet file at a time...',
  'WebAssembly goes brrr...',
];

function pickQuip(prev) {
  let q;
  do { q = QUIPS[Math.floor(Math.random() * QUIPS.length)]; } while (q === prev && QUIPS.length > 1);
  return q;
}

export default function StatusBar() {
  const status = useStore(s => s.status);
  const [quip, setQuip] = useState('');
  const intervalRef = useRef(null);

  useEffect(() => {
    if (status.type === 'loading') {
      setQuip(pickQuip(''));
      intervalRef.current = setInterval(() => {
        setQuip(prev => pickQuip(prev));
      }, 4000);
    } else {
      clearInterval(intervalRef.current);
      setQuip('');
    }
    return () => clearInterval(intervalRef.current);
  }, [status.type]);

  if (!status.text || status.type === 'success') return null;

  return (
    <div className={`status-bar status-${status.type}`}>
      {status.type === 'loading' && <div className="status-spinner" />}
      <div className="status-content">
        <span className="status-main">{status.text}</span>
        {status.type === 'loading' && quip && (
          <span className="status-quip">{quip}</span>
        )}
      </div>
    </div>
  );
}
