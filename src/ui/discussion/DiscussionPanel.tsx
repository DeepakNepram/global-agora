import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';

import type { DiscussionPost, VoteKind } from '@/core/discussion';
import type { ReportReason } from '@/core/moderation';
import type { PostingErrorCode, PostKind, PostStance } from '@/core/posting';
import { accountStore, useAccountStore, useDiscussionStage, wallClockNow } from '@/state';
import { useDiscussionRoom } from '@/state/discussionRoom';

import { nextAnnouncement } from '../announce';
import { Composer } from './Composer';
import { closingText, sideName, voteResultText } from './discussionView';
import { PostItem } from './PostItem';
import { PostList } from './PostList';
import { getDiscussionRoom } from './room';
import { RoomStrip } from './RoomStrip';
import { StancePicker } from './StancePicker';

export interface DiscussionPanelProps {
  /** The story's uuid, which keys its discussion. */
  readonly storyId: string;
  /** The heading's id: it names the dialog and takes focus on entering. */
  readonly titleId: string;
  /** AppConfig.apiBaseUrl: posts go through the API Worker (Prompt 4.4). */
  readonly apiBaseUrl: string;
}

const SUSPENDED = 'Posting, voting and taking sides are suspended on this account.';
const NO_VOTES: readonly VoteKind[] = [];
/** "3 min ago" moves on this often: the live tick's pace. */
const CLOCK_MS = 30_000;

/** The wall clock, read every CLOCK_MS, so the posts' times stay current without re-rendering each frame. */
function useMinuteClock(): number {
  const [nowMs, setNowMs] = useState(() => wallClockNow());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(wallClockNow()), CLOCK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return nowMs;
}

/**
 * The discussion itself (Prompt 4.5), its own chunk: the debate and its
 * sides, where the room stands, the reader's side, the composer, and the
 * posts best first, with new ones arriving live. Reading needs no account;
 * taking part asks for one at the moment it is needed.
 *
 * Every handler is stable and every row is memoised, so a live post or a
 * vote re-renders the row it touches, not the fifty around it.
 */
export function DiscussionPanel({
  storyId,
  titleId,
  apiBaseUrl,
}: DiscussionPanelProps): JSX.Element {
  const room = useMemo(() => getDiscussionRoom(apiBaseUrl), [apiBaseUrl]);
  const state = useDiscussionRoom((current) => current);
  const settled = useDiscussionStage((stage) => stage.phase !== 'entering');
  const signedIn = useAccountStore((account) => account.status === 'signed-in');
  const suspended = useAccountStore((account) => account.profile?.suspendedAtMs != null);
  const nowMs = useMinuteClock();
  const scroller = useRef<HTMLDivElement>(null);
  const firstSide = useRef<HTMLInputElement>(null);
  const [announcement, setAnnouncement] = useState('');
  const announce = useCallback(
    (text: string) => setAnnouncement((previous) => nextAnnouncement(previous, text)),
    [],
  );
  const { info } = state;
  const infoRef = useRef(info);
  useEffect(() => {
    infoRef.current = info;
  }, [info]);

  // A new room for this story, and again when the reader signs in or out:
  // their side, votes and blocks change what there is to show.
  useEffect(() => {
    void room.open(storyId);
    return () => room.close();
  }, [room, storyId, signedIn]);

  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void room.catchUp();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [room]);

  useEffect(() => {
    if (state.notice) announce(state.notice);
  }, [state.notice, announce]);

  const onSeen = useCallback((id: string) => room.seen(id), [room]);
  const onMore = useCallback(() => void room.showMore(), [room]);
  const report = useCallback((id: string, reason: ReportReason) => room.report(id, reason), [room]);
  const block = useCallback((authorId: string) => room.block(authorId), [room]);

  const pickSide = useCallback(
    (stance: PostStance): void => {
      void room.takeSide(stance).then((result) => {
        const current = infoRef.current;
        if (result === 'signed-out') accountStore.getState().openSignIn('Sign in to take a side.');
        else if (result === 'ok' && current) announce(`Your side: ${sideName(stance, current)}.`);
        else if (result === 'failed') announce('Your side could not be saved. Try again.');
      });
    },
    [room, announce],
  );

  const vote = useCallback(
    (post: DiscussionPost, kind: VoteKind): void => {
      void room.vote(post.id, kind).then((result) => {
        if (result === 'signed-out') accountStore.getState().openSignIn('Sign in to vote.');
        if (result === 'no-side') firstSide.current?.focus();
        const text = voteResultText(result, kind);
        if (text) announce(text);
      });
    },
    [room, announce],
  );

  const send = useCallback(
    (draft: { body: string; kind: PostKind; evidenceUrl: string | null; localBadge: boolean }) => {
      const sending = room.send({ ...draft, storyId });
      void sending.then((result) => {
        const code: PostingErrorCode | 'no-side' | null = result.ok ? null : result.code;
        if (code === 'signed-out') accountStore.getState().openSignIn('Sign in to post.');
      });
      return sending;
    },
    [room, storyId],
  );

  const showPost = useCallback((id: string): void => {
    const item = scroller.current?.querySelector(`[data-post-id="${CSS.escape(id)}"]`);
    item?.scrollIntoView({ block: 'center' });
    item?.querySelector<HTMLElement>('button, a')?.focus({ preventScroll: true });
  }, []);

  const posts = useMemo(() => {
    const mineIds = new Set(state.mine.map((post) => post.id));
    return [...state.mine, ...state.posts.filter((post) => !mineIds.has(post.id))];
  }, [state.mine, state.posts]);

  const closed = info !== null && (info.state === 'closed' || info.closesAtMs <= nowMs);
  const blocked = closed ? 'This discussion has closed.' : suspended ? SUSPENDED : null;

  return (
    <div
      ref={scroller}
      className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-5 pb-8 [overflow-anchor:none]"
    >
      <header className="flex flex-col gap-2">
        <h2
          id={titleId}
          tabIndex={-1}
          className="text-lg font-semibold leading-snug text-ink outline-none"
        >
          {info?.prompt ?? 'Discussion'}
        </h2>
        {info && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="flex items-center gap-1.5 text-side-a">
              <span aria-hidden="true" className="size-2.5 rounded-full bg-side-a" />
              {info.sideA}
            </span>
            <span className="text-muted">vs</span>
            <span className="flex items-center gap-1.5 text-side-b">
              <span aria-hidden="true" className="size-2.5 rounded-full bg-side-b" />
              {info.sideB}
            </span>
            <span className="text-xs text-muted">· {closingText(info, nowMs)}</span>
          </p>
        )}
      </header>

      {state.status === 'loading' && <p className="text-sm text-muted">Loading the discussion…</p>}
      {state.status === 'missing' && (
        <p className="text-sm text-ink">This discussion is not available.</p>
      )}
      {state.status === 'failed' && (
        <div className="flex items-center gap-3">
          <p className="text-sm text-ink">The discussion could not be loaded.</p>
          <button
            type="button"
            onClick={() => void room.open(storyId)}
            className="h-11 rounded-full border border-ink/20 px-4 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Try again
          </button>
        </div>
      )}

      {state.status === 'ready' && info && (
        <>
          <RoomStrip
            info={info}
            balance={state.balance}
            top={state.topCrossSide}
            onShow={showPost}
          />
          <StancePicker
            info={info}
            stance={state.stance}
            busy={state.stanceBusy}
            blocked={blocked}
            onPick={pickSide}
            firstOption={firstSide}
          />
          {!blocked && (
            <Composer
              storyId={storyId}
              apiBaseUrl={apiBaseUrl}
              unlocked={state.readerId !== null && state.stance !== null}
              sending={state.sending}
              retryAtMs={state.retryAtMs}
              onSend={send}
            />
          )}
          {settled ? (
            <PostList
              scroller={scroller}
              posts={posts}
              fresh={state.fresh}
              more={state.more}
              loadingMore={state.loadingMore}
              onMore={onMore}
              onSeen={onSeen}
              renderPost={(post) => (
                <PostItem
                  post={post}
                  info={info}
                  nowMs={nowMs}
                  own={post.authorId === state.readerId}
                  voted={state.voted[post.id] ?? NO_VOTES}
                  fresh={state.fresh.includes(post.id)}
                  onVote={vote}
                  onReport={report}
                  onBlock={block}
                  announce={announce}
                />
              )}
            />
          ) : (
            <p className="text-sm text-muted">Loading posts…</p>
          )}
        </>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
