/** A no-break space: invisible, but enough to make a repeated message differ. */
const NBSP = String.fromCharCode(0xa0);

/**
 * The next text for a polite live region. A region only speaks when its text
 * changes, so saying the same thing twice (a second Enter on empty globe, a
 * second save) alternates a trailing no-break space.
 */
export function nextAnnouncement(previous: string, text: string): string {
  return previous === text ? `${text}${NBSP}` : text;
}
