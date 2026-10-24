import type { JSX } from 'react';

import type { StorySort } from '@/core';
import { useViewStore, viewStore } from '@/state';

const SORT =
  'flex h-8 cursor-pointer items-center rounded-full px-3 text-xs font-medium text-ink ' +
  'has-[:checked]:bg-white/10 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent';

const ORDERS: readonly (readonly [StorySort, string])[] = [
  ['newest', 'Newest'],
  ['covered', 'Most covered'],
];

/** The list's order, as native radios: Newest or Most covered (Prompt 5.1). */
export function StorySortSwitch({ name }: { readonly name: string }): JSX.Element {
  const sort = useViewStore((state) => state.sort);
  return (
    <fieldset className="flex gap-0.5 rounded-full border border-ink/20 p-0.5">
      <legend className="sr-only">Order</legend>
      {ORDERS.map(([value, label]) => (
        <label key={value} className={SORT}>
          <input
            type="radio"
            name={name}
            value={value}
            checked={sort === value}
            onChange={() => viewStore.getState().setSort(value)}
            className="sr-only"
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}
