import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/ui';
import { AppErrorBoundary } from '@/ui/AppErrorBoundary';
import { reportError, startErrorReporting } from '@/ui/platform/errorReporting';
import { registerServiceWorker } from '@/ui/platform/serviceWorker';
import { authProvidersFromEnv, resolveConfig } from '@/core';
// The Supabase settings without the SDK: it loads only for a signed-in reader.
import { dbConfigFromEnv } from '@/core/db/config';
import { legalSiteFromEnv } from '@/core/legal/site';

import './ui/styles/index.css';

// Config is resolved once at the composition root and passed down. src/core never
// reads import.meta.env itself, so the same core code runs under a native shell.
const env = import.meta.env as unknown as Record<string, string | undefined>;

// Before the app renders (Prompt 5.2). Production builds with a DSN only.
startErrorReporting({
  dsn: import.meta.env.PROD ? env['VITE_SENTRY_DSN']?.trim() || null : null,
  release: __APP_RELEASE__,
  environment: import.meta.env.MODE,
});

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root is missing from index.html');
}

const config = resolveConfig(env);
const dbConfig = dbConfigFromEnv(env);
const authProviders = authProvidersFromEnv(env);
const site = legalSiteFromEnv(env);

/** Render errors, caught by a boundary or not, go to the console and to Sentry alike. */
function onRenderError(
  error: unknown,
  info: { readonly componentStack?: string | undefined },
): void {
  console.error(error);
  reportError(error, { componentStack: info.componentStack ?? '' });
}

const root = createRoot(container, {
  onUncaughtError: onRenderError,
  onCaughtError: onRenderError,
});
const path = window.location.pathname;

// The offline shell (Prompt 5.2), installed once the page has started.
registerServiceWorker();

if (path === '/admin' || path.startsWith('/admin/')) {
  // The admin pages (Prompt 4.3, 4.6) in their own chunk, instead of the globe:
  // a reader's start never pays for them.
  import('./ui/admin/AdminApp').then(
    ({ AdminApp }) =>
      root.render(
        <StrictMode>
          <AppErrorBoundary>
            <AdminApp dbConfig={dbConfig} />
          </AppErrorBoundary>
        </StrictMode>,
      ),
    // Offline, or a deploy replaced the chunk under an old page.
    () =>
      root.render(
        <p className="p-6 text-sm text-ink">
          The admin console could not load. Check the connection, then reload.
        </p>,
      ),
  );
} else if (path === '/' || path === '/index.html') {
  root.render(
    <StrictMode>
      <AppErrorBoundary>
        <App config={config} dbConfig={dbConfig} authProviders={authProviders} site={site} />
      </AppErrorBoundary>
    </StrictMode>,
  );
} else {
  // The documents' pages (/privacy, /terms…) and "Page not found" for any
  // other path, in their own chunk (Prompt 5.2).
  import('./ui/pages/PagesApp').then(
    ({ PagesApp }) =>
      root.render(
        <StrictMode>
          <AppErrorBoundary>
            <PagesApp path={path} site={site} />
          </AppErrorBoundary>
        </StrictMode>,
      ),
    () =>
      root.render(
        <p className="p-6 text-sm text-ink">
          This page could not load. Check the connection, then reload.
        </p>,
      ),
  );
}
