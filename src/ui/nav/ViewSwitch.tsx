import { useId, type JSX } from 'react';

import { viewStore, useViewStore, type NewsLayout } from '@/state';

export interface ViewSwitchProps {
  /** "Globe", or "Map" under reduced motion (Prompt 5.1). */
  readonly visualLabel: string;
}

const SEGMENT =
  'flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-medium text-ink ' +
  'has-[:checked]:bg-ink has-[:checked]:text-void has-[:focus-visible]:outline has-[:focus-visible]:outline-2 ' +
  'has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent';

function GlobeIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 fill-none stroke-current">
      <circle cx="8" cy="8" r="6" strokeWidth="1.4" />
      <path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" strokeWidth="1.2" />
    </svg>
  );
}

function ListIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 fill-none stroke-current">
      <path
        d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.5M2.5 8h.5M2.5 12h.5"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Globe (or Map) and List: the same stories either way, and the list is a
 * view in its own right, not a fallback (Prompt 5.1). Native radios, so the
 * arrow keys and screen readers treat it as the one choice it is; the
 * choice stays on this device.
 */
export function ViewSwitch({ visualLabel }: ViewSwitchProps): JSX.Element {
  const layout = useViewStore((state) => state.layout);
  const name = useId();
  const options: readonly { readonly value: NewsLayout; readonly label: string }[] = [
    { value: 'visual', label: visualLabel },
    { value: 'list', label: 'List' },
  ];

  return (
    <fieldset className="flex shrink-0 gap-0.5 rounded-full border border-ink/20 bg-panel/80 p-0.5">
      <legend className="sr-only">Show the stories as</legend>
      {options.map((option) => (
        <label key={option.value} className={SEGMENT}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={layout === option.value}
            onChange={() => viewStore.getState().setLayout(option.value)}
            className="sr-only"
          />
          {option.value === 'list' ? <ListIcon /> : <GlobeIcon />}
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
