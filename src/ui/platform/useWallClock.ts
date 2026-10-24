import { useEffect, useState } from 'react';

import { wallClockNow } from '@/state';

/**
 * The wall clock, re-read every `intervalMs`, for text that ages ("news
 * from 3 hours ago") without re-rendering each frame.
 *
 * Not shared with the discussion panel's useMinuteClock on purpose: a module
 * imported by both the start and that lazy chunk made rolldown split the
 * start into four files (docs/DECISIONS.md, Prompt 5.2).
 */
export function useWallClock(intervalMs: number): number {
  const [nowMs, setNowMs] = useState(() => wallClockNow());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(wallClockNow()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return nowMs;
}
