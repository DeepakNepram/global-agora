import { useEffect, useId, type JSX } from 'react';

import {
  CLUSTERS_KEY,
  DEBUG_BUTTON,
  DEBUG_KBD,
  PIN_COUNTS,
  PINS_KEY,
  STACK_LOAD,
  isTypingTarget,
  type PinSource,
} from './debugControls';

export interface PinDebugControlsProps {
  readonly visible: boolean;
  readonly onVisibleChange: (visible: boolean) => void;
  readonly source: PinSource;
  readonly onSourceChange: (source: PinSource) => void;
  readonly clustering: boolean;
  readonly onClusteringChange: (clustering: boolean) => void;
}

/**
 * Shows or hides the pins, turns clustering on and off, and switches between
 * live news and the mock loads.
 */
export function PinDebugControls(props: PinDebugControlsProps): JSX.Element {
  const { visible, onVisibleChange, source, onSourceChange, clustering, onClusteringChange } =
    props;
  const labelId = useId();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === PINS_KEY) onVisibleChange(!visible);
      if (key === CLUSTERS_KEY) onClusteringChange(!clustering);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visible, onVisibleChange, clustering, onClusteringChange]);

  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-1">
      <p id={labelId} className="text-[11px] uppercase tracking-wide text-muted">
        Pins
      </p>
      <button
        type="button"
        className={DEBUG_BUTTON}
        aria-pressed={visible}
        aria-keyshortcuts={PINS_KEY.toUpperCase()}
        onClick={() => onVisibleChange(!visible)}
      >
        <kbd className={DEBUG_KBD}>{PINS_KEY.toUpperCase()}</kbd>
        Show pins
      </button>
      <button
        type="button"
        className={DEBUG_BUTTON}
        aria-pressed={clustering}
        aria-keyshortcuts={CLUSTERS_KEY.toUpperCase()}
        onClick={() => onClusteringChange(!clustering)}
      >
        <kbd className={DEBUG_KBD}>{CLUSTERS_KEY.toUpperCase()}</kbd>
        Cluster
      </button>
      <button
        type="button"
        className={DEBUG_BUTTON}
        aria-pressed={source === 'live'}
        onClick={() => onSourceChange('live')}
      >
        Live news
      </button>
      {PIN_COUNTS.map((option) => (
        <button
          key={option}
          type="button"
          className={DEBUG_BUTTON}
          aria-pressed={source === option}
          onClick={() => onSourceChange(option)}
        >
          {option.toLocaleString('en-GB')} mock stories
        </button>
      ))}
      <button
        type="button"
        className={DEBUG_BUTTON}
        aria-pressed={source === 'stack'}
        onClick={() => onSourceChange('stack')}
      >
        {STACK_LOAD.base.toLocaleString('en-GB')} mock + {STACK_LOAD.stack.count} stacked
      </button>
    </div>
  );
}
