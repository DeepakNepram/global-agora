import { useId, type JSX } from 'react';

import {
  roomShares,
  type DiscussionInfo,
  type DiscussionPost,
  type RoomBalance,
} from '@/core/discussion';

import { sharesText, sideName } from './discussionView';

export interface RoomStripProps {
  readonly info: DiscussionInfo;
  readonly balance: RoomBalance | null;
  readonly top: readonly DiscussionPost[];
  /** Brings a post into view in the list. */
  readonly onShow: (id: string) => void;
}

const SIDE_BAR: Readonly<Record<'a' | 'b' | 'neutral', string>> = {
  a: 'bg-side-a',
  neutral: 'bg-muted/60',
  b: 'bg-side-b',
};

/** First words of a post, for the strip. */
function excerpt(body: string): string {
  const words = body.trim().replace(/\s+/g, ' ');
  return words.length > 110 ? `${words.slice(0, 107).trimEnd()}…` : words;
}

/**
 * "Where the room stands" (Prompt 4.5): each side's share of the posts, as a
 * bar and in words, and the three posts the other side found most helpful.
 */
export function RoomStrip({ info, balance, top, onShow }: RoomStripProps): JSX.Element {
  const shares = roomShares(balance ?? { a: 0, b: 0, neutral: 0 });
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2 rounded-xl border border-ink/10 p-3"
    >
      <h3 id={headingId} className="text-xs font-semibold uppercase tracking-wide text-muted">
        Where the room stands
      </h3>
      {/* The words are the content; the bar repeats them for the eye. */}
      <div aria-hidden="true" className="flex h-2 overflow-hidden rounded-full bg-ink/10">
        {(['a', 'neutral', 'b'] as const).map((side) =>
          shares[side] > 0 ? (
            <span key={side} className={SIDE_BAR[side]} style={{ width: `${shares[side]}%` }} />
          ) : null,
        )}
      </div>
      <p className="text-sm text-ink/90">
        {balance === null ? 'Counting posts…' : sharesText(shares, info)}
      </p>

      {top.length > 0 && (
        <>
          <h4 className="mt-1 text-xs font-semibold text-muted">Most helpful to the other side</h4>
          <ol className="flex flex-col gap-1.5">
            {top.map((post) => (
              <li key={post.id}>
                <button
                  type="button"
                  onClick={() => onShow(post.id)}
                  className="flex w-full gap-2 rounded-lg p-1.5 text-left text-sm hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span
                    aria-hidden="true"
                    className={`mt-1 h-3 w-1 shrink-0 rounded-full ${SIDE_BAR[post.stance]}`}
                  />
                  <span className="min-w-0">
                    <span className="block text-ink">{excerpt(post.body)}</span>
                    <span className="block text-xs text-muted">
                      {sideName(post.stance, info)} · {post.crossSideCount}{' '}
                      {post.crossSideCount === 1 ? 'helpful vote' : 'helpful votes'} from across
                      sides
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
