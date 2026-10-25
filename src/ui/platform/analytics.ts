import {
  analyticsAllowed,
  COHORT_KEY,
  durationBucket,
  parseCohort,
  POST_MADE_EVENT,
  weekActive,
  type AnalyticsEvent,
  type CohortRecord,
} from '@/core';
import {
  analyticsConsentStore,
  discussionStageStore,
  monotonicNowMs,
  storyStore,
  wallClockNow,
} from '@/state';

/**
 * The six measures (Prompt 5.2, src/core/analytics.ts), sent to our own
 * API Worker, which passes them to Umami without the reader's IP. A session
 * is a stretch with the app on screen: it ends, and is counted, when the app
 * leaves the screen.
 *
 * Off in development and test builds, when the browser sends Global Privacy
 * Control or Do Not Track, and when the reader turns "Count my visits" off
 * on the privacy page.
 */

/** Shorter stretches on screen are a glance or a tab switch, not a session. */
const MIN_SESSION_MS = 3000;

let sendEvent: ((event: AnalyticsEvent) => void) | null = null;
let scrubbed = false;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function browserSignals(): { globalPrivacyControl: boolean; doNotTrack: boolean } {
  const nav = navigator as Navigator & { readonly globalPrivacyControl?: boolean };
  return {
    globalPrivacyControl: nav.globalPrivacyControl === true,
    doNotTrack: nav.doNotTrack === '1',
  };
}

/** The browser asks sites not to track it: nothing is counted, whatever the switch says. */
export function analyticsBlockedByBrowser(): boolean {
  const { globalPrivacyControl, doNotTrack } = browserSignals();
  return globalPrivacyControl || doNotTrack;
}

/** The scrubber's own input says it was used (a drag, a key or Play), once a session. */
export function noteScrubberUsed(): void {
  if (scrubbed || sendEvent === null) return;
  scrubbed = true;
  sendEvent({ name: 'scrubber_used' });
}

function readCohort(store: Storage | null): CohortRecord | null {
  try {
    return parseCohort(JSON.parse(store?.getItem(COHORT_KEY) ?? 'null'));
  } catch {
    return null;
  }
}

function countWeek(send: (event: AnalyticsEvent) => void): void {
  const store = storage();
  const stored = readCohort(store);
  const { event, store: next } = weekActive(stored, wallClockNow());
  try {
    store?.setItem(COHORT_KEY, JSON.stringify(next));
  } catch {
    // Not kept: next time counts as a first visit, which only undercounts returns.
  }
  if (event) send(event);
}

/** At the start, in production builds; `endpoint` is the API's /event. */
export function startAnalytics(endpoint: string): void {
  if (!import.meta.env.PROD || import.meta.env.MODE !== 'production') return;
  const optedOut = (): boolean => !analyticsConsentStore.getState().counting;
  const allowed = analyticsAllowed({ ...browserSignals(), optedOut: optedOut() });
  if (!allowed || sendEvent !== null) return;

  const send = (event: AnalyticsEvent): void => {
    // Turned off on the privacy page since the start: nothing more.
    if (optedOut()) return;
    fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
      // So a session's end still goes as the page is closed.
      keepalive: true,
    }).catch(() => undefined);
  };
  sendEvent = send;

  let shownAt: number | null = null;
  const begin = (): void => {
    shownAt = monotonicNowMs();
    scrubbed = false;
    countWeek(send);
  };
  if (document.visibilityState === 'visible') begin();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (shownAt === null) begin();
      return;
    }
    if (shownAt === null) return;
    const onScreen = monotonicNowMs() - shownAt;
    shownAt = null;
    if (onScreen >= MIN_SESSION_MS) {
      send({ name: 'session_end', data: { duration: durationBucket(onScreen) } });
    }
  });

  storyStore.subscribe((now, before) => {
    if (now.selectedId !== null && now.selectedId !== before.selectedId && now.sheet !== 'closed') {
      send({ name: 'story_opened' });
    }
  });
  discussionStageStore.subscribe((now, before) => {
    if (before.phase === 'closed' && now.phase !== 'closed') send({ name: 'discussion_entered' });
  });
  // From the discussion panel's chunk, which shares no module with this one.
  window.addEventListener(POST_MADE_EVENT, () => send({ name: 'post_made' }));
}
