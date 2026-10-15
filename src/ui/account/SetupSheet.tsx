import { useRef, type JSX } from 'react';

import { accountStore, getAccountController, useAccountStore, type SetupStep } from '@/state';

import { ModalSheet } from '../sheets/ModalSheet';
import { accountButtonElement } from './accountFocus';
import { HEADING, PRIMARY, QUIET } from './accountStyles';
import { AgeStep, HandleStep, RulesStep } from './SetupSteps';

export interface SetupSheetProps {
  readonly reducedMotion: boolean;
}

const TITLES: Readonly<Record<SetupStep, string>> = {
  age: 'Are you 17 or older?',
  handle: 'Choose your handle',
  rules: 'Community rules',
  'under-age': 'Sorry, we cannot make an account for you',
};

const NUMBER: Readonly<Record<SetupStep, number>> = { age: 1, handle: 2, rules: 3, 'under-age': 1 };

/**
 * The first sign-in's required setup (Prompt 4.1): the 17+ answer, a handle,
 * and an explicit "I agree" to the community rules. It cannot be swiped or
 * escaped away; "Not now" signs out instead, and the next sign-in comes back
 * here. Nothing from the device's library moves to the account until it is
 * done.
 */
export function SetupSheet({ reducedMotion }: SetupSheetProps): JSX.Element {
  const open = useAccountStore((state) => state.sheet === 'setup');
  const step = useAccountStore((state) => state.step);
  const notice = useAccountStore((state) => state.notice);
  const heading = useRef<HTMLHeadingElement>(null);
  const ended = step === 'under-age';
  const close = (): void => accountStore.getState().closeSheet();

  return (
    <ModalSheet
      open={open}
      titleId="setup-title"
      heading={heading}
      focusKey={step}
      reducedMotion={reducedMotion}
      fallbackFocus={accountButtonElement}
      onDismiss={ended ? close : null}
      header={
        ended ? (
          <p className="text-xs text-muted">Account</p>
        ) : (
          <>
            <p className="text-xs text-muted">Finish signing up · step {NUMBER[step]} of 3</p>
            <button
              type="button"
              className={QUIET}
              onClick={() => void getAccountController()?.notNow()}
            >
              Not now
            </button>
          </>
        )
      }
    >
      <h2 id="setup-title" ref={heading} tabIndex={-1} className={HEADING}>
        {TITLES[step]}
      </h2>
      {step === 'age' && <AgeStep />}
      {step === 'handle' && <HandleStep />}
      {step === 'rules' && <RulesStep />}
      {ended ? (
        <>
          <p className="text-sm text-ink">{notice}</p>
          <button type="button" className={`${PRIMARY} self-start`} onClick={close}>
            Close
          </button>
        </>
      ) : (
        <p role="status" className="min-h-5 text-sm text-ink">
          {notice}
        </p>
      )}
    </ModalSheet>
  );
}
