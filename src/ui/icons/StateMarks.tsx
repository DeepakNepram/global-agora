import { useId, type JSX } from 'react';

/**
 * Marks for a chosen or pressed state (Prompt 5.1): a shape, so the state
 * never rests on a colour change alone. Decorative: the control's own
 * aria-pressed or checked state says it to a screen reader.
 */

/** A check, in the text colour: a chosen side or kind. */
export function CheckMark(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-3.5 shrink-0 fill-none stroke-current"
    >
      <path d="M3 8.5l3.2 3L13 4.5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A filled disc with the check cut out of it, in the text colour: a vote
 * cast. Cut out (a mask), not drawn in a second colour, so it reads on any
 * button behind it.
 */
export function VotedMark(): JSX.Element {
  const mask = useId();
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0">
      <mask id={mask}>
        <rect width="16" height="16" fill="white" />
        <path
          d="M4.6 8.2l2.3 2.2 4.4-4.8"
          fill="none"
          stroke="black"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </mask>
      <circle cx="8" cy="8" r="7" fill="currentColor" mask={`url(#${mask})`} />
    </svg>
  );
}
