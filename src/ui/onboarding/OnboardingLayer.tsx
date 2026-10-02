import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
} from 'react';

import { onboardingStore, useOnboardingStore, type SheetState } from '@/state';

import type { GlobeTarget } from '../nav/globeNavigation';
import { SHEET_FULL_FRACTION, sheetStops } from '../story/sheetSpring';
import { useSheetMotion } from '../story/useSheetMotion';
import { AlertsStep, HomeStep, InterestsStep } from './OnboardingSteps';

export interface OnboardingLayerProps {
  readonly target: GlobeTarget;
  readonly reducedMotion: boolean;
}

const STEPS = ['What do you want to follow?', 'Where is home?', 'Alerts'] as const;

const BUTTON =
  'h-10 rounded-full px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/** Everything Tab can reach inside `root`, in order. */
function tabbable(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => element.closest('[hidden]') === null);
}

/**
 * First-run onboarding (Prompt 3.4): interests, home city, alerts, as a
 * modal sheet on the story sheet's spring. Skip on every step keeps what was
 * already chosen; Escape skips too. Focus is held inside while it is up and
 * returns to wherever it was when it closes.
 */
export default function OnboardingLayer({
  target,
  reducedMotion,
}: OnboardingLayerProps): JSX.Element {
  const open = useOnboardingStore((state) => state.open);
  const [step, setStep] = useState(0);
  const [height, setHeight] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const state: SheetState = open ? 'full' : 'closed';

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

  // Read before anything inside takes focus; given back on closing.
  useLayoutEffect(() => {
    if (open) {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement ? active : null;
      setStep(0);
    } else {
      opener.current?.focus({ preventScroll: true });
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
  }, [open]);

  // Each step's heading takes focus, so a screen reader starts with the question.
  useEffect(() => {
    if (open && height > 0) heading.current?.focus({ preventScroll: true });
  }, [open, step, height]);

  const stops = useMemo(() => {
    const all = sheetStops(height);
    return { full: all.full, peek: all.closed, closed: all.closed };
  }, [height]);
  const finish = useCallback((status: 'done' | 'skipped'): void => {
    onboardingStore.getState().finish(status);
  }, []);
  const onRest = useCallback(
    (rest: SheetState): void => {
      if (rest !== 'full') finish('skipped');
    },
    [finish],
  );
  const canDrag = useCallback(
    (element: EventTarget | null): boolean =>
      element instanceof Element && element.closest('[data-sheet-handle]') !== null,
    [],
  );
  const handlers = useSheetMotion(sheet, stops, state, reducedMotion, onRest, canDrag);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      finish('skipped');
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

  const answer = (on: boolean): void => {
    onboardingStore.getState().setAlerts(on);
    finish('done');
  };

  return (
    // Above every other sheet: it is modal, and the first save opens it over the story.
    <div ref={host} className="pointer-events-none absolute inset-0 z-50 overflow-hidden">
      {open && (
        <div aria-hidden="true" className="pointer-events-auto absolute inset-0 bg-void/60" />
      )}
      <section
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
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
          className="flex touch-none items-center justify-between px-5 pt-4"
        >
          <p className="text-xs text-muted">
            Welcome · step {step + 1} of {STEPS.length}
          </p>
          <button
            type="button"
            className={`${BUTTON} text-muted hover:text-ink`}
            onClick={() => finish('skipped')}
          >
            Skip
          </button>
        </header>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-6 pt-2">
          <h2
            id="onboarding-title"
            ref={heading}
            tabIndex={-1}
            className="text-lg font-semibold text-ink outline-none"
          >
            {STEPS[step]}
          </h2>
          {step === 0 && <InterestsStep />}
          {step === 1 && <HomeStep target={target} />}
          {step === 2 && <AlertsStep onAnswer={answer} />}
          {step < 2 && (
            <div className="mt-2 flex justify-end gap-2">
              {step > 0 && (
                <button
                  type="button"
                  className={`${BUTTON} border border-ink/20 text-ink hover:bg-white/10`}
                  onClick={() => setStep(step - 1)}
                >
                  Back
                </button>
              )}
              <button
                type="button"
                className={`${BUTTON} bg-accent text-void hover:bg-accent/90`}
                onClick={() => setStep(step + 1)}
              >
                Next
              </button>
            </div>
          )}
          {step === 2 && (
            <button
              type="button"
              className={`${BUTTON} self-start border border-ink/20 text-ink hover:bg-white/10`}
              onClick={() => setStep(1)}
            >
              Back
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
