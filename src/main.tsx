import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

/** Block the browser's own zoom so only the canvas camera zooms. */
function blockBrowserZoom(): void {
  const stop = (e: Event) => e.preventDefault();
  // Ctrl/Cmd + wheel (and trackpad pinch, which browsers report as ctrl+wheel).
  document.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    },
    { passive: false, capture: true },
  );
  // Ctrl/Cmd + / - / 0
  document.addEventListener(
    'keydown',
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '_' || e.key === '0') e.preventDefault();
    },
    { capture: true },
  );
  // Safari pinch gestures on the page chrome.
  document.addEventListener('gesturestart', stop, { passive: false });
  document.addEventListener('gesturechange', stop, { passive: false });
  document.addEventListener('gestureend', stop, { passive: false });
}

blockBrowserZoom();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
