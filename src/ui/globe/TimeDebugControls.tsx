import { useId, type JSX } from 'react';

import { subsolarPoint } from '@/core';
import { timeStore, useTimeStore } from '@/state';

import {
  MINUTES_PER_DAY,
  formatLatLon,
  formatUtcClock,
  formatUtcDate,
  minuteOfUtcDay,
  withMinuteOfUtcDay,
  withUtcDate,
} from './timeDebug';

const BUTTON =
  'rounded px-2 py-1 text-left text-xs text-ink hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent aria-pressed:bg-accent aria-pressed:text-void';

const FIELD =
  'rounded bg-white/10 px-2 py-1 text-xs text-ink [color-scheme:dark] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

/**
 * Drives the time store by hand so the terminator can be checked against real
 * sunrise times. It writes the same store value the Phase 3 scrubber will; the
 * globe cannot tell the two apart.
 *
 * Keyboard: the slider is a native range input, so arrows step one minute and
 * PageUp/PageDown step 144; the date field and Live button are native too.
 */
export function TimeDebugControls(): JSX.Element {
  const timeMs = useTimeStore((state) => state.timeMs);
  const isLive = useTimeStore((state) => state.isLive);
  const groupLabel = useId();
  const sliderId = useId();
  const dateId = useId();

  const { setTime, goLive } = timeStore.getState();
  const clock = formatUtcClock(timeMs);

  return (
    <div role="group" aria-labelledby={groupLabel} className="flex flex-col gap-1">
      <p id={groupLabel} className="text-[11px] uppercase tracking-wide text-muted">
        Time (UTC)
      </p>

      <label htmlFor={dateId} className="sr-only">
        UTC date
      </label>
      <input
        id={dateId}
        type="date"
        className={FIELD}
        value={formatUtcDate(timeMs)}
        onChange={(event) => {
          const next = withUtcDate(timeMs, event.target.value);
          if (next !== null) setTime(next);
        }}
      />

      <output htmlFor={sliderId} className="text-xs tabular-nums text-ink">
        {clock}
      </output>
      <input
        id={sliderId}
        type="range"
        aria-label="Time of day, UTC"
        min={0}
        max={MINUTES_PER_DAY - 1}
        step={1}
        value={minuteOfUtcDay(timeMs)}
        aria-valuetext={clock}
        className="accent-accent"
        onChange={(event) => setTime(withMinuteOfUtcDay(timeMs, Number(event.target.value)))}
      />

      <p className="text-[11px] tabular-nums text-muted">
        Sun overhead: {formatLatLon(subsolarPoint(new Date(timeMs)))}
      </p>

      <button type="button" className={BUTTON} aria-pressed={isLive} onClick={goLive}>
        Live
      </button>
    </div>
  );
}
