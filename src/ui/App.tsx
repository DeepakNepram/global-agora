import { useMemo, useState, type JSX } from 'react';

import { decodePermalink, type AppConfig, type AuthProvider } from '@/core';
import type { DbConfig } from '@/core/db/config';
import { LEGAL_PAGES } from '@/core/legal/site';
import type { LegalSite } from '@/core/legal/types';
import { useDocumentStore } from '@/state';

import { useAccountSession } from './data/useAccountSession';
import { useConnectivity } from './data/useConnectivity';
import { useNodesFeed } from './data/useNodesFeed';
import { useAnyModalOpen } from './focus/useModal';
import { GlobeNotice } from './globe/GlobeNotice';
import { usePrefersReducedMotion } from './globe/usePrefersReducedMotion';
import { DocLink } from './legal/DocLink';
import { DocumentSheet } from './legal/DocumentSheet';
import { NewsStatus } from './NewsStatus';
import { NewsView } from './NewsView';
import { OfflineBanner } from './OfflineBanner';
import { resolveQuality } from './platform/capabilities';
import { UpdateNotice } from './UpdateNotice';

export interface AppProps {
  readonly config: AppConfig;
  /** Supabase, for accounts and a signed-in reader's library; null runs without a backend. */
  readonly dbConfig?: DbConfig | null;
  /** The ways to sign in this build offers (VITE_AUTH_PROVIDERS). */
  readonly authProviders?: readonly AuthProvider[];
  /** Who runs the service, for the documents (VITE_OPERATOR_NAME…). */
  readonly site: LegalSite;
}

/** 24 px tall at least: a touch target (WCAG 2.5.8). */
const FOOTER_LINK =
  'inline-flex min-h-6 items-center text-muted underline-offset-2 hover:text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

/**
 * App shell: skip link, header (with the alpha's About link), the news
 * (globe, map or list), the documents' links in the footer, and the sheet
 * they open in (Prompt 5.2). The tier the device was given is on the root's
 * data attributes, for checks in a real browser.
 */
export function App({ config, dbConfig = null, authProviders = [], site }: AppProps): JSX.Element {
  // Probing creates and discards a GL context, so do it once per mount.
  const quality = useMemo(() => resolveQuality(), []);
  // Read once: the globe applies it and then clears it from the address bar.
  const [link] = useState(() => decodePermalink(window.location.search));
  useAccountSession(dbConfig);
  useConnectivity();
  // Behind a modal (a discussion, an account sheet) the page around the news is
  // inert; behind a document, the news too.
  const reading = useDocumentStore((state) => state.open !== null);
  const modal = useAnyModalOpen() || reading;
  const reducedMotion = usePrefersReducedMotion();
  useNodesFeed({
    baseUrl: config.apiBaseUrl,
    hours: config.historyWindowHours,
    refreshSeconds: config.payloadRefreshSeconds,
  });

  return (
    <div
      className="flex h-full flex-col bg-void text-ink"
      data-quality-tier={quality.tier}
      data-quality-reason={quality.reason}
    >
      <a
        inert={modal}
        href="#globe"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-void"
      >
        Skip to the news
      </a>

      <header inert={modal}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-6 py-4">
          <h1 className="text-lg font-semibold tracking-tight">Global Agora</h1>
          <span className="rounded-full border border-accent px-2 text-xs font-medium text-accent">
            Alpha
          </span>
          <DocLink doc="about" className={`${FOOTER_LINK} text-sm`}>
            About
          </DocLink>
          <NewsStatus />
          <UpdateNotice />
        </div>
        <OfflineBanner />
        <GlobeNotice webgl={quality.webgl} />
      </header>

      <main
        id="globe"
        tabIndex={-1}
        aria-label="News"
        inert={reading}
        className="relative min-h-0 flex-1"
      >
        <NewsView
          tier={quality.tier}
          historyWindowHours={config.historyWindowHours}
          apiBaseUrl={config.apiBaseUrl}
          savedStoryLimit={config.savedStoryLimit}
          link={link}
          authProviders={dbConfig === null ? null : authProviders}
          webgl={quality.webgl}
        />
      </main>

      <footer inert={modal} className="px-6 py-3 text-xs">
        <nav aria-label="About, rules and policies">
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {LEGAL_PAGES.map((page) => (
              <li key={page.id}>
                <DocLink doc={page.id} className={FOOTER_LINK}>
                  {page.title}
                </DocLink>
              </li>
            ))}
          </ul>
        </nav>
      </footer>

      <DocumentSheet site={site} reducedMotion={reducedMotion} />
    </div>
  );
}
