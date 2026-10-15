import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import type { SheetState } from '@/state';

import { SHEET_FULL_FRACTION, sheetStops } from '../story/sheetSpring';
import { useSheetMotion } from '../story/useSheetMotion';

export interface ModalSheetProps {
  readonly open: boolean;
  /** The id of the heading that names the dialog. */
  readonly titleId: string;
  /** Takes focus when the sheet opens, and whenever `focusKey` changes (a new step). */
  readonly heading: RefObject<HTMLHeadingElement | null>;
  readonly focusKey?: string | number;
  readonly reducedMotion: boolean;
  /** Escape or a swipe down. Null when the sheet must be answered: then neither closes it. */
  readonly onDismiss: (() => void) | null;
  /** The top row, which is also what a finger drags. */
  readonly header: ReactNode;
  readonly children: ReactNode;
  /** 'alertdialog' while it asks to confirm something that cannot be undone. */
  readonly role?: 'dialog' | 'alertdialog';
  /**
   * Takes focus instead of the heading when set: the least destructive
   * choice of a confirmation (WAI-ARIA alertdialog).
   */
  readonly focusTarget?: RefObject<HTMLElement | null> | null;
  /** Where focus goes on closing when nothing had it at opening (a sheet that opened itself). */
  readonly fallbackFocus?: () => HTMLElement | null;
}

/** Everything Tab can reach inside `root`, in order. */
function tabbable(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => element.closest('[hidden]') === null);
}

/**
 * A modal sheet on the story sheet's spring (onboarding, sign-in, setup, the
 * account). Focus is held inside while it is up and returns to wherever it
 * was when it closes; each step's heading takes focus, so a screen reader
 * starts with the question.
 */
export function ModalSheet(props: ModalSheetProps): JSX.Element {
  const { open, titleId, heading, focusKey, reducedMotion, onDismiss, header, children } = props;
  const fallbackFocus = useRef(props.fallbackFocus);
  const [height, setHeight] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const state: SheetState = open ? 'full' : 'closed';

  useLayoutEffect(() => {
    fallbackFocus.current = props.fallbackFocus;
  });

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

  // Read before anything inside takes focus; given back on closing, or to
  // the fallback when the sheet opened by itself (nothing had focus).
  useLayoutEffect(() => {
    if (open) {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
      wasOpen.current = true;
    } else if (wasOpen.current) {
      wasOpen.current = false;
      const back = opener.current?.isConnected ? opener.current : fallbackFocus.current?.();
      back?.focus({ preventScroll: true });
    }
  }, [open]);

  // Modal: focus that lands outside while it is up (a click on the backdrop,
  // a script, a reload of part of the page) comes back to the question.
  useEffect(() => {
    if (!open) return;
    const onFocusIn = (event: FocusEvent): void => {
      if (event.target instanceof Node && !sheet.current?.contains(event.target)) {
        heading.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [open, heading]);

  const { focusTarget } = props;
  useEffect(() => {
    if (open && height > 0)
      (focusTarget?.current ?? heading.current)?.focus({ preventScroll: true });
  }, [open, focusKey, height, heading, focusTarget]);

  const stops = useMemo(() => {
    const all = sheetStops(height);
    return { full: all.full, peek: all.closed, closed: all.closed };
  }, [height]);
  const onRest = useCallback(
    (rest: SheetState): void => {
      if (rest !== 'full') onDismiss?.();
    },
    [onDismiss],
  );
  const dismissable = onDismiss !== null;
  const canDrag = useCallback(
    (element: EventTarget | null): boolean =>
      dismissable && element instanceof Element && element.closest('[data-sheet-handle]') !== null,
    [dismissable],
  );
  const handlers = useSheetMotion(sheet, stops, state, reducedMotion, onRest, canDrag);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onDismiss?.();
    } else if (event.key === 'Tab' && sheet.current) {
      // Modal: Tab cycles inside.
      const items = tabbable(sheet.current);
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  return (
    // Above every other sheet: it is modal (the first save opens onboarding over the story).
    <div ref={host} className="pointer-events-none absolute inset-0 z-50 overflow-hidden">
      {open && (
        <div aria-hidden="true" className="pointer-events-auto absolute inset-0 bg-void/60" />
      )}
      <section
        ref={sheet}
        role={props.role ?? 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        inert={!open}
        onKeyDown={onKeyDown}
        {...handlers}
        className="pointer-events-auto absolute inset-x-0 bottom-0 mx-auto flex max-w-xl flex-col rounded-t-2xl border border-b-0 border-ink/15 bg-panel shadow-[0_-12px_40px_rgb(0_0_0/0.55)] will-change-transform sm:inset-x-4"
        style={{
          maxHeight: `${SHEET_FULL_FRACTION * 100}%`,
          ...(height > 0 ? {} : { transform: 'translate3d(0, 100%, 0)' }),
        }}
      >
        <header
          data-sheet-handle
          className="flex touch-none items-center justify-between gap-2 px-5 pt-4"
        >
          {header}
        </header>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-6 pt-2">{children}</div>
      </section>
    </div>
  );
}
