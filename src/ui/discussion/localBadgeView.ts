import type { LocalBadgeStatus } from '@/state/localBadge';

/**
 * What the local badge toggle says in each state (Prompt 4.4). It is off by
 * default and can only be turned on when the Worker says this network has a
 * city; otherwise it is disabled, and its note says why.
 */
export interface LocalBadgeView {
  readonly disabled: boolean;
  /** The checkbox's label. */
  readonly label: string;
  /** The one line under it, also its accessible description. */
  readonly note: string;
}

/** The prompt's one line: approximate, from the network, and fallible. */
export const LOCAL_BADGE_NOTE = 'Uses your approximate network location, which can be wrong.';

const GENERIC = 'Show your area on this post';

export function localBadgeView(status: LocalBadgeStatus): LocalBadgeView {
  switch (status.kind) {
    case 'available':
      return {
        disabled: false,
        label: `Show “${status.label}” on this post`,
        note: LOCAL_BADGE_NOTE,
      };
    case 'checking':
      return {
        disabled: true,
        label: GENERIC,
        note: 'Checking your approximate network location…',
      };
    case 'no-city':
      return {
        disabled: true,
        label: GENERIC,
        note: "Your network location doesn't include a city, so this post can't show an area.",
      };
    case 'unavailable':
      return { disabled: true, label: GENERIC, note: "Area badges aren't available right now." };
    case 'failed':
      return {
        disabled: true,
        label: GENERIC,
        note: "Couldn't check your network location, so this post can't show an area.",
      };
  }
}
