import { useEffect, useRef, useState, type JSX } from 'react';

import type { AuthProvider } from '@/core';
import { useAccountStore, type AccountState } from '@/state';

import { nextAnnouncement } from '../announce';
import { SetupSheet } from './SetupSheet';
import { SignInSheet } from './SignInSheet';

export interface AccountLayerProps {
  readonly providers: readonly AuthProvider[];
  readonly reducedMotion: boolean;
}

/** What to say when the account changes while no sheet is there to show it. */
function statusLine(state: Pick<AccountState, 'status' | 'profile'>): string | null {
  if (state.status === 'signed-in' && state.profile)
    return `Signed in as @${state.profile.handle}.`;
  if (state.status === 'signed-out') return 'Signed out.';
  return null;
}

/**
 * The account's sheets (Prompt 4.1), each mounted the first time it opens
 * and kept, so closing can slide it away and hand focus back. Changes of
 * account are announced, since the sheet that caused them may have closed.
 */
export function AccountLayer({ providers, reducedMotion }: AccountLayerProps): JSX.Element {
  const sheet = useAccountStore((state) => state.sheet);
  const status = useAccountStore((state) => state.status);
  const profile = useAccountStore((state) => state.profile);
  const [used, setUsed] = useState<ReadonlySet<string>>(() => new Set());
  const [announcement, setAnnouncement] = useState('');
  const previous = useRef(status);
  if (sheet !== null && !used.has(sheet)) setUsed(new Set([...used, sheet]));

  useEffect(() => {
    if (previous.current === status) return;
    const changedFrom = previous.current;
    previous.current = status;
    // A reader who was never signed in hears nothing about signing out.
    if (status === 'signed-out' && changedFrom === 'signed-out') return;
    const line = statusLine({ status, profile });
    if (line !== null) setAnnouncement((text) => nextAnnouncement(text, line));
  }, [status, profile]);

  return (
    <>
      {used.has('sign-in') && <SignInSheet providers={providers} reducedMotion={reducedMotion} />}
      {used.has('setup') && <SetupSheet reducedMotion={reducedMotion} />}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </>
  );
}
