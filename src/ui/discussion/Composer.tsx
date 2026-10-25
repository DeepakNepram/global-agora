import { memo, useEffect, useId, useMemo, useRef, useState, type JSX } from 'react';
import { useStore } from 'zustand';

import { evidenceUrlProblem, POST_MAX_CHARS } from '@/core/discussion';
import { fetchLocalBadge, type PostKind } from '@/core/posting';
import { monotonicNowMs } from '@/state';
import type { SendResult } from '@/state/discussionRoomActions';
import { createLocalBadgeController, createLocalBadgeStore } from '@/state/localBadge';

import { CheckMark } from '../icons/StateMarks';
import {
  counterAnnouncement,
  counterView,
  evidenceProblemText,
  EXPERT_LABEL,
  KIND_OPTIONS,
  sendResultText,
  waitText,
} from './discussionView';
import { DiscussionDocLink } from './DiscussionDocLink';
import { LocalBadgeToggle } from './LocalBadgeToggle';

const RULES_LINK =
  'text-accent underline underline-offset-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

export interface ComposerProps {
  readonly storyId: string;
  readonly apiBaseUrl: string;
  /** False until the reader has a side: the composer waits for it. */
  readonly unlocked: boolean;
  readonly sending: boolean;
  /** Until when the posting limits hold the next post back (monotonic ms). */
  readonly retryAtMs: number | null;
  readonly onSend: (draft: {
    body: string;
    kind: PostKind;
    evidenceUrl: string | null;
    localBadge: boolean;
  }) => Promise<SendResult>;
}

interface Draft {
  readonly body: string;
  readonly kind: PostKind;
  readonly url: string;
}

/** Unsent drafts, per discussion, for this visit: leaving and coming back keeps one. */
const drafts = new Map<string, Draft>();
const EMPTY: Draft = { body: '', kind: 'argument', url: '' };

const FIELD =
  'w-full rounded-xl border border-edge bg-void px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50';

/**
 * The composer (Prompt 4.5): 500 characters counted as the database counts
 * them, a kind, a link for Evidence only, and the local badge, off for every
 * post. Locked until the reader takes a side; the posting limits' wait
 * counts down on Send.
 */
export const Composer = memo(function Composer(props: ComposerProps): JSX.Element {
  const { storyId, apiBaseUrl, unlocked, sending, retryAtMs, onSend } = props;
  const [draft, setDraft] = useState<Draft>(() => drafts.get(storyId) ?? EMPTY);
  const [badge, setBadge] = useState(false);
  const [message, setMessage] = useState('');
  const [spoken, setSpoken] = useState('');
  const [nowMs, setNowMs] = useState(() => monotonicNowMs());
  const ids = useId();
  const previousCount = useRef(counterView(draft.body).count);

  const badgeStore = useMemo(() => createLocalBadgeStore(), []);
  const badgeStatus = useStore(badgeStore);
  useEffect(() => {
    if (!unlocked) return;
    const controller = createLocalBadgeController({
      store: badgeStore,
      fetchBadge: () => fetchLocalBadge(apiBaseUrl, (url, init) => fetch(url, init)),
    });
    void controller.check();
  }, [unlocked, badgeStore, apiBaseUrl]);

  useEffect(() => {
    drafts.set(storyId, draft);
  }, [storyId, draft]);

  // The wait ticks once a second, and only while there is one.
  const waiting = retryAtMs !== null && retryAtMs > nowMs;
  useEffect(() => {
    if (retryAtMs === null) return;
    const timer = window.setInterval(() => setNowMs(monotonicNowMs()), 1000);
    setNowMs(monotonicNowMs());
    return () => window.clearInterval(timer);
  }, [retryAtMs]);

  const counter = counterView(draft.body);
  const evidence = draft.kind === 'evidence';
  const urlProblem = evidence ? evidenceUrlProblem(draft.url) : null;
  const empty = draft.body.trim() === '';
  const canSend =
    unlocked && !sending && !waiting && !empty && !counter.over && urlProblem === null;

  const edit = (change: Partial<Draft>): void => setDraft((current) => ({ ...current, ...change }));

  const onBody = (body: string): void => {
    const count = counterView(body).count;
    const said = counterAnnouncement(previousCount.current, count);
    previousCount.current = count;
    if (said) setSpoken(said);
    edit({ body });
  };

  const send = async (): Promise<void> => {
    if (!canSend) return;
    const result = await onSend({
      body: draft.body.trim(),
      kind: draft.kind,
      evidenceUrl: evidence ? draft.url.trim() : null,
      localBadge: badge,
    });
    setMessage(sendResultText(result));
    if (result.ok) {
      setDraft(EMPTY);
      setBadge(false);
      previousCount.current = 0;
    }
  };

  return (
    <form
      aria-labelledby={`${ids}-title`}
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <h3 id={`${ids}-title`} className="text-xs font-semibold uppercase tracking-wide text-muted">
        Your post
      </h3>
      <fieldset disabled={!unlocked} className="flex flex-col gap-3 disabled:opacity-60">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-body`} className="sr-only">
            Your post
          </label>
          <textarea
            id={`${ids}-body`}
            rows={4}
            value={draft.body}
            onChange={(event) => onBody(event.target.value)}
            aria-describedby={`${ids}-count`}
            aria-invalid={counter.over}
            placeholder={unlocked ? 'Make your case…' : 'Pick a side to write a post'}
            className={`${FIELD} resize-y`}
          />
          <p
            id={`${ids}-count`}
            className={`self-end text-xs tabular-nums ${counter.over ? 'text-red-300' : counter.near ? 'text-ink' : 'text-muted'}`}
          >
            <span className="sr-only">Up to {POST_MAX_CHARS} characters. Used: </span>
            {counter.text}
          </p>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs text-muted">Kind</legend>
          <div className="flex flex-wrap gap-2">
            {KIND_OPTIONS.map((option) => (
              <label key={option.kind}>
                <input
                  type="radio"
                  name={`${ids}-kind`}
                  value={option.kind}
                  checked={draft.kind === option.kind}
                  onChange={() => edit({ kind: option.kind })}
                  className="peer sr-only"
                />
                <span className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-ink/20 px-3 text-sm text-ink peer-checked:border-accent peer-checked:bg-accent/15 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
                  {draft.kind === option.kind && <CheckMark />}
                  {option.label}
                </span>
              </label>
            ))}
          </div>
          {draft.kind === 'expert' && (
            <p className="text-xs text-muted">
              Expert posts are shown as “{EXPERT_LABEL}” and rank like any other post.
            </p>
          )}
        </fieldset>

        {evidence && (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${ids}-url`} className="text-xs text-muted">
              Link to the evidence
            </label>
            <input
              id={`${ids}-url`}
              type="url"
              inputMode="url"
              value={draft.url}
              onChange={(event) => edit({ url: event.target.value })}
              aria-invalid={urlProblem !== null && draft.url !== ''}
              aria-describedby={`${ids}-url-note`}
              placeholder="https://"
              className={FIELD}
            />
            <p id={`${ids}-url-note`} className="text-xs text-muted">
              {urlProblem && draft.url !== ''
                ? evidenceProblemText(urlProblem)
                : 'Required for evidence.'}
            </p>
          </div>
        )}

        {/* Checked when the composer unlocks, so it only shows from then. */}
        {unlocked && <LocalBadgeToggle status={badgeStatus} checked={badge} onChange={setBadge} />}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            aria-disabled={!canSend}
            aria-busy={sending}
            className={`h-11 rounded-full px-5 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${canSend ? 'bg-accent text-void hover:bg-accent/90' : 'cursor-not-allowed bg-ink/10 text-muted'}`}
          >
            {sending ? 'Posting…' : 'Post'}
          </button>
          <DiscussionDocLink doc="rules" className={`${RULES_LINK} text-sm`}>
            Community rules
          </DiscussionDocLink>
          {waiting && retryAtMs !== null && (
            <p className="text-sm text-muted">
              You can post again in {waitText((retryAtMs - nowMs) / 1000)}.
            </p>
          )}
        </div>
      </fieldset>
      <p role="status" className="min-h-5 text-sm text-ink">
        {message}
      </p>
      <p aria-live="polite" className="sr-only">
        {spoken}
      </p>
    </form>
  );
});
