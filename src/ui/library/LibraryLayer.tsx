import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';

import type { NodeBuffer } from '@/core';
import { panelStore, storyStore, usePanelStore } from '@/state';

import { nextAnnouncement } from '../announce';
import { openStoryOnGlobe, type GlobeTarget } from '../nav/globeNavigation';
import { FollowingPanel } from './FollowingPanel';
import { LibrarySheet } from './LibrarySheet';
import { SavedPanel } from './SavedPanel';

export interface LibraryLayerProps {
  readonly nodes: NodeBuffer | null;
  readonly target: GlobeTarget;
  /** AppConfig.historyWindowHours. */
  readonly historyHours: number;
  /** AppConfig.savedStoryLimit. */
  readonly savedStoryLimit: number;
  readonly reducedMotion: boolean;
}

/**
 * The library over the globe: the Following and Saved tabs in one sheet,
 * which never shares the screen with a story's. Opening it closes the story;
 * opening a story (from a list or the globe) closes it. Closing hands focus
 * back to whatever opened it.
 */
export default function LibraryLayer(props: LibraryLayerProps): JSX.Element {
  const { nodes, target, historyHours, savedStoryLimit, reducedMotion } = props;
  const panel = usePanelStore((state) => state.panel);
  const [announcement, setAnnouncement] = useState('');
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  const announce = (text: string): void =>
    setAnnouncement((previous) => nextAnnouncement(previous, text));

  // A layout effect, so the opener is read before the sheet's own (passive)
  // effect moves focus to its tab.
  useLayoutEffect(() => {
    const open = panel !== null;
    if (open && !wasOpen.current) {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement ? active : null;
      storyStore.getState().close();
    } else if (!open && wasOpen.current && storyStore.getState().sheet === 'closed') {
      const active = document.activeElement;
      if (!active || active === document.body || active.closest('[data-library-sheet]')) {
        opener.current?.focus({ preventScroll: true });
      }
    }
    wasOpen.current = open;
  }, [panel]);

  // A story opened from the globe while the library is up takes the screen.
  useEffect(
    () =>
      storyStore.subscribe((state, previous) => {
        if (state.sheet !== 'closed' && previous.sheet === 'closed') panelStore.getState().close();
      }),
    [],
  );

  const onOpenStory = (id: number): void => {
    panelStore.getState().close();
    openStoryOnGlobe(target, nodes, id);
  };

  return (
    <>
      <LibrarySheet
        panel={panel}
        reducedMotion={reducedMotion}
        onTab={(next) => panelStore.getState().open(next)}
        onClose={() => panelStore.getState().close()}
        following={
          <FollowingPanel
            nodes={nodes}
            historyHours={historyHours}
            onOpenStory={onOpenStory}
            announce={announce}
          />
        }
        saved={<SavedPanel limit={savedStoryLimit} onOpenStory={onOpenStory} announce={announce} />}
      />
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </>
  );
}
