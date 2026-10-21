import { useEffect, useState } from 'react';

/**
 * Whether the panel's sections may render: one frame after the stage has
 * settled. Until then the panel slides in with the placeholder, so the
 * room's data (which may arrive mid-motion) never renders during the
 * transition, and the full render lands in a frame of its own afterwards,
 * not in the one that ends the motion (Prompt 4.5: no dropped frames).
 */
export function useShownAfterSettling(settled: boolean): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!settled) return;
    const frame = window.requestAnimationFrame(() => setShown(true));
    return () => window.cancelAnimationFrame(frame);
  }, [settled]);
  return settled && shown;
}
