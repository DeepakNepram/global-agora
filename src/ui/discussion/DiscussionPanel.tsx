import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';

import type { DiscussionPost, VoteKind } from '@/core/discussion';
import type { PostStance } from '@/core/posting';
import {
  accountStore,
  useAccountStore,
  useDiscussionStage,
  useTimeStore,
  wallClockNow,
} from '@/state';
import { useDiscussionRoom } from '@/state/discussionRoom';

import { nextAnnouncement } from '../announce';
import { Composer } from './Composer';
import { closingText, sideName, voteResultText } from './discussionView';
import { PostItem } from './PostItem';
import { PostList } from './PostList';
import { PostMenu } from './PostMenu';
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

/**
 * The discussion itself (Prompt 4.5), its own chunk: the debate and its
 * sides, where the room stands, the reader's side, the composer, and the
 * posts best first, with new ones arriving live. Reading needs no account;
 * taking part asks for one at the moment it is needed.
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
  // Re-renders on each live tick (30 s), which keeps "3 min ago" current.
  useTimeStore((time) => time.timeMs);
  const scroller = useRef<HTMLDivElement>(null);
  const firstSide = useRef<HTMLInputElement>(null);
  const [announcement, setAnnouncement] = useState('');
  const announce = useCallback(
    (text: string) => setAnnouncement((previous) => nextAnnouncement(previous, text)),
    [],
  );

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
  const { info } = state;
  const nowMs = wallClockNow();
  const closed = info !== null && (info.state === 'closed' || info.closesAtMs <= nowMs);
  const blocked = closed ? 'This discussion has closed.' : suspended ? SUSPENDED : null;

  const pickSide = async (stance: PostStance): Promise<void> => {
    const result = await room.takeSide(stance);
    if (result === 'signed-out') accountStore.getState().openSignIn('Sign in to take a side.');
    else if (result === 'ok' && info) announce(`Your side: ${sideName(stance, info)}.`);
    else if (result === 'failed') announce('Your side could not be saved. Try again.');
  };

  const vote = async (post: DiscussionPost, kind: VoteKind): Promise<void> => {
    const result = await room.vote(post.id, kind);
    if (result === 'signed-out') accountStore.getState().openSignIn('Sign in to vote.');
    if (result === 'no-side') firstSide.current?.focus();
    const text = voteResultText(result, kind);
    if (text) announce(text);
  };

  const showPost = (id: string): void => {
    const item = scroller.current?.querySelector(`[data-post-id="${CSS.escape(id)}"]`);
    item?.scrollIntoView({ block: 'center' });
    item?.querySelector<HTMLElement>('button, a')?.focus({ preventScroll: true });
  };

  const mineIds = new Set(state.mine.map((post) => post.id));
  const posts = [...state.mine, ...state.posts.filter((post) => !mineIds.has(post.id))];

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
            onPick={(stance) => void pickSide(stance)}
            firstOption={firstSide}
          />
          {!blocked && (
            <Composer
              storyId={storyId}
              apiBaseUrl={apiBaseUrl}
              unlocked={state.readerId !== null && state.stance !== null}
              sending={state.sending}
              retryAtMs={state.retryAtMs}
              onSend={(draft) => room.send({ ...draft, storyId })}
            />
          )}
          {settled ? (
            <PostList
              scroller={scroller}
              posts={posts}
              fresh={state.fresh}
              more={state.more}
              loadingMore={state.loadingMore}
              onMore={() => void room.showMore()}
              onSeen={onSeen}
              renderPost={(post) => (
                <PostItem
                  post={post}
                  info={info}
                  nowMs={nowMs}
                  own={post.authorId === state.readerId}
                  voted={state.voted[post.id] ?? []}
                  fresh={state.fresh.includes(post.id)}
                  onVote={(kind) => void vote(post, kind)}
                  menu={
                    <PostMenu
                      handle={post.authorHandle}
                      onReport={(reason) => room.report(post.id, reason)}
                      onBlock={() => room.block(post.authorId)}
                      announce={announce}
                    />
                  }
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
