import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/ui';
import { resolveConfig } from '@/core';
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

createRoot(container).render(
  <StrictMode>
    <App config={config} dbConfig={dbConfig} />
  </StrictMode>,
);
