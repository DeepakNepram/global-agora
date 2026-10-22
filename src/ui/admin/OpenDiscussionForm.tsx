import { useEffect, useId, useRef, type JSX, type KeyboardEvent } from 'react';

import { charCount, PROMPT_MAX_CHARS, SIDE_MAX_CHARS } from '@/core/admin';
import type { DraftField, OpenForm } from '@/state/adminConsoleStore';

import { INPUT, LABEL, PRIMARY, QUIET, SECONDARY } from '../account/accountStyles';
import { draftProblemText, suggestionNoteText } from './adminView';

export interface OpenDiscussionFormProps {
  readonly form: OpenForm;
  /** The story's headline, which names the form for screen readers. */
  readonly title: string;
  /** At the cap, Open waits; the words can still be prepared. */
  readonly capped: boolean;
  onEdit(field: DraftField, value: string): void;
  onSuggestAgain(): void;
  onCancel(): void;
  onConfirm(): void;
}

const FIELDS: readonly {
  readonly field: DraftField;
  readonly label: string;
  readonly max: number;
}[] = [
  { field: 'prompt', label: 'Debate question', max: PROMPT_MAX_CHARS },
  { field: 'sideA', label: 'Side A (answers yes)', max: SIDE_MAX_CHARS },
  { field: 'sideB', label: 'Side B (answers no)', max: SIDE_MAX_CHARS },
];

/**
 * The three words of a debate, under the story they open: shown at once,
 * filled by Claude's suggestion when it comes (never over what was typed).
 * Ctrl+Enter opens, Escape cancels.
 */
export function OpenDiscussionForm({
  form,
  title,
  capped,
  onEdit,
  onSuggestAgain,
  onCancel,
  onConfirm,
}: OpenDiscussionFormProps): JSX.Element {
  const id = useId();
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (!capped) onConfirm();
    }
  };

  return (
    <form
      aria-label={`Open a discussion on “${title}”`}
      className="mt-3 flex flex-col gap-3 rounded-lg border border-accent/40 p-3"
      onKeyDown={onKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        if (!capped) onConfirm();
      }}
    >
      <p aria-live="polite" className="min-h-5 text-xs text-muted">
        {suggestionNoteText(form.note, form.suggesting)}
      </p>
      {FIELDS.map(({ field, label, max }, index) => {
        const value = form.draft[field];
        const count = charCount(value.trim());
        return (
          <div key={field}>
            <label htmlFor={`${id}-${field}`} className={LABEL}>
              {label}
            </label>
            <input
              ref={index === 0 ? first : undefined}
              id={`${id}-${field}`}
              type="text"
              value={value}
              disabled={form.sending}
              aria-describedby={`${id}-${field}-count`}
              onChange={(event) => onEdit(field, event.target.value)}
              className={INPUT}
            />
            <p
              id={`${id}-${field}-count`}
              className={`mt-1 text-right text-xs tabular-nums ${count > max ? 'text-red-300' : 'text-muted'}`}
            >
              {count}/{max}
            </p>
          </div>
        );
      })}
      {form.problem !== null && (
        <p role="alert" className="text-sm text-red-300">
          {draftProblemText(form.problem)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className={PRIMARY}
          disabled={form.sending || capped}
          aria-keyshortcuts="Control+Enter"
        >
          {form.sending ? 'Opening…' : 'Open discussion'}
        </button>
        <button
          type="button"
          className={SECONDARY}
          disabled={form.sending || form.suggesting}
          onClick={onSuggestAgain}
        >
          Suggest again
        </button>
        <button
          type="button"
          className={QUIET}
          disabled={form.sending}
          onClick={onCancel}
          aria-keyshortcuts="Escape"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
