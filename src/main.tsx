import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/ui';
import { registerServiceWorker } from '@/ui/platform/serviceWorker';
import { authProvidersFromEnv, resolveConfig } from '@/core';
// The Supabase settings without the SDK: it loads only for a signed-in reader.
import { dbConfigFromEnv } from '@/core/db/config';

import './ui/styles/index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root is missing from index.html');
}

// Config is resolved once at the composition root and passed down. src/core never
// reads import.meta.env itself, so the same core code runs under a native shell.
const env = import.meta.env as unknown as Record<string, string | undefined>;
const config = resolveConfig(env);
const dbConfig = dbConfigFromEnv(env);
const authProviders = authProvidersFromEnv(env);

const root = createRoot(container);
const path = window.location.pathname;

// The offline shell (Prompt 5.2), installed once the page has started.
registerServiceWorker();

if (path === '/admin' || path.startsWith('/admin/')) {
  // The admin pages (Prompt 4.3, 4.6) in their own chunk, instead of the globe:
  // a reader's start never pays for them.
  void import('./ui/admin/AdminApp').then(({ AdminApp }) =>
    root.render(
      <StrictMode>
        <AdminApp dbConfig={dbConfig} />
      </StrictMode>,
    ),
  );
} else {
  root.render(
    <StrictMode>
      <App config={config} dbConfig={dbConfig} authProviders={authProviders} />
    </StrictMode>,
  );
}
