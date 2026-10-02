import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import type { LibraryPanel, SheetState } from '@/state';

import { SHEET_FULL_FRACTION, sheetStops } from '../story/sheetSpring';
import { useSheetMotion } from '../story/useSheetMotion';

export interface LibrarySheetProps {
  readonly panel: LibraryPanel | null;
  readonly reducedMotion: boolean;
  readonly onTab: (panel: LibraryPanel) => void;
  readonly onClose: () => void;
  readonly following: ReactNode;
  readonly saved: ReactNode;
}

const TABS: readonly { readonly panel: LibraryPanel; readonly label: string }[] = [
  { panel: 'following', label: 'Following' },
  { panel: 'saved', label: 'Saved' },
];

const ICON_BUTTON =
  'grid size-11 place-items-center rounded-full text-muted hover:bg-white/10 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

/**
 * The library's sheet: Following and Saved as two tabs, up to 90 % of the
 * globe, with the story sheet's spring (critically damped, 320 ms). It has
 * two stops, open and closed: a drag down on its header dismisses it.
 *
 * Keyboard: the tabs follow the ARIA tabs pattern (arrows, Home, End),
 * opening focuses the selected tab, Escape closes, and a closed sheet is
 * inert.
 */
export function LibrarySheet(props: LibrarySheetProps): JSX.Element {
  const { panel, reducedMotion, onTab, onClose } = props;
  const host = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const [height, setHeight] = useState(0);
  const tabId = useId();
  const state: SheetState = panel === null ? 'closed' : 'full';
  // The last tab stays drawn while the sheet slides away.
  const last = useRef<LibraryPanel>('following');
  if (panel !== null) last.current = panel;
  const shown = panel ?? last.current;

  // Measured at mount as well as observed: the observer's first report waits
  // for the next rendered frame, and the sheet mounts (lazily) mid-click.
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    setHeight(element.getBoundingClientRect().height);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Two stops: "peek" sits where "closed" does, and resting anywhere but
  // full closes the sheet.
  const stops = useMemo(() => {
    const all = sheetStops(height);
    return { full: all.full, peek: all.closed, closed: all.closed };
  }, [height]);
  const onRest = useCallback(
    (rest: SheetState): void => {
      if (rest !== 'full') onClose();
    },
    [onClose],
  );
  const canDrag = useCallback(
    (target: EventTarget | null): boolean =>
      target instanceof Element && target.closest('[data-sheet-handle]') !== null,
    [],
  );
  const handlers = useSheetMotion(sheet, stops, state, reducedMotion, onRest, canDrag);

  // Opening (once measured, so the sheet is on screen) focuses the selected tab.
  const opened = useRef(false);
  useEffect(() => {
    if (panel === null) {
      opened.current = false;
      return;
    }
    if (height === 0 || opened.current) return;
    opened.current = true;
    document.getElementById(`${tabId}-${panel}`)?.focus({ preventScroll: true });
  }, [panel, height, tabId]);

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = TABS.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % TABS.length
        : event.key === 'ArrowLeft'
          ? (index + last) % TABS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    const tab = next === null ? undefined : TABS[next];
    if (!tab) return;
    event.preventDefault();
    onTab(tab.panel);
    document.getElementById(`${tabId}-${tab.panel}`)?.focus();
  };

  return (
    <div ref={host} className="pointer-events-none absolute inset-0 overflow-hidden">
      <section
        ref={sheet}
        role="dialog"
        aria-modal="false"
        aria-label="Your library"
        data-library-sheet
        inert={panel === null}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          onClose();
        }}
        {...handlers}
        className="pointer-events-auto absolute inset-x-0 bottom-0 mx-auto flex max-w-2xl flex-col rounded-t-2xl border border-b-0 border-ink/15 bg-panel shadow-[0_-12px_40px_rgb(0_0_0/0.55)] will-change-transform sm:inset-x-4"
        style={{
          height: `${SHEET_FULL_FRACTION * 100}%`,
          ...(height > 0 ? {} : { transform: 'translate3d(0, 100%, 0)' }),
        }}
      >
        <header data-sheet-handle className="flex touch-none items-center gap-2 px-3 pt-2">
          <div role="tablist" aria-label="Library" className="flex flex-1 gap-1">
            {TABS.map((tab, index) => {
              const selected = tab.panel === shown;
              return (
                <button
                  key={tab.panel}
                  id={`${tabId}-${tab.panel}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`${tabId}-${tab.panel}-panel`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onTab(tab.panel)}
                  onKeyDown={(event) => onTabKey(event, index)}
                  className={`h-10 rounded-full px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${selected ? 'bg-white/10 text-ink' : 'text-muted hover:text-ink'}`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className={ICON_BUTTON}
            aria-label="Close library"
            onClick={onClose}
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 stroke-current">
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        {TABS.map((tab) => (
          <div
            key={tab.panel}
            id={`${tabId}-${tab.panel}-panel`}
            role="tabpanel"
            aria-labelledby={`${tabId}-${tab.panel}`}
            hidden={tab.panel !== shown}
            tabIndex={0}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-8 pt-3 focus-visible:outline-none"
          >
            {tab.panel === 'following' ? props.following : props.saved}
          </div>
        ))}
      </section>
    </div>
  );
}
