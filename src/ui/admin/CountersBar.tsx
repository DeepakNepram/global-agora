import type { JSX } from 'react';

import type { AdminCounters } from '@/core/admin';

import { counterCells } from './adminView';

export interface CountersBarProps {
  readonly counters: AdminCounters | null;
}

/** The four numbers to read first at 8am, as a definition list. */
export function CountersBar({ counters }: CountersBarProps): JSX.Element {
  if (counters === null) {
    return <p className="h-16 text-sm text-muted">Loading the counters…</p>;
  }
  return (
    <dl aria-label="Counters" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {counterCells(counters).map((cell) => (
        <div key={cell.label} className="rounded-lg border border-ink/10 px-3 py-2">
          <dt className="text-xs text-muted">{cell.label}</dt>
          <dd className="text-lg font-semibold tabular-nums text-ink">{cell.value}</dd>
          {cell.detail !== null && <dd className="text-xs text-muted">{cell.detail}</dd>}
        </div>
      ))}
    </dl>
  );
}
