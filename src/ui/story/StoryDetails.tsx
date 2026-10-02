import { useMemo, type JSX } from 'react';

import {
  groupByOutlet,
  nearbyStories,
  placeExplanation,
  type NodeBuffer,
  type StoryDetail,
} from '@/core';

import { FollowRow } from './FollowRow';
import { formatAgo, formatKm } from './format';
import type { DetailState } from './useStoryDetail';

export type ReportState = 'idle' | 'sending' | 'sent' | 'failed';

export interface StoryDetailsProps {
  readonly detail: DetailState;
  /** For nearby stories: the payload and the story's row in it (−1 when absent). */
  readonly nodes: NodeBuffer | null;
  readonly row: number;
  /** The displayed instant (the globe shows nothing published later). */
  readonly timeMs: number;
  readonly nowMs: number;
  readonly report: ReportState;
  readonly onReport: () => void;
  readonly onNearby: (row: number) => void;
  /** The sheet is drawn up (the follow row loads the gazetteer only then). */
  readonly expanded: boolean;
  readonly announce: (text: string) => void;
}

const SECTION = 'flex flex-col gap-2 border-t border-ink/10 pt-4';
const HEADING = 'text-xs font-semibold uppercase tracking-wide text-muted';
const LINK_BUTTON =
  'self-start rounded text-sm text-accent underline underline-offset-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:no-underline disabled:opacity-70';

function clock(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(ms);
}

function WhyHere({
  detail,
  report,
  onReport,
}: {
  detail: StoryDetail;
  report: ReportState;
  onReport: () => void;
}): JSX.Element {
  return (
    <section aria-labelledby="story-why" className={SECTION}>
      <h3 id="story-why" className={HEADING}>
        Why this location
      </h3>
      <p className="text-sm text-ink/90">{placeExplanation(detail.place)}</p>
      <button
        type="button"
        className={LINK_BUTTON}
        disabled={report === 'sending' || report === 'sent'}
        onClick={onReport}
      >
        {report === 'sent'
          ? 'Reported. Thanks.'
          : report === 'failed'
            ? 'Could not send. Try again'
            : 'Report wrong location'}
      </button>
    </section>
  );
}

function Coverage({ detail }: { detail: StoryDetail }): JSX.Element {
  const groups = useMemo(() => groupByOutlet(detail.articles), [detail.articles]);
  const shown = detail.articles.length;
  return (
    <section aria-labelledby="story-coverage" className={SECTION}>
      <h3 id="story-coverage" className={HEADING}>
        Coverage
      </h3>
      <p className="text-sm text-muted">
        {detail.articleCount.toLocaleString('en-US')}{' '}
        {detail.articleCount === 1 ? 'article' : 'articles'} from {groups.length}{' '}
        {groups.length === 1 ? 'outlet' : 'outlets'}
        {shown < detail.articleCount
          ? `. Showing the newest ${shown.toLocaleString('en-US')}.`
          : ''}
      </p>
      <ul className="flex flex-col gap-3">
        {groups.map((group) => (
          <li key={group.outlet}>
            <h4 className="text-sm font-semibold text-ink">
              {group.outlet}
              {group.country && <span className="ml-2 text-xs text-muted">{group.country}</span>}
            </h4>
            <ul className="mt-1 flex flex-col gap-1">
              {group.articles.map((article) => (
                <li key={article.url} className="flex items-baseline gap-2 text-sm">
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                    className="min-w-0 flex-1 text-ink/90 underline decoration-ink/25 underline-offset-2 hover:text-ink hover:decoration-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    {article.headline}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                  {article.publishedAtMs !== null && (
                    <span className="shrink-0 text-xs tabular-nums text-muted">
                      {clock(article.publishedAtMs)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Nearby(props: Omit<StoryDetailsProps, 'detail' | 'report' | 'onReport'>): JSX.Element {
  const { nodes, row, timeMs, nowMs, onNearby } = props;
  const found = useMemo(
    () => (nodes && row >= 0 ? nearbyStories(nodes, row, timeMs / 1000) : []),
    [nodes, row, timeMs],
  );
  return (
    <section aria-labelledby="story-nearby" className={SECTION}>
      <h3 id="story-nearby" className={HEADING}>
        Nearby
      </h3>
      {found.length === 0 ? (
        <p className="text-sm text-muted">No other stories within reach right now.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {found.map(({ row: other, km }) => (
            <li key={nodes?.ids[other] ?? other}>
              <button
                type="button"
                className="flex w-full flex-col items-start rounded-lg px-2 py-2 text-left hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                onClick={() => onNearby(other)}
              >
                <span className="line-clamp-2 text-sm text-ink">{nodes?.headlines[other]}</span>
                <span className="text-xs text-muted">
                  {[
                    formatKm(km),
                    nodes?.places[other],
                    formatAgo(
                      ((nodes?.epochSec ?? 0) + (nodes?.publishedSec[other] ?? 0)) * 1000,
                      nowMs,
                    ),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The full sheet below the peek card: what to follow, the summary, "why this
 * location" with its report link, every article grouped by outlet, and
 * nearby stories.
 * Article links open in a new tab and send no referrer.
 */
export function StoryDetails(props: StoryDetailsProps): JSX.Element {
  const { detail, nodes, row } = props;
  return (
    <div className="mt-5 flex flex-col gap-5">
      {nodes && row >= 0 && (
        <FollowRow nodes={nodes} row={row} expanded={props.expanded} announce={props.announce} />
      )}
      {detail.status === 'loading' && <p className="text-sm text-muted">Loading the coverage…</p>}
      {detail.status === 'error' && (
        <p className="text-sm text-muted">
          The coverage could not load.{' '}
          <button type="button" className={LINK_BUTTON} onClick={detail.retry}>
            Retry
          </button>
        </p>
      )}
      {detail.status === 'ready' && (
        <>
          {detail.detail.summary && (
            <p className="text-base leading-relaxed text-ink/90">{detail.detail.summary}</p>
          )}
          <WhyHere detail={detail.detail} report={props.report} onReport={props.onReport} />
          <Coverage detail={detail.detail} />
        </>
      )}
      <Nearby {...props} />
    </div>
  );
}
