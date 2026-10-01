import type { JSX } from 'react';

import { discussCopy, formatAgo, sourcesText } from './format';
import type { StorySummary } from './storySummary';

export type ShareState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'copied' }
  /** The clipboard refused: the link is shown to copy by hand. */
  | { readonly kind: 'manual'; readonly url: string };

export interface PeekCardProps {
  /** Null while a linked story outside the payload loads, or when it is gone. */
  readonly summary: StorySummary | null;
  readonly gone: boolean;
  /** The full story (and with it the outlet) is on its way. */
  readonly loading: boolean;
  readonly nowMs: number;
  readonly headlineId: string;
  readonly saved: boolean;
  readonly share: ShareState;
  readonly onSave: () => void;
  readonly onShare: () => void;
  readonly onDiscuss: () => void;
}

const ACTION =
  'flex h-11 min-w-0 items-center justify-center gap-2 rounded-full border px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
/**
 * Save and Share are 44 px round icons on a phone, so Discuss keeps room to
 * say why it is greyed; their words stay in the accessible name everywhere.
 */
const ACTION_ON = `${ACTION} shrink-0 max-sm:w-11 max-sm:px-0 border-ink/25 text-ink hover:bg-white/10`;
const PHONE_HIDDEN = 'max-sm:sr-only';

function ShareIcon({ copied }: { copied: boolean }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 shrink-0 fill-none stroke-current"
    >
      {copied ? (
        <path
          d="M3 8.5l3.2 3L13 4.5"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M8 10V2.5M5 5.2L8 2.3l3 2.9M4 8v5.5h8V8"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

function BookmarkIcon({ filled }: { filled: boolean }): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0">
      <path
        d="M4 2.5h8v11l-4-2.8-4 2.8z"
        className={filled ? 'fill-current' : 'fill-none'}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The peek card: headline, outlet, time ago, place, how many sources, and
 * Save, Share and Discuss. The headline takes focus when the card opens, so
 * a screen reader starts with it.
 */
export function PeekCard(props: PeekCardProps): JSX.Element {
  const { summary, gone, loading, nowMs, headlineId, saved, share } = props;

  // One heading element whatever the state, so the focus the sheet gives it
  // on opening survives the story loading in.
  const heading = (
    <h2
      id={headlineId}
      tabIndex={-1}
      className="line-clamp-2 text-lg font-semibold leading-snug text-ink outline-none"
    >
      {summary ? summary.headline : gone ? 'This story is no longer available.' : 'Loading story…'}
    </h2>
  );
  if (!summary) return <div className="flex flex-col gap-1.5">{heading}</div>;

  const discuss = discussCopy(summary.discussion, summary.participants);
  const meta = [summary.outlet, formatAgo(summary.publishedAtMs, nowMs), summary.place].filter(
    (part): part is string => part !== null && part !== '',
  );

  return (
    <div className="flex flex-col gap-1.5">
      {heading}
      <p className="truncate text-sm text-muted">
        {/* Room is kept for the outlet so the line does not jump when it arrives. */}
        {summary.outlet === null && loading && (
          <span className="mr-1.5 inline-block h-3 w-16 rounded bg-ink/10 align-middle" />
        )}
        {meta.join(' · ')}
      </p>
      <p className="text-sm text-ink/80">{sourcesText(summary.sourceCount)}</p>

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className={`${ACTION_ON} aria-pressed:border-accent aria-pressed:text-accent`}
          aria-pressed={saved}
          onClick={props.onSave}
        >
          <BookmarkIcon filled={saved} />
          {/* A toggle keeps its name; aria-pressed and the filled mark say it is saved. */}
          <span className={PHONE_HIDDEN}>Save</span>
        </button>
        <button type="button" className={ACTION_ON} onClick={props.onShare}>
          <ShareIcon copied={share.kind === 'copied'} />
          <span className={PHONE_HIDDEN}>{share.kind === 'copied' ? 'Link copied' : 'Share'}</span>
        </button>
        {/* Never hidden. Greyed but focusable when closed, so its reason is heard. */}
        <button
          type="button"
          className={
            discuss.enabled
              ? `${ACTION} flex-1 border-accent bg-accent text-void hover:bg-accent/90`
              : `${ACTION} flex-1 cursor-not-allowed border-ink/10 text-muted`
          }
          aria-disabled={!discuss.enabled}
          onClick={discuss.enabled ? props.onDiscuss : undefined}
        >
          <span className="truncate">{discuss.label}</span>
        </button>
      </div>

      {share.kind === 'manual' && (
        <label className="mt-2 flex flex-col gap-1 text-xs text-muted">
          Copy this link to share the view
          <input
            readOnly
            value={share.url}
            className="rounded border border-ink/20 bg-void px-2 py-1.5 text-sm text-ink"
            onFocus={(event) => event.currentTarget.select()}
            // Selected for copying the moment it appears.
            ref={(input) => input?.select()}
          />
        </label>
      )}
    </div>
  );
}
