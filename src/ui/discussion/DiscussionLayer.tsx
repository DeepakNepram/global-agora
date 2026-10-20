import { useEffect, useId, useLayoutEffect, useRef, useState, type JSX } from 'react';

import { discussionStageStore, storyStore, useDiscussionStage } from '@/state';

import { takeDiscussionOpener } from './enterDiscussion';
import { loadedDiscussionPanel } from './loadDiscussion';
import { discussionStage } from './stage';
import { stageLayout } from './stageMotion';
import { useBackToLeave } from './useBackToLeave';
import { usePanelMotion } from './usePanelMotion';
import { useStageDrag } from './useStageDrag';

export interface DiscussionLayerProps {
  /** The LOW tier has no composer to blur with; a scrim dims the globe instead. */
  readonly scrim: boolean;
}

const ICON_BUTTON =
  'grid size-11 place-items-center rounded-full text-muted hover:bg-white/10 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

/**
 * The discussion's panel over the receded globe (Prompt 4.5): the bottom
 * two-thirds on a phone, the right side on a tablet or desktop.
 *
 * - A modal dialog named by the debate prompt; the globe and the sheets are
 *   inert behind it (GlobeLayers), the account's sheets stay above it.
 * - It leaves by ✕, Escape, Back, a drag down, or a click on the globe.
 * - Always mounted, off screen and inert when closed, so its motion has an
 *   element from the very first frame. Opaque, no backdrop blur (1.5).
 */
export function DiscussionLayer({ scrim }: DiscussionLayerProps): JSX.Element {
  const phase = useDiscussionStage((state) => state.phase);
  const target = useDiscussionStage((state) => state.target);
  const width = useDiscussionStage((state) => state.width);
  const height = useDiscussionStage((state) => state.height);
  const host = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [layout, setLayout] = useState(() => stageLayout(width, height));
  const active = phase !== 'closed';

  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = (w: number, h: number): void => {
      discussionStageStore.setState({ width: w, height: h });
      setLayout((previous) =>
        previous.width === w && previous.height === h ? previous : stageLayout(w, h),
      );
    };
    const box = element.getBoundingClientRect();
    measure(box.width, box.height);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) measure(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  usePanelMotion(panel, scrimRef, layout);
  const drag = useStageDrag(panel, layout);
  useBackToLeave(active);

  // The motion starts on the panel's first frame, after it has been laid out.
  useEffect(() => {
    if (phase !== 'entering') return;
    const frame = window.requestAnimationFrame((timeMs) => discussionStage.begin(timeMs));
    return () => window.cancelAnimationFrame(frame);
  }, [phase]);

  // Focus: the debate prompt on entering; on leaving, the story sheet comes
  // back as it was and focus returns to Discuss (after the sheet has moved
  // its own focus to the headline).
  useEffect(() => {
    if (phase === 'entering') {
      document.getElementById(titleId)?.focus({ preventScroll: true });
      return;
    }
    if (phase !== 'closed' || target === null) return;
    storyStore.getState().setSheet(target.returnSheet);
    const frame = window.requestAnimationFrame(() =>
      takeDiscussionOpener()?.focus({ preventScroll: true }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [phase, target, titleId]);

  const Panel = active ? loadedDiscussionPanel()?.DiscussionPanel : undefined;
  const side = layout.kind === 'side';

  return (
    <div ref={host} className="pointer-events-none absolute inset-0 z-40 overflow-hidden">
      {active && (
        // The globe beside or above the panel: a click leaves (your call, 4.5).
        <div
          aria-hidden="true"
          className="pointer-events-auto absolute inset-0"
          onClick={() => discussionStage.leave()}
        />
      )}
      {scrim && (
        <div
          ref={scrimRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-void opacity-0"
        />
      )}
      <section
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        inert={!active}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || event.defaultPrevented) return;
          event.preventDefault();
          discussionStage.leave();
        }}
        className={`pointer-events-auto absolute flex flex-col border-ink/15 bg-panel will-change-transform ${
          side
            ? 'inset-y-0 right-0 border-l shadow-[-12px_0_40px_rgb(0_0_0/0.55)]'
            : 'inset-x-0 bottom-0 rounded-t-2xl border border-b-0 shadow-[0_-12px_40px_rgb(0_0_0/0.55)]'
        }`}
        style={side ? { width: layout.panelWidth } : { height: layout.panelHeight }}
      >
        <header
          {...drag}
          data-stage-handle
          className={`flex shrink-0 items-center justify-between px-2 pt-1 ${side ? '' : 'touch-none'}`}
        >
          <span aria-hidden="true" className="size-11" />
          {!side && <span aria-hidden="true" className="h-1.5 w-10 rounded-full bg-ink/35" />}
          <button
            type="button"
            className={ICON_BUTTON}
            aria-label="Leave discussion"
            onClick={() => discussionStage.leave()}
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 stroke-current">
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        {Panel && target ? (
          <Panel storyId={target.storyId} titleId={titleId} />
        ) : (
          <h2 id={titleId} tabIndex={-1} className="px-5 text-lg font-semibold outline-none">
            Discussion
          </h2>
        )}
      </section>
    </div>
  );
}
