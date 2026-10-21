import { memo, type JSX } from 'react';

import type { AuthProvider, NodeBuffer } from '@/core';
import { VIGNETTE, type OrbitGlobeControls, type RenderSettings } from '@/globe';

import { AccountButton } from './account/AccountButton';
import { DiscussionLayer } from './discussion/DiscussionLayer';
import { vignetteCssGradient } from './globe/vignette';
import { LibraryButtons } from './library/LibraryButtons';
import type { GlobeTarget } from './nav/globeNavigation';
import { NavLayer } from './nav/NavLayer';
import { TimeScrubber } from './scrubber/TimeScrubber';
import { SecondarySheets } from './SecondarySheets';
import { StoryLayer } from './story/StoryLayer';

export interface GlobeLayersProps {
  readonly settings: RenderSettings;
  readonly nodes: NodeBuffer | null;
  readonly target: GlobeTarget;
  readonly controls: OrbitGlobeControls | null;
  readonly apiBaseUrl: string;
  readonly historyHours: number;
  readonly savedStoryLimit: number;
  readonly detailsAvailable: boolean;
  readonly reducedMotion: boolean;
  readonly authProviders: readonly AuthProvider[] | null;
  /** A story or library sheet holds the bottom edge. */
  readonly sheetOpen: boolean;
  /** A discussion is entering, open or leaving (Prompt 4.5). */
  readonly inDiscussion: boolean;
}

/**
 * Everything over the globe, in stacking order. In a discussion the search
 * and filters step away and go inert, the scrubber slides off, and the panel
 * covers the rest; the account's sheets stay live above it, so signing in to
 * take part works from inside. Memoised: the canvas re-renders when the
 * discussion's resolution changes, and nothing here needs to with it.
 */
export const GlobeLayers = memo(function GlobeLayers(props: GlobeLayersProps): JSX.Element {
  const { settings, nodes, target, controls, historyHours, reducedMotion, inDiscussion } = props;
  return (
    <>
      {!settings.postprocessing && (
        // LOW has no composer; a CSS vignette matching VignetteEffect costs no GPU pass.
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: vignetteCssGradient(VIGNETTE) }}
        />
      )}

      <div
        inert={inDiscussion}
        className={`pointer-events-none absolute inset-0 transition duration-300 ${inDiscussion ? '-translate-y-3 opacity-0' : ''}`}
      >
        <NavLayer
          nodes={nodes}
          target={target}
          apiBaseUrl={props.apiBaseUrl}
          historyHours={historyHours}
          actions={
            <>
              <LibraryButtons />
              {props.authProviders !== null && <AccountButton />}
            </>
          }
        />
      </div>
      <TimeScrubber
        nodes={nodes}
        historyHours={historyHours}
        hidden={props.sheetOpen || inDiscussion}
      />
      <SecondarySheets
        nodes={nodes}
        target={target}
        historyHours={historyHours}
        savedStoryLimit={props.savedStoryLimit}
        reducedMotion={reducedMotion}
        authProviders={props.authProviders}
      />
      <StoryLayer
        nodes={nodes}
        controls={controls}
        apiBaseUrl={props.apiBaseUrl}
        savedStoryLimit={props.savedStoryLimit}
        detailsAvailable={props.detailsAvailable}
        reducedMotion={reducedMotion}
      />
      <DiscussionLayer scrim={!settings.postprocessing} apiBaseUrl={props.apiBaseUrl} />
    </>
  );
});
