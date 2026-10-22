import { useRef, type JSX, type KeyboardEvent } from 'react';

import { ADMIN_TABS, panelId, tabId, type AdminTab } from './adminView';

export interface AdminTabsProps {
  readonly tab: AdminTab;
  /** What each tab holds now, when known: shown after its name. */
  readonly counts: Readonly<Partial<Record<AdminTab, number>>>;
  onSelect(tab: AdminTab): void;
}

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/**
 * The console's three tabs, an ARIA tablist: arrow keys move between them,
 * Home and End jump, and each is a real link-shaped path (/admin/moderation),
 * so a tab can be bookmarked for 8am.
 */
export function AdminTabs({ tab, counts, onSelect }: AdminTabsProps): JSX.Element {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = ADMIN_TABS.findIndex((entry) => entry.id === tab);
    const last = ADMIN_TABS.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % ADMIN_TABS.length
        : event.key === 'ArrowLeft'
          ? (index + last) % ADMIN_TABS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    const target = ADMIN_TABS[next];
    if (target === undefined) return;
    onSelect(target.id);
    buttons.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Admin console"
      onKeyDown={onKeyDown}
      className="flex gap-1 border-b border-ink/10"
    >
      {ADMIN_TABS.map((entry, index) => {
        const selected = entry.id === tab;
        const count = counts[entry.id];
        return (
          <button
            key={entry.id}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            id={tabId(entry.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId(entry.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(entry.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${FOCUS} ${
              selected ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {entry.label}
            {count !== undefined && <span className="ml-1.5 text-xs text-muted">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
