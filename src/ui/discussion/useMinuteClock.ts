import { useEffect, useState } from 'react';

import { wallClockNow } from '@/state';

/** "3 min ago" moves on this often: the live tick's pace. */
const CLOCK_MS = 30_000;

/** The wall clock, read every CLOCK_MS, so the posts' times stay current without re-rendering each frame. */
export function useMinuteClock(): number {
  const [nowMs, setNowMs] = useState(() => wallClockNow());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(wallClockNow()), CLOCK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return nowMs;
}
