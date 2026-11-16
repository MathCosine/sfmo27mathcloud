import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/stix-two-text/latin-400.css';
import '@fontsource/stix-two-text/latin-400-italic.css';
import '@fontsource/stix-two-text/latin-600.css';
import '@fontsource/instrument-sans/latin-400.css';
import '@fontsource/instrument-sans/latin-500.css';
import '@fontsource/instrument-sans/latin-600.css';
import '@fontsource/dm-mono/latin-400.css';
import '@fontsource/dm-mono/latin-500.css';
import 'katex/dist/katex.min.css';
import './styles/app.css';
import { App } from './App';
import { backend } from './lib/api';

async function boot() {
  // Staff email links come back as ?to=staff&code=…: let the auth client read
  // the code first, then tidy the address.
  const params = new URLSearchParams(location.search);
  if (params.has('to')) {
    await backend().catch(() => {});
    const to = params.get('to') === 'staff' ? 'staff' : '';
    history.replaceState(null, '', location.pathname + (to ? '#' + to : ''));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
boot();
