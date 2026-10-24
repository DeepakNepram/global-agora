import { useCallback, useLayoutEffect, useRef, useState, type JSX } from 'react';

import { onboardingStore, useOnboardingStore } from '@/state';

import type { ViewTarget } from '../nav/viewNavigation';
import { ModalSheet } from '../sheets/ModalSheet';
import { AlertsStep, HomeStep, InterestsStep } from './OnboardingSteps';

export interface OnboardingLayerProps {
  readonly target: ViewTarget;
  readonly reducedMotion: boolean;
}

const STEPS = ['What do you want to follow?', 'Where is home?', 'Alerts'] as const;

const BUTTON =
  'h-10 rounded-full px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/**
 * First-run onboarding (Prompt 3.4): interests, home city, alerts, as a
 * modal sheet. Skip on every step keeps what was already chosen; Escape and
 * a swipe down skip too.
 */
export default function OnboardingLayer({
  target,
  reducedMotion,
}: OnboardingLayerProps): JSX.Element {
  const open = useOnboardingStore((state) => state.open);
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);

  // Each showing starts from the first question.
  useLayoutEffect(() => {
    if (open) setStep(0);
  }, [open]);

  const finish = useCallback((status: 'done' | 'skipped'): void => {
    onboardingStore.getState().finish(status);
  }, []);
  const skip = useCallback((): void => finish('skipped'), [finish]);

  const answer = (on: boolean): void => {
    onboardingStore.getState().setAlerts(on);
    finish('done');
  };

  return (
    <ModalSheet
      open={open}
      titleId="onboarding-title"
      heading={heading}
      focusKey={step}
      reducedMotion={reducedMotion}
      onDismiss={skip}
      header={
        <>
          <p className="text-xs text-muted">
            Welcome · step {step + 1} of {STEPS.length}
          </p>
          <button type="button" className={`${BUTTON} text-muted hover:text-ink`} onClick={skip}>
            Skip
          </button>
        </>
      }
    >
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
    </ModalSheet>
  );
}
