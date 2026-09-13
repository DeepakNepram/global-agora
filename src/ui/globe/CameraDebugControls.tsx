import { useCallback, useEffect, useId, useState, type JSX } from 'react';

import { angularDistance } from '@/core';
import { flightDurationMs, type CameraPose, type OrbitGlobeControls } from '@/globe';
import { monotonicNowMs } from '@/state';

import {
  CITY_FLIGHTS,
  DEBUG_BUTTON as BUTTON,
  DEBUG_KBD as KBD,
  FULL_MOTION_KEY,
  WORLD_VIEW_KEY,
  isTypingTarget,
} from './debugControls';

export interface CameraDebugControlsProps {
  readonly controls: OrbitGlobeControls | null;
  /** The OS asks for reduced motion. */
  readonly reducedMotionPreferred: boolean;
  /** Dev override so camera feel can be tested on a machine with reduced motion on. */
  readonly fullMotion: boolean;
  readonly onFullMotionChange: (fullMotion: boolean) => void;
}

/**
 * Prompt 1.4's verification rig: flyTo buttons for five cities and the world
 * view, plus the reduced-motion override. The status line reports the planned
 * duration next to the measured one, so the duration curve is checkable by eye.
 */
export function CameraDebugControls(props: CameraDebugControlsProps): JSX.Element {
  const { controls, reducedMotionPreferred, fullMotion, onFullMotionChange } = props;
  const groupLabel = useId();
  const [status, setStatus] = useState('');
  const reduced = reducedMotionPreferred && !fullMotion;

  const fly = useCallback(
    async (label: string, pose: CameraPose): Promise<void> => {
      if (!controls) return;
      const planned = Math.round(flightDurationMs(angularDistance(controls.getState(), pose)));
      const start = monotonicNowMs();
      setStatus(`Flying to ${label}…`);
      const result = await controls.flyTo(pose.lat, pose.lon, pose.altitudeKm);
      const took = Math.round(monotonicNowMs() - start);
      if (result === 'cancelled') setStatus(`Flight to ${label} cancelled`);
      else if (reduced) setStatus(`Cut to ${label} (reduced motion)`);
      else setStatus(`Arrived at ${label}: planned ${planned} ms, took ${took} ms`);
    },
    [controls, reduced],
  );

  const flyToWorldView = useCallback((): void => {
    if (!controls) return;
    const { lat, lon } = controls.getState();
    void fly('world view', { lat, lon, altitudeKm: controls.getLimits().fitKm });
  }, [controls, fly]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const city = CITY_FLIGHTS.find((c) => c.key === key);
      if (city) void fly(city.label, city.pose);
      else if (key === WORLD_VIEW_KEY) flyToWorldView();
      else if (key === FULL_MOTION_KEY) onFullMotionChange(!fullMotion);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fly, flyToWorldView, onFullMotionChange, fullMotion]);

  return (
    <div role="group" aria-labelledby={groupLabel} className="flex flex-col gap-1">
      <p id={groupLabel} className="text-[11px] uppercase tracking-wide text-muted">
        Fly to
      </p>
      {CITY_FLIGHTS.map((city) => (
        <button
          key={city.id}
          type="button"
          className={BUTTON}
          aria-keyshortcuts={city.key}
          disabled={!controls}
          onClick={() => void fly(city.label, city.pose)}
        >
          <kbd className={KBD}>{city.key}</kbd>
          {city.label}
        </button>
      ))}
      <button
        type="button"
        className={BUTTON}
        aria-keyshortcuts={WORLD_VIEW_KEY}
        disabled={!controls}
        onClick={flyToWorldView}
      >
        <kbd className={KBD}>{WORLD_VIEW_KEY}</kbd>
        World view
      </button>
      <button
        type="button"
        className={BUTTON}
        aria-pressed={fullMotion}
        aria-keyshortcuts={FULL_MOTION_KEY.toUpperCase()}
        onClick={() => onFullMotionChange(!fullMotion)}
      >
        <kbd className={KBD}>{FULL_MOTION_KEY.toUpperCase()}</kbd>
        Force full motion
      </button>
      <p className="text-[11px] text-muted">
        Motion: {reduced ? 'reduced (no flights, no inertia)' : 'full'}
        {reducedMotionPreferred ? ' · OS prefers reduced' : ''}
      </p>
      <p aria-live="polite" className="text-[11px] text-ink">
        {status}
      </p>
    </div>
  );
}
