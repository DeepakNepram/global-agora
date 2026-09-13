import { useEffect, useId, type JSX } from 'react';

import type { EarthChannel } from '@/globe';

import { CHANNEL_OPTIONS, CLOUDS_KEY, VIEW_PRESETS, type ViewPresetId } from './debugControls';
import { TimeDebugControls } from './TimeDebugControls';

export interface GlobeDebugPanelProps {
  readonly view: ViewPresetId;
  readonly onViewChange: (view: ViewPresetId) => void;
  readonly channel: EarthChannel;
  readonly onChannelChange: (channel: EarthChannel) => void;
  readonly cloudsVisible: boolean;
  readonly onCloudsVisibleChange: (visible: boolean) => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

const BUTTON =
  'rounded px-2 py-1 text-left text-xs text-ink hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent aria-pressed:bg-accent aria-pressed:text-void';

// Inherits the button's colour at reduced opacity rather than using text-muted,
// which drops to near-invisible on the accent background of a pressed button.
const KBD = 'mr-2 opacity-70';

/**
 * UV-mapping inspection for Phase 1.1. Every control is a real <button> with
 * aria-pressed, so Tab/Space/Enter work with no extra code; the single-key
 * shortcuts are a convenience on top of that, not the only path.
 */
export function GlobeDebugPanel(props: GlobeDebugPanelProps): JSX.Element {
  const { view, onViewChange, channel, onChannelChange, cloudsVisible, onCloudsVisibleChange } =
    props;
  const viewsLabel = useId();
  const channelsLabel = useId();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();

      const preset = VIEW_PRESETS.find((p) => p.key === key);
      if (preset) return onViewChange(preset.id);

      const option = CHANNEL_OPTIONS.find((o) => o.key === key);
      if (option) return onChannelChange(option.id);

      if (key === CLOUDS_KEY) onCloudsVisibleChange(!cloudsVisible);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onViewChange, onChannelChange, onCloudsVisibleChange, cloudsVisible]);

  return (
    <aside
      aria-label="Globe inspection controls"
      className="absolute right-4 top-4 flex w-52 flex-col gap-3 rounded-lg bg-void/80 p-3 backdrop-blur"
    >
      <div role="group" aria-labelledby={viewsLabel} className="flex flex-col gap-1">
        <p id={viewsLabel} className="text-[11px] uppercase tracking-wide text-muted">
          View
        </p>
        {VIEW_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={BUTTON}
            aria-pressed={view === preset.id}
            aria-keyshortcuts={preset.key}
            onClick={() => onViewChange(preset.id)}
          >
            <kbd className={KBD}>{preset.key}</kbd>
            {preset.label}
          </button>
        ))}
      </div>

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
