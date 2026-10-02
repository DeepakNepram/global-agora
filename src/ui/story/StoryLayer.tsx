import { useEffect, useId, useRef, useState, type JSX } from 'react';

import { reportStoryLocation, vec3ToLatLon, type NodeBuffer } from '@/core';
import type { OrbitGlobeControls } from '@/globe';
import {
  libraryStatus,
  onboardingStore,
  reportedStore,
  savedStore,
  storyStore,
  timeStore,
  useReportedStore,
  useSavedStore,
  useStoryStore,
  useTimeStore,
  wallClockNow,
} from '@/state';

import { nextAnnouncement } from '../announce';
import { PeekCard, type ShareState } from './PeekCard';
import { copyText, shareUrl } from './permalinkLink';
import { StoryDetails, type ReportState } from './StoryDetails';
import { StorySheet } from './StorySheet';
import { summarize } from './storySummary';
import { useStoryDetail } from './useStoryDetail';

export interface StoryLayerProps {
  /** The stories on the globe (for the card's fast fields and nearby stories). */
  readonly nodes: NodeBuffer | null;
  readonly controls: OrbitGlobeControls | null;
  /** AppConfig.apiBaseUrl. */
  readonly apiBaseUrl: string;
  /** AppConfig.savedStoryLimit: a tier boundary. */
  readonly savedStoryLimit: number;
  /** Live stories have details to fetch; dev mock pins do not (their ids are fake). */
  readonly detailsAvailable: boolean;
  readonly reducedMotion: boolean;
}

/** "Link copied" stays on the button this long. */
const COPIED_MS = 2000;

function focusGlobe(): void {
  document.querySelector<HTMLElement>('[aria-roledescription="globe"]')?.focus({
    preventScroll: true,
  });
}

/**
 * The open story: its sheet, what fills it, and what its buttons do. Story
 * state lives in storyStore, so the globe's taps, Enter and shared links all
 * open stories the same way.
 */
export function StoryLayer(props: StoryLayerProps): JSX.Element {
  const { nodes, controls, apiBaseUrl, savedStoryLimit, detailsAvailable, reducedMotion } = props;
  const selectedId = useStoryStore((state) => state.selectedId);
  const sheet = useStoryStore((state) => state.sheet);
  // Re-renders on each live tick (30 s), which keeps "3 h ago" current.
  const timeMs = useTimeStore((state) => state.timeMs);
  const detail = useStoryDetail(apiBaseUrl, selectedId, detailsAvailable);
  const saved = useSavedStore(
    (state) => selectedId !== null && state.stories.some((story) => story.id === selectedId),
  );
  const reported = useReportedStore(
    (state) => selectedId !== null && state.ids.includes(selectedId),
  );
  const [shared, setShared] = useState<{ id: number; state: ShareState } | null>(null);
  const [reporting, setReporting] = useState<{ id: number; state: ReportState } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const headlineId = useId();
  const copiedTimer = useRef(0);
  const wasOpenRef = useRef(false);

  const open = sheet !== 'closed';
  const nowMs = wallClockNow();
  const summary =
    selectedId === null
      ? null
      : summarize(nodes, selectedId, detail.status === 'ready' ? detail.detail : null);
  const share: ShareState = shared && shared.id === selectedId ? shared.state : { kind: 'idle' };
  const report: ReportState = reported
    ? 'sent'
    : reporting && reporting.id === selectedId
      ? reporting.state
      : 'idle';

  // The sheet focuses the headline on opening, so a screen reader starts
  // there; closing hands focus back to the globe, unless it already moved on.
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (open || !wasOpen) return;
    const active = document.activeElement;
    if (!active || active === document.body || active.closest('[data-story-sheet]')) focusGlobe();
  }, [open]);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const announce = (text: string): void =>
    setAnnouncement((previous) => nextAnnouncement(previous, text));

  const onSave = (): void => {
    if (!summary) return;
    const { id, headline, place, publishedAtMs } = summary;
    const result = savedStore
      .getState()
      .toggle({ id, headline, place, publishedAtMs }, savedStoryLimit);
    // The first save is a moment to offer the onboarding (Prompt 3.4).
    if (result === 'saved') onboardingStore.getState().show();
    announce(
      result === 'saved'
        ? libraryStatus.getState().mode === 'account'
          ? 'Saved to your account.'
          : 'Saved on this device.'
        : result === 'removed'
          ? 'Removed from saved.'
          : `Your saved list is full (${savedStoryLimit}). Remove one to save another.`,
    );
  };

  const onShare = (): void => {
    if (selectedId === null) return;
    const id = selectedId;
    const url = shareUrl(id, controls?.getState() ?? null, timeStore.getState().timeMs);
    void copyText(url).then((copied) => {
      if (!copied) {
        setShared({ id, state: { kind: 'manual', url } });
        announce('Copy the link below to share this view.');
        return;
      }
      setShared({ id, state: { kind: 'copied' } });
      announce('Link copied. It opens this story, at this moment, from this view.');
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setShared(null), COPIED_MS);
    });
  };

  // The discussion view is Prompt 4.5's; no discussion can open before then.
  const onDiscuss = (): void => announce('Discussions open here in a later update.');

  const onReport = (): void => {
    if (selectedId === null) return;
    const id = selectedId;
    setReporting({ id, state: 'sending' });
    reportStoryLocation({ baseUrl: apiBaseUrl, id, fetch: (url, init) => fetch(url, init) }).then(
      (counted) => {
        if (counted) reportedStore.getState().add(id);
        setReporting({ id, state: counted ? 'sent' : 'failed' });
        announce(counted ? 'Thanks. The wrong location was reported.' : 'This story is gone.');
      },
      () => {
        setReporting({ id, state: 'failed' });
        announce('The report could not be sent.');
      },
    );
  };

  const onNearby = (row: number): void => {
    if (!nodes) return;
    storyStore.getState().open(nodes.ids[row] ?? 0);
    if (!controls) return;
    const p = nodes.positions;
    const at = vec3ToLatLon({ x: p[row * 3] ?? 0, y: p[row * 3 + 1] ?? 0, z: p[row * 3 + 2] ?? 0 });
    void controls.flyTo(at.lat, at.lon, controls.getState().altitudeKm);
  };

  const story = storyStore.getState();
  return (
    <>
      <StorySheet
        state={sheet}
        reducedMotion={reducedMotion}
        labelledBy={headlineId}
        focusKey={selectedId}
        onRest={story.setSheet}
        onToggle={() => (sheet === 'full' ? story.collapse() : story.expand())}
        onClose={story.close}
        onEscape={story.collapse}
        details={
          selectedId !== null && (
            <StoryDetails
              detail={detail}
              nodes={nodes}
              row={summary?.row ?? -1}
              timeMs={timeMs}
              nowMs={nowMs}
              report={report}
              onReport={onReport}
              onNearby={onNearby}
              expanded={sheet === 'full'}
              announce={announce}
            />
          )
        }
      >
        <PeekCard
          summary={summary}
          gone={detail.status === 'gone'}
          loading={detail.status === 'loading'}
          nowMs={nowMs}
          headlineId={headlineId}
          saved={saved}
          share={share}
          onSave={onSave}
          onShare={onShare}
          onDiscuss={onDiscuss}
        />
      </StorySheet>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </>
  );
}
