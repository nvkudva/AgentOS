import { createRoot } from 'react-dom/client';
import App from './App';
import './fonts.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);

/**
 * The service worker is a production concern only.
 *
 * In development it is worse than useless — it would serve a stale shell over the dev
 * server — so dev actively tears down whatever is registered for this origin. That also
 * clears a foreign worker left behind by another project that once ran on this port,
 * which is otherwise invisible and serves someone else's app shell.
 */
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* offline is a bonus, not a requirement */ });
    });
  } else {
    navigator.serviceWorker.getRegistrations()
      .then((rs) => rs.forEach((r) => r.unregister()))
      .catch(() => { /* nothing registered, nothing to do */ });
  }
}
