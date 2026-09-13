import { useMemo, type JSX } from 'react';

import type { AppConfig } from '@/core';

import { GlobeCanvas } from './GlobeCanvas';
import { resolveQuality } from './platform/capabilities';

export interface AppProps {
  readonly config: AppConfig;
}

/**
 * App shell: skip link, header, the globe, and a readout of the detected quality
 * tier so the texture choice is verifiable in a real browser rather than only in
 * unit tests.
 */
export function App({ config }: AppProps): JSX.Element {
  // Probing creates and discards a GL context, so do it once per mount.
  const quality = useMemo(() => resolveQuality(), []);

  return (
    <div className="flex h-full flex-col bg-void text-ink">
      <a
        href="#globe"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-void"
      >
        Skip to globe
      </a>

      <header className="flex items-baseline gap-3 px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Global Agora</h1>
        <p className="text-sm text-muted">
          Phase 1 — base Earth. Last {config.historyWindowHours}h of news lands here.
        </p>
      </header>

      <main id="globe" tabIndex={-1} aria-label="News globe" className="relative min-h-0 flex-1">
        <GlobeCanvas tier={quality.tier} />
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
