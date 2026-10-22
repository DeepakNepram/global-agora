import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';

import type { DbConfig } from '@/core/db';
import { wallClockNow } from '@/state';
// Directly, not through the barrel: only this chunk carries the console.
import { useConsoleStore } from '@/state/adminConsoleStore';
import { useLocationsStore } from '@/state/adminLocations';
import { useQueueStore } from '@/state/moderationQueue';

import { PRIMARY, QUIET, SECONDARY } from '../account/accountStyles';
import { createAdminControllers } from './adminControllers';
import { AdminTabs } from './AdminTabs';
import { ADMIN_TABS, panelId, tabForPath, tabId, type AdminTab } from './adminView';
import { CountersBar } from './CountersBar';
import { LocationsTab } from './LocationsTab';
import { ModerationTab } from './ModerationTab';
import { StoryQueue } from './StoryQueue';

export interface AdminAppProps {
  readonly dbConfig: DbConfig | null;
}

const LINK = 'text-accent underline underline-offset-2';
/** The clock the page's "3 h ago" and "closes in" read; a minute is fine-grained enough. */
const CLOCK_TICK_MS = 30_000;

/**
 * /admin (Prompts 4.3 and 4.6): the counters, then three tabs: the hot story
 * queue with one-click opening, the moderation queue, and the location
 * correction tool. Plain and keyboard-first: built to be fast at 8am. Loaded
 * instead of the globe, in its own chunk; the database says who may use it.
 */
export function AdminApp({ dbConfig }: AdminAppProps): JSX.Element {
  const access = useConsoleStore((state) => state.access);
  const handle = useConsoleStore((state) => state.handle);
  const counters = useConsoleStore((state) => state.counters);
  const storyCount = useConsoleStore((state) => state.stories.length);
  const storiesReady = useConsoleStore((state) => state.storiesStatus === 'ready');
  const queueCount = useQueueStore((state) =>
    state.status === 'ready' ? state.items.length : null,
  );
  const locationCount = useLocationsStore((state) =>
    state.status === 'ready' ? state.items.length : null,
  );
  const [tab, setTab] = useState<AdminTab>(() => tabForPath(window.location.pathname));
  const [nowMs, setNowMs] = useState(wallClockNow);
  const controllers = useMemo(
    () => (dbConfig === null ? null : createAdminControllers(dbConfig)),
    [dbConfig],
  );

  useEffect(() => {
    void controllers?.console.start();
  }, [controllers]);

  useEffect(() => {
    const label = ADMIN_TABS.find((entry) => entry.id === tab)?.label ?? 'Admin';
    document.title = `${label} · Admin · Global Agora`;
  }, [tab]);

  // Back and Forward move between tabs; each tab has its own path.
  useEffect(() => {
    const onPop = (): void => setTab(tabForPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Coming back to the page (the next morning, say): fresh numbers and stories.
  useEffect(() => {
    const tick = window.setInterval(() => setNowMs(wallClockNow()), CLOCK_TICK_MS);
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return;
      setNowMs(wallClockNow());
      void controllers?.console.refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [controllers]);

  const select = useCallback((next: AdminTab) => {
    setTab(next);
    const path = ADMIN_TABS.find((entry) => entry.id === next)?.path ?? '/admin';
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
  }, []);

  let content: JSX.Element;
  if (controllers === null) {
    content = <p className="text-sm text-muted">This build has no backend, so nothing to run.</p>;
  } else if (access === 'loading') {
    content = <p className="text-sm text-muted">Checking who is here…</p>;
  } else if (access === 'signed-out') {
    content = (
      <p className="text-sm text-muted">
        Sign in on the{' '}
        <a href="/" className={LINK}>
          globe
        </a>{' '}
        first, then come back here.
      </p>
    );
  } else if (access === 'not-admin') {
    content = <p className="text-sm text-muted">This page is for moderators.</p>;
  } else if (access === 'unreachable') {
    content = (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-muted">The console could not be reached.</p>
        <button type="button" className={PRIMARY} onClick={() => void controllers.console.start()}>
          Try again
        </button>
      </div>
    );
  } else {
    content = (
      <>
        <CountersBar counters={counters} />
        <AdminTabs
          tab={tab}
          counts={{
            ...(storiesReady ? { stories: storyCount } : {}),
            ...(queueCount === null ? {} : { moderation: queueCount }),
            ...(locationCount === null ? {} : { locations: locationCount }),
          }}
          onSelect={select}
        />
        <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)}>
          {tab === 'stories' && <StoryQueue controller={controllers.console} nowMs={nowMs} />}
          {tab === 'moderation' && <ModerationTab controller={controllers.queue} nowMs={nowMs} />}
          {tab === 'locations' && <LocationsTab controller={controllers.locations} nowMs={nowMs} />}
        </div>
      </>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-void text-ink">
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted">Global Agora</p>
            <h1 className="text-xl font-semibold">Admin console</h1>
            {handle !== null && <p className="text-xs text-muted">Signed in as @{handle}</p>}
          </div>
          <div className="flex gap-2">
            {access === 'ready' && controllers !== null && (
              <button
                type="button"
                className={SECONDARY}
                onClick={() => {
                  setNowMs(wallClockNow());
                  void controllers.console.refresh();
                  if (tab === 'moderation') void controllers.queue.refresh();
                  if (tab === 'locations') void controllers.locations.load();
                }}
              >
                Refresh
              </button>
            )}
            <a href="/" className={`${QUIET} inline-flex items-center`}>
              Back to the globe
            </a>
          </div>
        </header>
        {content}
      </main>
    </div>
  );
}
