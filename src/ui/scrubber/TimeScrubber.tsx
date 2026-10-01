import { useEffect, useReducer, type JSX } from 'react';

import { fractionAt, historyRange, type NodeBuffer } from '@/core';
import { LIVE_SYNC_INTERVAL_MS, timeStore, useTimeStore, wallClockNow } from '@/state';

import { ScrubberTrack } from './ScrubberTrack';
import { formatTimeLabel } from './timeLabel';

export interface TimeScrubberProps {
  /** The stories on the globe, for the news-volume histogram. */
  readonly nodes: NodeBuffer | null;
  /** AppConfig.historyWindowHours: how far back the scrubber reaches. */
  readonly historyHours: number;
  /** Steps aside (slides down, inert) while a story sheet holds the bottom edge. */
  readonly hidden?: boolean;
}

const ROUND_BUTTON =
  'grid size-11 shrink-0 place-items-center rounded-full border border-accent/60 bg-void/70 text-ink shadow-[0_0_18px_rgb(77_163_255/0.35)] hover:bg-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-pressed:bg-accent aria-pressed:text-void';

function PlayIcon({ playing }: { playing: boolean }): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 fill-current">
      {playing ? (
        <path d="M4 2.5h2.6v11H4zM9.4 2.5H12v11H9.4z" />
      ) : (
        <path d="M4.5 2.2v11.6a.6.6 0 0 0 .9.5l9-5.8a.6.6 0 0 0 0-1L5.4 1.7a.6.6 0 0 0-.9.5Z" />
      )}
    </svg>
  );
}

/**
 * The time scrubber: Play, the displayed instant in UTC and local time, and
 * the track. Dragging writes only the time store (no network, no React work
 * outside this bar); letting go holds the time, and the last few pixels,
 * Live, or End ease it back to now.
 */
export function TimeScrubber({
  nodes,
  historyHours,
  hidden = false,
}: TimeScrubberProps): JSX.Element {
  const timeMs = useTimeStore((state) => state.timeMs);
  const isLive = useTimeStore((state) => state.isLive);
  const returning = useTimeStore((state) => state.returning);
  const playing = useTimeStore((state) => state.motion === 'playing');
  // While a time is held the track's "now" keeps moving; redraw it now and then.
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const timer = window.setInterval(tick, LIVE_SYNC_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const nowMs = wallClockNow();
  const range = historyRange(nowMs, historyHours);
  const label = formatTimeLabel(timeMs, nowMs, isLive);
  // Discrete moments only: the slider's own value text covers each step, and
  // a drag must not queue sixty announcements a second.
  const announcement = playing ? `Playing the last ${historyHours} hours` : isLive ? 'Live' : '';
  const { setMotion, returnToLive } = timeStore.getState();

  return (
    <div
      inert={hidden}
      className={`pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-void/95 via-void/70 to-transparent px-4 pb-3 pt-12 transition-[translate,opacity] duration-300 motion-reduce:transition-none ${hidden ? 'translate-y-full opacity-0' : ''}`}
    >
      <section
        aria-label="Time scrubber"
        className="pointer-events-auto mx-auto flex max-w-5xl items-end gap-3"
      >
        <button
          type="button"
          className={ROUND_BUTTON}
          aria-label={`Play the last ${historyHours} hours`}
          aria-pressed={playing}
          onClick={() => setMotion(playing ? 'still' : 'playing')}
        >
          <PlayIcon playing={playing} />
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <p
              className={`font-semibold tabular-nums text-ink transition-[font-size] ${playing ? 'text-2xl' : 'text-lg'}`}
            >
              {label.utc}
            </p>
            <p className="text-sm tabular-nums text-muted">{label.local}</p>
            <div className="ml-auto flex items-center gap-2">
              {isLive ? (
                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink">
                  <span
                    aria-hidden="true"
                    className="size-2 rounded-full bg-red-500 shadow-[0_0_8px_rgb(239_68_68)]"
                  />
                  Live
                </span>
              ) : (
                <>
                  <span className="text-sm tabular-nums text-muted">{label.relative}</span>
                  <button
                    type="button"
                    className="rounded-full border border-ink/30 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-ink hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
                    disabled={returning}
                    onClick={returnToLive}
                  >
                    Live
                  </button>
                </>
              )}
            </div>
          </div>
          <ScrubberTrack
            nodes={nodes}
            historyHours={historyHours}
            range={range}
            fraction={fractionAt(timeMs, range)}
            playing={playing}
            valueText={label.spoken}
          />
        </div>
        <p role="status" className="sr-only">
          {announcement}
        </p>
      </section>
    </div>
  );
}
