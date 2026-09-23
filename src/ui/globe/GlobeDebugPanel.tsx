import { useEffect, useId, type JSX, type ReactNode } from 'react';

import type { EarthChannel } from '@/globe';

import {
  CHANNEL_OPTIONS,
  CLOUDS_KEY,
  DEBUG_BUTTON as BUTTON,
  DEBUG_KBD as KBD,
  isTypingTarget,
} from './debugControls';
import { TimeDebugControls } from './TimeDebugControls';

export interface GlobeDebugPanelProps {
  readonly channel: EarthChannel;
  readonly onChannelChange: (channel: EarthChannel) => void;
  readonly cloudsVisible: boolean;
  readonly onCloudsVisibleChange: (visible: boolean) => void;
  /** Extra control groups (camera, render), placed before the texture group. */
  readonly children?: ReactNode;
  /** Hidden, not unmounted, so a benchmark running inside keeps going. */
  readonly hidden?: boolean;
}

/**
 * Dev inspection panel. Every control is a real <button> with
 * aria-pressed, so Tab/Space/Enter work with no extra code; the single-key
 * shortcuts are a convenience on top of that, not the only path.
 */
export function GlobeDebugPanel(props: GlobeDebugPanelProps): JSX.Element {
  const { channel, onChannelChange, cloudsVisible, onCloudsVisibleChange, children, hidden } =
    props;
  const channelsLabel = useId();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();

      const option = CHANNEL_OPTIONS.find((o) => o.key === key);
      if (option) return onChannelChange(option.id);

      if (key === CLOUDS_KEY) onCloudsVisibleChange(!cloudsVisible);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onChannelChange, onCloudsVisibleChange, cloudsVisible]);

  return (
    <aside
      hidden={hidden}
      aria-label="Globe inspection controls"
      className="absolute right-4 top-4 flex max-h-[calc(100%-2rem)] w-52 flex-col gap-3 overflow-y-auto rounded-lg bg-void/80 p-3 backdrop-blur"
    >
      {children}

      <div role="group" aria-labelledby={channelsLabel} className="flex flex-col gap-1">
        <p id={channelsLabel} className="text-[11px] uppercase tracking-wide text-muted">
          Texture
        </p>
        {CHANNEL_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={BUTTON}
            aria-pressed={channel === option.id}
            aria-keyshortcuts={option.key.toUpperCase()}
            onClick={() => onChannelChange(option.id)}
          >
            <kbd className={KBD}>{option.key.toUpperCase()}</kbd>
            {option.label}
          </button>
        ))}
        <button
          type="button"
          className={BUTTON}
          aria-pressed={cloudsVisible}
          aria-keyshortcuts={CLOUDS_KEY.toUpperCase()}
          onClick={() => onCloudsVisibleChange(!cloudsVisible)}
        >
          <kbd className={KBD}>{CLOUDS_KEY.toUpperCase()}</kbd>
          Clouds
        </button>
      </div>

      <TimeDebugControls />
    </aside>
  );
}
