import { useEffect, useRef, useState } from 'react';

import type { OrbitGlobeControls } from '@/globe';

import type { DetailState } from '../story/useStoryDetail';
import { enterDiscussion } from './enterDiscussion';
import { preloadDiscussion } from './loadDiscussion';

export interface DiscussButtonOptions {
  /** The peek card is showing a story whose discussion is open. */
  readonly discussionOpen: boolean;
  readonly selectedId: number | null;
  readonly detail: DetailState;
  /** The globe's controls while the globe is on screen; null in the list or on the flat map. */
  readonly controls: OrbitGlobeControls | null;
  readonly reducedMotion: boolean;
  readonly announce: (text: string) => void;
}

export interface DiscussButton {
  /** Discuss was pressed and the discussion is on its way. */
  readonly opening: boolean;
  readonly onDiscuss: () => void;
}

const COULD_NOT_OPEN = 'The discussion could not be opened. Try again.';

/**
 * What the peek card's Discuss does (Prompt 4.5). While an open discussion
 * is on show, its panel and the SDK load at idle; a press waits for the
 * story's details (they carry the uuid that keys the discussion) and then
 * enters, so nothing loads in the middle of the transition.
 */
export function useDiscussButton(options: DiscussButtonOptions): DiscussButton {
  const { discussionOpen, selectedId, detail, controls, reducedMotion, announce } = options;
  const [opening, setOpening] = useState<number | null>(null);
  const enteringFor = useRef<number | null>(null);
  const announceRef = useRef(announce);

  useEffect(() => {
    announceRef.current = announce;
  });

  useEffect(() => {
    if (discussionOpen) preloadDiscussion();
  }, [discussionOpen]);

  useEffect(() => {
    if (opening === null || enteringFor.current === opening) return;
    if (opening !== selectedId) {
      setOpening(null);
    } else if (detail.status === 'ready' && detail.detail.id === opening) {
      enteringFor.current = opening;
      const story = detail.detail;
      enterDiscussion({
        storySeq: story.id,
        storyId: story.uuid,
        city: { lat: story.place.lat, lon: story.place.lon },
        controls,
        reducedMotion,
      })
        .catch(() => announceRef.current(COULD_NOT_OPEN))
        .finally(() => {
          enteringFor.current = null;
          setOpening(null);
        });
    } else if (detail.status === 'gone' || detail.status === 'error') {
      setOpening(null);
      announceRef.current(COULD_NOT_OPEN);
    }
  }, [opening, selectedId, detail, controls, reducedMotion]);

  return {
    opening: opening !== null,
    onDiscuss: () => {
      if (selectedId !== null && opening === null) setOpening(selectedId);
    },
  };
}
