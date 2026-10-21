import { memo, useId, type JSX, type RefObject } from 'react';

import type { DiscussionInfo, StanceRecord } from '@/core/discussion';
import type { PostStance } from '@/core/posting';

import { sideName } from './discussionView';

export interface StancePickerProps {
  readonly info: DiscussionInfo;
  readonly stance: StanceRecord | null;
  readonly busy: boolean;
  /** Why the side cannot be chosen now, or null when it can. */
  readonly blocked: string | null;
  readonly onPick: (stance: PostStance) => void;
  /** Where a "pick a side first" sends focus. */
  readonly firstOption: RefObject<HTMLInputElement | null>;
}

const DOT: Readonly<Record<PostStance, string>> = {
  a: 'bg-side-a',
  neutral: 'bg-muted',
  b: 'bg-side-b',
};

const ORDER: readonly PostStance[] = ['a', 'neutral', 'b'];

/**
 * The reader's side (Prompt 4.5), which the composer waits for. Native
 * radios, so the arrow keys move between sides. A side can change until the
 * reader first posts or votes; then the database fixes it (Prompt 4.2).
 */
export const StancePicker = memo(function StancePicker(props: StancePickerProps): JSX.Element {
  const { info, stance, busy, blocked, onPick, firstOption } = props;
  const noteId = useId();
  const locked = stance?.locked === true;
  const disabled = busy || locked || blocked !== null;
  const note =
    blocked ??
    (locked
      ? 'Your side is fixed after your first post or vote.'
      : stance
        ? 'You can change sides until you first post or vote.'
        : 'Pick a side to post and vote. You can change it until your first post or vote.');

  return (
    <fieldset aria-describedby={noteId} aria-busy={busy} className="flex flex-col gap-2">
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        Your side
      </legend>
      <div className="grid grid-cols-3 gap-2">
        {ORDER.map((side, index) => (
          <label key={side} className="relative">
            <input
              ref={index === 0 ? firstOption : undefined}
              type="radio"
              name="stance"
              value={side}
              checked={stance?.stance === side}
              disabled={disabled && stance?.stance !== side}
              aria-disabled={disabled}
              onChange={() => {
                if (!disabled) onPick(side);
              }}
              className="peer sr-only"
            />
            <span className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-ink/15 px-2 py-2 text-center text-sm text-ink peer-checked:border-accent peer-checked:bg-accent/15 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent peer-disabled:opacity-50">
              <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${DOT[side]}`} />
              <span className="line-clamp-2">{sideName(side, info)}</span>
            </span>
          </label>
        ))}
      </div>
      <p id={noteId} className="text-xs text-muted">
        {note}
      </p>
    </fieldset>
  );
});
