import type { JSX } from 'react';

export interface DiscussionPanelProps {
  /** The story's uuid, which keys its discussion. */
  readonly storyId: string;
  /** The heading's id: it names the dialog and takes focus on entering. */
  readonly titleId: string;
}

/**
 * The discussion itself, its own chunk (loadDiscussion.ts). The stage
 * (Prompt 4.5) mounts it; what it shows follows in the next step.
 */
export function DiscussionPanel({ titleId }: DiscussionPanelProps): JSX.Element {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
      <h2 id={titleId} tabIndex={-1} className="text-lg font-semibold leading-snug outline-none">
        Discussion
      </h2>
    </div>
  );
}
