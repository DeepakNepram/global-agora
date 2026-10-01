import { memo, useId, useMemo, useRef, type JSX } from 'react';

import {
  histogramBuckets,
  historyRange,
  storyHistogram,
  type NodeBuffer,
  type TimeRange,
} from '@/core';

import { barHeights, tickHours } from './track';
import { SCRUB_STEPS, useScrubInput } from './useScrubInput';

export interface ScrubberTrackProps {
  /** Stories for the news-volume histogram; null until any load. */
  readonly nodes: NodeBuffer | null;
  readonly historyHours: number;
  readonly range: TimeRange;
  /** Where the displayed instant sits, 0 oldest to 1 now. */
  readonly fraction: number;
  readonly playing: boolean;
  readonly valueText: string;
}

/** Histogram bars, drawn once per payload and minute rather than on every scrub tick. */
const Bars = memo(function Bars({ heights }: { heights: Float32Array }): JSX.Element {
  return (
    <>
      {Array.from(heights, (height, i) =>
        height > 0 ? (
          <rect key={i} x={i + 0.18} y={1 - height} width={0.64} height={height} rx={0.32} />
        ) : null,
      )}
    </>
  );
});

/**
 * The track: how much news broke in each slice of the window, lit up to the
 * displayed instant, with a native range input on top. The input carries the
 * keyboard, pointer and screen-reader behaviour (mobile screen readers can
 * adjust a native range, not an ARIA one); the bars and ticks are decoration.
 */
export function ScrubberTrack(props: ScrubberTrackProps): JSX.Element {
  const { nodes, historyHours, range, fraction, playing, valueText } = props;
  const input = useRef<HTMLInputElement>(null);
  const handlers = useScrubInput(input, historyHours);
  const clipId = useId();

  const buckets = histogramBuckets(historyHours);
  // Recounted when the payload changes or the window slides a minute on, not
  // on every scrub tick: the count is a pass over every story.
  const endMinuteMs = Math.floor(range.endMs / 60_000) * 60_000;
  const heights = useMemo(() => {
    if (!nodes) return new Float32Array(buckets);
    return barHeights(storyHistogram(nodes, historyRange(endMinuteMs, historyHours), buckets));
  }, [nodes, endMinuteMs, historyHours, buckets]);
  const ticks = useMemo(() => tickHours(historyHours), [historyHours]);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="relative h-10">
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-1 top-1 h-8 w-full"
          viewBox={`0 0 ${buckets} 1`}
          preserveAspectRatio="none"
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={0} y={0} width={fraction * buckets} height={1} />
            </clipPath>
          </defs>
          <g className="fill-muted/30">
            <Bars heights={heights} />
          </g>
          <g clipPath={`url(#${clipId})`} className={playing ? 'fill-accent' : 'fill-accent/80'}>
            <Bars heights={heights} />
          </g>
        </svg>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 right-0 top-0 w-px bg-ink/40"
        />
        <input
          ref={input}
          type="range"
          className="scrubber-range absolute inset-0"
          min={0}
          max={SCRUB_STEPS}
          step={1}
          value={Math.round(fraction * SCRUB_STEPS)}
          aria-label={`Time, last ${historyHours} hours`}
          aria-valuetext={valueText}
          data-playing={playing}
          {...handlers}
        />
      </div>
      <div aria-hidden="true" className="relative h-3 text-[10px] tabular-nums text-muted">
        {ticks.map((hours) => (
          <span
            key={hours}
            className="absolute -translate-x-1/2"
            style={{ left: `${(1 - hours / historyHours) * 100}%` }}
          >
            −{hours} h
          </span>
        ))}
        <span className="absolute right-0">now</span>
      </div>
    </div>
  );
}
