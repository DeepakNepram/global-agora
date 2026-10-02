import { useMemo, useState, type JSX } from 'react';

import { decodePermalink, type AppConfig } from '@/core';
import type { DbConfig } from '@/core/db/config';

import { useAccountSession } from './data/useAccountSession';
import { useNodesFeed } from './data/useNodesFeed';
import { GlobeCanvas } from './GlobeCanvas';
import { NewsStatus } from './NewsStatus';
import { resolveQuality } from './platform/capabilities';

export interface AppProps {
  readonly config: AppConfig;
  /** Supabase, for a signed-in reader's library; null runs without a backend. */
  readonly dbConfig?: DbConfig | null;
}

/**
 * App shell: skip link, header, the globe, and a readout of the detected quality
 * tier so the texture choice is verifiable in a real browser rather than only in
 * unit tests.
 */
export function App({ config, dbConfig = null }: AppProps): JSX.Element {
  // Probing creates and discards a GL context, so do it once per mount.
  const quality = useMemo(() => resolveQuality(), []);
  // Read once: the globe applies it and then clears it from the address bar.
  const [link] = useState(() => decodePermalink(window.location.search));
  useAccountSession(dbConfig);
  useNodesFeed({
    baseUrl: config.apiBaseUrl,
    hours: config.historyWindowHours,
    refreshSeconds: config.payloadRefreshSeconds,
  });

  return (
    <div className="flex h-full flex-col bg-void text-ink">
      <a
        href="#globe"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-void"
      >
        Skip to globe
      </a>

      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Global Agora</h1>
        <p className="text-sm text-muted">Preview. Pins are news stories from GDELT.</p>
        <NewsStatus />
      </header>

      <main id="globe" tabIndex={-1} aria-label="News globe" className="relative min-h-0 flex-1">
        <GlobeCanvas
          tier={quality.tier}
          historyWindowHours={config.historyWindowHours}
          apiBaseUrl={config.apiBaseUrl}
          savedStoryLimit={config.savedStoryLimit}
          link={link}
        />
      </main>

      <footer className="px-6 py-3 text-xs text-muted">
        <dl className="flex flex-wrap gap-x-6 gap-y-1">
          <div className="flex gap-2">
            <dt>Quality tier</dt>
            <dd data-testid="quality-tier" className="text-ink">
              {quality.tier}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt>Reason</dt>
            <dd className="text-ink">{quality.reason}</dd>
          </div>
        </dl>
      </footer>
    </div>
  );
}
