/** Class names the account sheets share, matching onboarding and the library. */

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export const BUTTON = `h-10 rounded-full px-4 text-sm font-medium ${FOCUS}`;
export const PRIMARY = `${BUTTON} bg-accent text-void hover:bg-accent/90`;
export const SECONDARY = `${BUTTON} border border-ink/20 text-ink hover:bg-white/10`;
export const QUIET = `${BUTTON} text-muted hover:text-ink`;
export const DANGER = `${BUTTON} bg-red-400 text-void hover:bg-red-300`;

export const INPUT = `h-10 w-full rounded-full border border-edge bg-void px-4 text-sm text-ink placeholder:text-muted ${FOCUS}`;
export const LABEL = 'mb-1 block text-xs text-muted';

export const HEADING = 'text-lg font-semibold text-ink outline-none';
export const BODY = 'text-sm text-muted';
