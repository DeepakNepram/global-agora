import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/ui';
import { resolveConfig } from '@/core';

import './ui/styles/index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root is missing from index.html');
}

// Config is resolved once at the composition root and passed down. src/core never
// reads import.meta.env itself, so the same core code runs under a native shell.
const config = resolveConfig(import.meta.env as unknown as Record<string, string | undefined>);

createRoot(container).render(
  <StrictMode>
    <App config={config} />
  </StrictMode>,
);
