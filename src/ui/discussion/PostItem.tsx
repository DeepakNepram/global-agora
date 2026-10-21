import { useId, type JSX, type ReactNode } from 'react';

import type { DiscussionInfo, DiscussionPost, VoteKind } from '@/core/discussion';

import { formatAgo } from '../story/format';
import { kindChip, linkHost, sideName, voteLabel } from './discussionView';

export interface PostItemProps {
  readonly post: DiscussionPost;
  readonly info: DiscussionInfo;
  readonly nowMs: number;
  /** The reader's own post: no votes, no menu, its moderation shown. */
  readonly own: boolean;
  readonly voted: readonly VoteKind[];
  /** Just arrived live: highlighted until seen. */
  readonly fresh: boolean;
  readonly onVote: (kind: VoteKind) => void;
  /** Report and Block, for others' posts. */
  readonly menu: ReactNode;
}

const STANCE_BAR: Readonly<Record<DiscussionPost['stance'], string>> = {
  a: 'bg-side-a',
  b: 'bg-side-b',
  neutral: 'bg-muted/60',
};

const STANCE_TEXT: Readonly<Record<DiscussionPost['stance'], string>> = {
  a: 'text-side-a',
  b: 'text-side-b',
  neutral: 'text-muted',
};

function HelpfulIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 fill-none stroke-current">
      <path
        d="M3 8.5l3.2 3L13 4.5"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MindIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 fill-none stroke-current">
      <path
        d="M12.5 6A5 5 0 1 0 13 9.5M12.8 2.5V6H9.3"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const MODERATION_NOTE: Partial<Record<DiscussionPost['modState'], string>> = {
  pending: 'Checking your post… Others see it once it passes.',
  hidden: 'Only you can see this while a moderator reviews it.',
  removed: 'Removed for breaking the community rules. Your updates say why.',
};

/**
 * One post (Prompt 4.5): its side in colour and by name, kind, area if its
 * author showed one, the text, and the two votes, which look different on
 * purpose: Changed my mind is the one that counts most, so it is the filled
 * one. Expert posts always say they are self-declared and unverified.
 */
export function PostItem(props: PostItemProps): JSX.Element {
  const { post, info, nowMs, own, voted, fresh, onVote, menu } = props;
  const bodyId = useId();
  const helpful = voted.includes('helpful');
  const changed = voted.includes('changed_mind');
  const note = own ? MODERATION_NOTE[post.modState] : undefined;
  const removed = own && post.modState === 'removed';

  return (
    <article
      aria-labelledby={bodyId}
      data-post-id={post.id}
      data-fresh={fresh || undefined}
      className="discussion-post relative flex gap-3 rounded-xl py-3 pl-2 pr-1"
    >
      <span aria-hidden="true" className={`w-1 shrink-0 rounded-full ${STANCE_BAR[post.stance]}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span className={`font-semibold ${STANCE_TEXT[post.stance]}`}>
            {sideName(post.stance, info)}
          </span>
          <span className="rounded-full border border-ink/15 px-2 py-0.5 text-ink/80">
            {kindChip(post.kind)}
          </span>
          <span>
            {own ? 'You' : post.authorHandle ? `@${post.authorHandle}` : 'Someone'} ·{' '}
            {formatAgo(post.createdAtMs, nowMs)}
          </span>
          {post.regionLabel && (
            <span>
              <span className="sr-only">Posted from around </span>
              {post.regionLabel}
            </span>
          )}
        </p>
        {note && <p className="text-xs text-ink">{note}</p>}
        {!removed && (
          <p
            id={bodyId}
            className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink"
          >
            {post.body}
          </p>
        )}
        {!removed && post.evidenceUrl && (
          <a
            href={post.evidenceUrl}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className="self-start text-sm text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Evidence: {linkHost(post.evidenceUrl)}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
        {!own && (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={changed}
              aria-label={voteLabel('changed_mind', post.changedMindCount)}
              onClick={() => onVote('changed_mind')}
              className="flex h-11 items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-void hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-pressed:bg-ink aria-pressed:text-void"
            >
              <MindIcon />
              Changed my mind
              <span className="tabular-nums">{post.changedMindCount}</span>
            </button>
            <button
              type="button"
              aria-pressed={helpful}
              aria-label={voteLabel('helpful', post.helpfulCount)}
              onClick={() => onVote('helpful')}
              className="flex h-11 items-center gap-2 rounded-full border border-ink/20 px-3 text-sm text-ink/90 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-pressed:border-accent aria-pressed:text-accent"
            >
              <HelpfulIcon />
              Helpful
              <span className="tabular-nums">{post.helpfulCount}</span>
            </button>
            <span className="ml-auto">{menu}</span>
          </div>
        )}
        {own && !removed && (
          <p className="text-xs text-muted">
            Helpful {post.helpfulCount} · Changed my mind {post.changedMindCount}
          </p>
        )}
      </div>
    </article>
  );
}
