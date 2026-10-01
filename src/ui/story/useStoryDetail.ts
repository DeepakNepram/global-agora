import { useEffect, useState } from 'react';

import { fetchStory, StoryGoneError, type StoryDetail } from '@/core';

/** Stories kept after their sheet closes, so reopening one is instant. */
const CACHE_SIZE = 20;

/**
 * How often an open sheet re-asks for a story whose discussion is open, for
 * the participant count. The API caches a story for 60 s and the browser
 * honours that, so most re-asks never leave the device.
 */
export const PARTICIPANTS_REFRESH_MS = 30_000;

const cache = new Map<number, StoryDetail>();

function remember(detail: StoryDetail): void {
  cache.delete(detail.id);
  cache.set(detail.id, detail);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as number);
}

export type DetailState =
  /** No story, or one with no details to fetch (a mock pin). */
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly detail: StoryDetail }
  /** Pruned after retention, or never existed. */
  | { readonly status: 'gone' }
  | { readonly status: 'error'; readonly retry: () => void };

interface Loaded {
  readonly id: number;
  readonly attempt: number;
  readonly detail?: StoryDetail;
  readonly failure?: 'gone' | 'error';
}

/**
 * The open story in full, from GET /api/story/:id. Switching stories aborts
 * the request in flight; a failed refresh keeps what was already shown.
 */
export function useStoryDetail(baseUrl: string, id: number | null, enabled: boolean): DetailState {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (id === null || !enabled) return;
    const controller = new AbortController();
    let timer = 0;
    const load = (): void => {
      fetchStory({
        baseUrl,
        id,
        fetch: (url, init) => fetch(url, init),
        signal: controller.signal,
      }).then(
        (detail) => {
          remember(detail);
          setLoaded({ id, attempt, detail });
          if (detail.discussion.state === 'open') {
            timer = window.setTimeout(load, PARTICIPANTS_REFRESH_MS);
          }
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          // A refresh that fails leaves the story as it was shown.
          if (cache.has(id) && !(error instanceof StoryGoneError)) return;
          cache.delete(id);
          setLoaded({ id, attempt, failure: error instanceof StoryGoneError ? 'gone' : 'error' });
        },
      );
    };
    load();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [baseUrl, id, enabled, attempt]);

  if (id === null || !enabled) return { status: 'idle' };
  if (loaded?.id === id && loaded.attempt === attempt) {
    if (loaded.detail) return { status: 'ready', detail: loaded.detail };
    if (loaded.failure === 'gone') return { status: 'gone' };
    if (loaded.failure === 'error')
      return { status: 'error', retry: () => setAttempt((n) => n + 1) };
  }
  const cached = cache.get(id);
  return cached ? { status: 'ready', detail: cached } : { status: 'loading' };
}
