import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, type JSX, type RefObject } from 'react';

import { FOCUS_RING_PX, placeRing } from './focusRing';
import type { PinPicker } from './pinPicker';
import type { FocusedPin } from './usePinFocus';

/**
 * The ring around the pin Tab is on (Prompt 5.1): accent inside a dark
 * edge, so it reads on bright cloud and dark sea alike. Shown only while
 * the view has keyboard focus: like the reticle, it must follow the view's
 * focusable element (the Tailwind `peer`) in the DOM.
 */
export function PinFocusRing({
  ring,
  focused,
}: {
  readonly ring: RefObject<HTMLDivElement | null>;
  readonly focused: FocusedPin | null;
}): JSX.Element {
  // Placed at once where Tab found it; the canvas host keeps it there as the camera moves.
  useLayoutEffect(() => {
    placeRing(ring.current, focused ? focused.target : null);
  }, [ring, focused]);

  return (
    <div
      ref={ring}
      aria-hidden="true"
      className={`pointer-events-none absolute left-0 top-0 hidden rounded-full border-2 border-accent shadow-[0_0_0_2px_rgb(5_7_13/0.9),inset_0_0_0_2px_rgb(5_7_13/0.6)] ${focused ? 'peer-focus-visible:block' : ''}`}
      style={{ width: FOCUS_RING_PX, height: FOCUS_RING_PX }}
    />
  );
}

/**
 * Inside <Canvas>: moves the ring with its pin on every frame drawn, after
 * the camera has moved (the controls run at −1) and before the frame renders.
 */
export function PinFocusTracker({
  row,
  ring,
  picker,
}: {
  readonly row: number | null;
  readonly ring: RefObject<HTMLDivElement | null>;
  readonly picker: PinPicker;
}): null {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    if (row !== null) invalidate();
  }, [row, invalidate]);
  useFrame(() => {
    if (row !== null) placeRing(ring.current, picker.locate(row));
  });
  return null;
}
