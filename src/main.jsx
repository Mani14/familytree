import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Registers the minimal service worker (public/sw.js) that makes the app
// installable on phones/desktops. Prod-only — a SW in dev fights Vite's HMR.
// './sw.js' resolves against the document, so the scope matches whichever
// subpath the app is served from (root on Firebase, /familytree/ on Pages).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.error('Service worker registration failed:', err));
  });
}
