import './style.css';
import 'leaflet/dist/leaflet.css';
import { createRoot } from 'react-dom/client';
import App from './react/App';

const root = createRoot(document.getElementById('app'));
root.render(<App />);
