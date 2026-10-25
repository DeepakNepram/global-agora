import { useEffect, useId, useState, type FormEvent, type JSX } from 'react';

import { handleProblem, normalizeHandle, suggestHandles, COMMUNITY_RULES } from '@/core';
import { accountStore, getAccountController, useAccountStore } from '@/state';

import { DocLink } from '../legal/DocLink';
import { BODY, INPUT, LABEL, PRIMARY, SECONDARY } from './accountStyles';

/** Quiet time after the last keystroke before asking whether a handle is free. */
const CHECK_AFTER_MS = 300;

export function AgeStep(): JSX.Element {
  const busy = useAccountStore((state) => state.busy);
  const answer = (adult: boolean): void => {
    if (!busy) void getAccountController()?.answerAge(adult);
  };
  return (
    <>
      <p className={BODY}>
        Global Agora accounts are for people 17 and older, because discussions are open to everyone.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={PRIMARY} onClick={() => answer(true)}>
          I&apos;m 17 or older
        </button>
        <button type="button" className={SECONDARY} onClick={() => answer(false)}>
          I&apos;m under 17
        </button>
      </div>
    </>
  );
}

type Availability = 'checking' | 'free' | 'taken' | null;

/** Three free handles, checked with the database, drawn again on request. */
function useSuggestions(): { suggestions: readonly string[]; more: () => void } {
  const [round, setRound] = useState(0);
  const [suggestions, setSuggestions] = useState<readonly string[]>([]);
  useEffect(() => {
    let cancelled = false;
    // Six candidates for three places: one taken still leaves enough.
    const candidates = suggestHandles(Math.random, 6);
    void getAccountController()
      ?.handlesAvailable(candidates)
      .then((free) => {
        if (!cancelled) setSuggestions(free.slice(0, 3));
      });
    return () => {
      cancelled = true;
    };
  }, [round]);
  return { suggestions, more: () => setRound((r) => r + 1) };
}

export function HandleStep(): JSX.Element {
  const busy = useAccountStore((state) => state.busy);
  const current = useAccountStore((state) => state.profile?.handle ?? '');
  const [typed, setTyped] = useState(current);
  const [availability, setAvailability] = useState<Availability>(null);
  const { suggestions, more } = useSuggestions();
  const inputId = useId();
  const hintId = useId();
  const handle = normalizeHandle(typed);
  const problem = handle === '' ? null : handleProblem(handle);

  useEffect(() => {
    if (handle === '' || problem !== null) {
      setAvailability(null);
      return;
    }
    // A handle the account already holds is free to keep.
    if (handle === current) {
      setAvailability('free');
      return;
    }
    setAvailability('checking');
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void getAccountController()
        ?.handlesAvailable([handle])
        .then((free) => {
          if (!cancelled) setAvailability(free.includes(handle) ? 'free' : 'taken');
        });
    }, CHECK_AFTER_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [handle, problem, current]);

  const hint =
    problem ??
    (availability === 'checking'
      ? 'Checking…'
      : availability === 'free'
        ? `@${handle} is free.`
        : availability === 'taken'
          ? `@${handle} is taken.`
          : '3 to 20 letters, digits or _, starting with a letter.');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (busy || handle === '' || problem !== null || availability === 'taken') return;
    void getAccountController()?.chooseHandle(handle);
  };

  return (
    <>
      <p className={BODY}>
        Your handle shows on everything you post. It is fixed once you agree to the rules on the
        next step.
      </p>
      <div role="group" aria-label="Suggested handles" className="flex flex-wrap gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            aria-pressed={handle === suggestion}
            className={`${SECONDARY} aria-pressed:border-accent aria-pressed:text-accent`}
            onClick={() => setTyped(suggestion)}
          >
            @{suggestion}
          </button>
        ))}
        <button type="button" className={SECONDARY} onClick={more}>
          Try three more
        </button>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div>
          <label htmlFor={inputId} className={LABEL}>
            Handle
          </label>
          <input
            id={inputId}
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={21}
            value={typed}
            onChange={(event) => setTyped(event.currentTarget.value)}
            aria-describedby={hintId}
            aria-invalid={problem !== null || availability === 'taken'}
            className={INPUT}
          />
          <p id={hintId} aria-live="polite" className="mt-1 text-xs text-muted">
            {hint}
          </p>
        </div>
        <button type="submit" className={`${PRIMARY} self-start`} aria-busy={busy}>
          {busy ? 'Saving…' : 'Next'}
        </button>
      </form>
    </>
  );
}

export function RulesStep(): JSX.Element {
  const busy = useAccountStore((state) => state.busy);
  // Read once: agreeing sets the time while the sheet is still sliding away.
  const [agreedBefore] = useState(() => accountStore.getState().profile?.rulesAcceptedAtMs != null);
  const controller = getAccountController();
  return (
    <>
      <p className={BODY}>
        {agreedBefore
          ? 'The community rules have changed since you last agreed. Please read them again.'
          : 'Every account agrees to these before taking part.'}{' '}
        <DocLink doc="rules" section="enforcement">
          How they are enforced
        </DocLink>
      </p>
      <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm text-ink marker:text-muted">
        {COMMUNITY_RULES.map((rule) => (
          <li key={rule.title}>
            <span className="font-medium">{rule.title}</span>{' '}
            <span className="text-muted">{rule.detail}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={PRIMARY}
          aria-busy={busy}
          onClick={() => {
            if (!busy) void controller?.agreeToRules();
          }}
        >
          {busy ? 'Saving…' : 'I agree'}
        </button>
        {!agreedBefore && (
          <button type="button" className={SECONDARY} onClick={() => controller?.backToHandle()}>
            Back
          </button>
        )}
      </div>
      <p className={BODY}>
        Agreeing also means accepting the <DocLink doc="terms">terms of use</DocLink>. The{' '}
        <DocLink doc="privacy">privacy policy</DocLink> says what an account keeps.
      </p>
    </>
  );
}
