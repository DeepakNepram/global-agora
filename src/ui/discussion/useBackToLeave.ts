import { useEffect } from 'react';

import { discussionStage } from './stage';

const MARKER = 'agoraDiscussion';

function ours(state: unknown): boolean {
  return typeof state === 'object' && state !== null && MARKER in state;
}

/**
 * Android's Back (and the browser's) leaves the discussion rather than the
 * app. Entering pushes a history entry at the same address; Back pops it and
 * leaves. Leaving any other way takes the entry back off, so history is as
 * it was.
 */
export function useBackToLeave(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const base: object =
      typeof window.history.state === 'object' && window.history.state !== null
        ? (window.history.state as object)
        : {};
    window.history.pushState({ ...base, [MARKER]: true }, '');
    let popped = false;
    const onPop = (): void => {
      popped = true;
      discussionStage.leave();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!popped && ours(window.history.state)) window.history.back();
    };
  }, [active]);
}
