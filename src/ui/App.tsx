import { useMemo, useState, type JSX } from 'react';

import { decodePermalink, type AppConfig, type AuthProvider } from '@/core';
import type { DbConfig } from '@/core/db/config';

import { useAccountSession } from './data/useAccountSession';
import { useNodesFeed } from './data/useNodesFeed';
import { useAnyModalOpen } from './focus/useModal';
import { NewsStatus } from './NewsStatus';
import { NewsView } from './NewsView';
import { resolveQuality } from './platform/capabilities';
import { UpdateNotice } from './UpdateNotice';

export interface AppProps {
  readonly config: AppConfig;
  /** Supabase, for accounts and a signed-in reader's library; null runs without a backend. */
  readonly dbConfig?: DbConfig | null;
  /** The ways to sign in this build offers (VITE_AUTH_PROVIDERS). */
  readonly authProviders?: readonly AuthProvider[];
}

/**
 * App shell: skip link, header, the news (globe, map or list), and a readout of the detected quality
 * tier so the texture choice is verifiable in a real browser rather than only in
 * unit tests.
 */
export function App({ config, dbConfig = null, authProviders = [] }: AppProps): JSX.Element {
  // Probing creates and discards a GL context, so do it once per mount.
  const quality = useMemo(() => resolveQuality(), []);
  // Read once: the globe applies it and then clears it from the address bar.
  const [link] = useState(() => decodePermalink(window.location.search));
  useAccountSession(dbConfig);
  // Behind a modal (a discussion, an account sheet) the page around the news is inert.
  const modal = useAnyModalOpen();
  useNodesFeed({
    baseUrl: config.apiBaseUrl,
    hours: config.historyWindowHours,
    refreshSeconds: config.payloadRefreshSeconds,
  });

  return (
    <div className="flex h-full flex-col bg-void text-ink">
      <a
        inert={modal}
        href="#globe"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-void"
      >
        Skip to the news
      </a>

      <header inert={modal} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Global Agora</h1>
        <p className="text-sm text-muted">Preview. Pins are news stories from GDELT.</p>
        <NewsStatus />
        <UpdateNotice />
      </header>

      <main id="globe" tabIndex={-1} aria-label="News" className="relative min-h-0 flex-1">
        <NewsView
          tier={quality.tier}
          historyWindowHours={config.historyWindowHours}
          apiBaseUrl={config.apiBaseUrl}
          savedStoryLimit={config.savedStoryLimit}
          link={link}
          authProviders={dbConfig === null ? null : authProviders}
        />
      </main>

      <footer inert={modal} className="px-6 py-3 text-xs text-muted">
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
