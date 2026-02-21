import { useEffect, useState } from 'react';
import SnapviewHistory from './components/SnapviewHistory';
import LoadModal from './components/LoadModal';
import StatusBar from './components/StatusBar';
import { loadArea } from '../lib/controller.js';
import { initMap } from '../lib/map.js';
import { loadReleases } from '../lib/themes.js';
import { initSnapviewsLayer } from '../lib/snapviews.js';
import { onMapMove } from '../lib/controller.js';
import { useStore } from '../lib/store.js';

export default function App() {
  const [modalOpen, setModalOpen] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        useStore.setState({ status: { text: 'Initializing...', type: 'loading' } });

        const map = initMap('map');
        initSnapviewsLayer();

        map.on('moveend', onMapMove);
        setTimeout(onMapMove, 0);

        await loadReleases();
        setInitialized(true);
      } catch (e) {
        useStore.setState({ status: { text: `Init error: ${e.message}`, type: 'error' } });
        console.error(e);
      }
    }
    init();
  }, []);

  function handleLoad(keys) {
    loadArea(keys);
  }

  return (
    <>
      <div id="map" />
      <StatusBar />
      <button
        className="load-area-btn"
        onClick={() => setModalOpen(true)}
        title="Load themes for current viewport"
      >
        Load Area
      </button>
      <LoadModal open={modalOpen} onClose={() => setModalOpen(false)} onLoad={handleLoad} />
      <SnapviewHistory />
    </>
  );
}
