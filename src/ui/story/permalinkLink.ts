import { useEffect, useRef } from 'react';

import {
  encodePermalink,
  historyRange,
  isEmptyPermalink,
  withFilters,
  withoutPermalink,
  type CameraView,
  type Permalink,
} from '@/core';
import { filterStore, storyStore, timeStore, wallClockNow } from '@/state';

/** The app's own address: share links point here, whatever path they were copied from. */
export function appBaseUrl(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}`;
}

/** The link for this view: the camera, the displayed instant, the open story and the filters. */
export function shareUrl(story: number, camera: CameraView | null, timeMs: number): string {
  const url = new URL(encodePermalink(appBaseUrl(), { story, camera, timeMs }));
  return `${url.origin}${url.pathname}${withFilters(url.search, filterStore.getState().filter)}`;
}

/** False when the browser refuses (no permission, an insecure origin). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Opens a shared link's view once, on load: the instant (held, as the sender
 * held it) and the story. The camera is not here: it is the controls' initial
 * pose, so the first frame is already the shared view.
 *
 * An instant older than the history window opens at its oldest, and the story
 * still loads from the API while it exists. Then the link's fields leave the
 * address bar, which should not go on claiming a view the reader has left.
 */
export function useOpenPermalink(link: Permalink, historyHours: number): void {
  const applied = useRef(false);

  useEffect(() => {
    if (applied.current || isEmptyPermalink(link)) return;
    applied.current = true;
    if (link.timeMs !== null) {
      const range = historyRange(wallClockNow(), historyHours);
      // A link from the future (a fast clock) is simply live.
      if (link.timeMs < range.endMs) {
        timeStore.getState().setTime(Math.max(link.timeMs, range.startMs));
      }
    }
    if (link.story !== null) storyStore.getState().open(link.story);
    const { pathname, search, hash } = window.location;
    window.history.replaceState(
      window.history.state,
      '',
      `${pathname}${withoutPermalink(search)}${hash}`,
    );
  }, [link, historyHours]);
}
