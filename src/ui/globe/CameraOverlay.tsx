import { useEffect, useRef, useState, type JSX } from 'react';

import { angularDistance } from '@/core';
import type { CameraPose, ControlsTelemetry, OrbitGlobeControls } from '@/globe';
import { monotonicNowMs } from '@/state';

export interface CameraOverlayProps {
  readonly controls: OrbitGlobeControls;
}

/** Fast enough to watch inertia decay; reading the controls never schedules a frame. */
const REFRESH_MS = 100;

interface Reading {
  readonly pose: CameraPose;
  readonly telemetry: ControlsTelemetry;
  /** How fast the view centre actually moved since the last reading, any mode. */
  readonly observedDegPerSecond: number;
}

function formatLat(lat: number): string {
  return `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'}`;
}

function formatLon(lon: number): string {
  return `${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'}`;
}

/**
 * Dev-only camera readout: altitude, centre coordinate, angular velocity and
 * mode. Two velocities: "carried" is the inertia the controls are integrating
 * (what decays after a flick); "observed" is the centre's measured motion,
 * which also covers drags and flights.
 */
export function CameraOverlay({ controls }: CameraOverlayProps): JSX.Element {
  const previous = useRef<{ pose: CameraPose; atMs: number } | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);

  useEffect(() => {
    const sample = (): void => {
      const pose = controls.getState();
      const atMs = monotonicNowMs();
      const last = previous.current;
      const seconds = last ? (atMs - last.atMs) / 1000 : 0;
      const observed =
        last && seconds > 0 ? (angularDistance(last.pose, pose) * 180) / Math.PI / seconds : 0;
      previous.current = { pose, atMs };
      setReading({ pose, telemetry: controls.getTelemetry(), observedDegPerSecond: observed });
    };
    sample();
    const id = window.setInterval(sample, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [controls]);

  if (!reading) return <></>;
  const { pose, telemetry, observedDegPerSecond } = reading;

  return (
    <section
      aria-label="Camera"
      className="absolute left-4 top-4 w-56 rounded-lg bg-void/80 p-3 font-mono text-[11px] text-ink backdrop-blur"
    >
      <p className="mb-1 uppercase tracking-wide text-muted">Camera · {telemetry.mode}</p>
      {/* aria-live off: a 10Hz readout would drown a screen reader. */}
      <dl aria-live="off" className="grid grid-cols-[auto_1fr] gap-x-3">
        <dt className="text-muted">Altitude</dt>
        <dd>{Math.round(pose.altitudeKm).toLocaleString('en')} km</dd>
        <dt className="text-muted">Lat</dt>
        <dd>{formatLat(pose.lat)}</dd>
        <dt className="text-muted">Lon</dt>
        <dd>{formatLon(pose.lon)}</dd>
        <dt className="text-muted">ω carried</dt>
        <dd>{telemetry.carriedDegPerSecond.toFixed(2)} °/s</dd>
        <dt className="text-muted">ω observed</dt>
        <dd>{observedDegPerSecond.toFixed(2)} °/s</dd>
      </dl>
    </section>
  );
}
