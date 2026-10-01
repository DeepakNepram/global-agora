import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';

import type { SheetState } from '@/state';

import { SHEET_FULL_FRACTION, sheetStops } from './sheetSpring';
import { useSheetMotion } from './useSheetMotion';

export interface StorySheetProps {
  readonly state: SheetState;
  readonly reducedMotion: boolean;
  /** The headline's id: the dialog's name, and where focus goes on opening. */
  readonly labelledBy: string;
  /** The story shown: opening the sheet, or a new story in it, focuses the headline. */
  readonly focusKey: number | null;
  /** Where a drag let the sheet rest. */
  readonly onRest: (state: SheetState) => void;
  /** The grabber: peek ↔ full. */
  readonly onToggle: () => void;
  readonly onClose: () => void;
  /** Escape inside the sheet: one step down. */
  readonly onEscape: () => void;
  /** The peek card: always shown. */
  readonly children: ReactNode;
  /** Below the peek card: reachable only in the full sheet. */
  readonly details: ReactNode;
}

const ICON_BUTTON =
  'grid size-11 place-items-center rounded-full text-muted hover:bg-white/10 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

/**
 * The bottom sheet the story lives in: a third of the globe's area as a peek
 * card, 90 % when drawn up, off the bottom edge when closed.
 *
 * - A non-modal dialog named by the headline: the globe above stays live.
 * - In peek the whole card drags (up expands, down dismisses); full, only the
 *   header does and the rest scrolls. Springs are critically damped, 320 ms.
 * - Keyboard: the grabber is a button (Expand / Collapse story), Close is
 *   another, Escape steps down, and a closed sheet is inert.
 * - Opaque, no backdrop blur: blurring over a live canvas costs a phone a
 *   full-screen pass every frame (1.5).
 */
export function StorySheet(props: StorySheetProps): JSX.Element {
  const { state, reducedMotion, labelledBy, focusKey, onRest, onToggle, onClose, onEscape } = props;
  const host = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Focus waits for the first measurement, which puts the sheet on screen.
  // Folding the full sheet to peek makes its details inert, which would drop
  // focus held there on the floor; it goes back to the headline instead.
  const focused = useRef<number | null>(null);
  const details = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state === 'closed') {
      focused.current = null;
      return;
    }
    const active = document.activeElement;
    const stranded =
      state === 'peek' && (active === document.body || details.current?.contains(active) === true);
    if (height === 0 || (focusKey === focused.current && !stranded)) return;
    focused.current = focusKey;
    document.getElementById(labelledBy)?.focus({ preventScroll: true });
  }, [state, height, focusKey, labelledBy]);

  const stops = useMemo(() => sheetStops(height), [height]);
  const canDrag = useCallback(
    (target: EventTarget | null): boolean =>
      state !== 'full' ||
      (target instanceof Element && target.closest('[data-sheet-handle]') !== null),
    [state],
  );
  const handlers = useSheetMotion(sheet, stops, state, reducedMotion, onRest, canDrag);
  const full = state === 'full';

  return (
    <div ref={host} className="pointer-events-none absolute inset-0 overflow-hidden">
      <section
        ref={sheet}
        role="dialog"
        data-story-sheet
        aria-modal="false"
        aria-labelledby={labelledBy}
        inert={state === 'closed'}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          onEscape();
        }}
        {...handlers}
        className={`pointer-events-auto absolute inset-x-0 bottom-0 mx-auto flex max-w-2xl flex-col rounded-t-2xl border border-b-0 border-ink/15 bg-panel shadow-[0_-12px_40px_rgb(0_0_0/0.55)] will-change-transform sm:inset-x-4 ${full ? '' : 'touch-none select-none'}`}
        // Below the edge until measured, so the first frame never flashes it
        // open; from then on the motion hook owns the transform. Not
        // visibility: under reduced motion every change is a 0.01 ms
        // transition (index.css), and a sheet still "hidden" for that instant
        // cannot take the focus it is given on opening.
        style={{
          height: `${SHEET_FULL_FRACTION * 100}%`,
          ...(height > 0 ? {} : { transform: 'translate3d(0, 100%, 0)' }),
        }}
      >
        <header
          data-sheet-handle
          className="flex touch-none items-center justify-between px-2 pt-1"
        >
          <span aria-hidden="true" className="size-11" />
          <button
            type="button"
            className="grid h-8 w-20 place-items-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            aria-expanded={full}
            aria-label={full ? 'Collapse story' : 'Expand story'}
            onClick={onToggle}
          >
            <span aria-hidden="true" className="h-1.5 w-10 rounded-full bg-ink/35" />
          </button>
          <button type="button" className={ICON_BUTTON} aria-label="Close story" onClick={onClose}>
            <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 stroke-current">
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div
          className={`min-h-0 flex-1 px-5 pb-8 ${full ? 'overflow-y-auto overscroll-contain' : 'overflow-hidden'}`}
        >
          {props.children}
          <div ref={details} inert={!full}>
            {props.details}
          </div>
        </div>
      </section>
    </div>
  );
}
