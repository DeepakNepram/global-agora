import { useEffect, useId, type ReactElement } from 'react';

import type { LocalBadgeStatus } from '@/state/localBadge';

import { localBadgeView } from './localBadgeView';

interface LocalBadgeToggleProps {
  readonly status: LocalBadgeStatus;
  /** The composer's choice for this post; it starts false for every post. */
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

/**
 * The per-post local badge toggle (Prompt 4.4), for Prompt 4.5's composer. A
 * native checkbox, so it has a keyboard path and a role without help; its
 * note is its accessible description. While disabled it is never on: a
 * choice made before the network lost its city is handed back as off.
 */
export function LocalBadgeToggle({
  status,
  checked,
  onChange,
}: LocalBadgeToggleProps): ReactElement {
  const id = useId();
  const view = localBadgeView(status);
  const on = checked && !view.disabled;

  useEffect(() => {
    if (view.disabled && checked) onChange(false);
  }, [view.disabled, checked, onChange]);

  return (
    <div className="flex items-start gap-3">
      <input
        id={`${id}-badge`}
        type="checkbox"
        checked={on}
        disabled={view.disabled}
        aria-describedby={`${id}-note`}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-5 shrink-0 accent-accent disabled:opacity-50"
      />
      <div className="min-w-0">
        <label
          htmlFor={`${id}-badge`}
          className={`block text-sm ${view.disabled ? 'text-muted' : 'text-ink'}`}
        >
          {view.label}
        </label>
        <p id={`${id}-note`} aria-live="polite" className="mt-0.5 text-xs text-muted">
          {view.note}
        </p>
      </div>
    </div>
  );
}
