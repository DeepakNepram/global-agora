import type { JSX } from 'react';

import { panelStore, usePanelStore, type LibraryPanel } from '@/state';

const BUTTON =
  'flex h-10 shrink-0 items-center justify-center gap-2 rounded-full border border-ink/20 bg-panel/90 px-4 text-sm font-medium text-ink hover:bg-white/10 max-sm:size-11 max-sm:px-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-expanded:border-accent aria-expanded:text-accent';

function FollowingIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 shrink-0 fill-none stroke-current"
    >
      <path d="M3 3.5h10M3 8h10M3 12.5h6" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SavedIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 shrink-0 fill-none stroke-current"
    >
      <path d="M4 2.5h8v11l-4-2.8-4 2.8z" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Following and Saved, at the end of the search row. On a phone they are
 * 44 px icons; their names stay in the accessible name. Each opens the
 * library on its tab, or closes it if that tab is showing.
 */
export function LibraryButtons(): JSX.Element {
  const panel = usePanelStore((state) => state.panel);
  const toggle = (target: LibraryPanel): void => {
    const store = panelStore.getState();
    if (store.panel === target) store.close();
    else store.open(target);
  };

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={panel === 'following'}
        onClick={() => toggle('following')}
        className={BUTTON}
      >
        <FollowingIcon />
        <span className="max-sm:sr-only">Following</span>
      </button>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={panel === 'saved'}
        onClick={() => toggle('saved')}
        className={BUTTON}
      >
        <SavedIcon />
        <span className="max-sm:sr-only">Saved</span>
      </button>
    </>
  );
}
