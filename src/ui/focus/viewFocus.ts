/**
 * Where focus goes back to when a story's sheet closes (Prompt 5.1): to the
 * view showing the stories. The globe by default; the list registers the
 * row the story was opened from, the flat map its own surface.
 */

type FocusFinder = () => HTMLElement | null;

let finder: FocusFinder | null = null;

/** The active view's focus target; null hands back to the globe. Returns the unregister. */
export function setViewFocus(find: FocusFinder): () => void {
  finder = find;
  return () => {
    if (finder === find) finder = null;
  };
}

/** The element focus should return to, if any is on screen. */
export function viewFocusTarget(): HTMLElement | null {
  return finder?.() ?? document.querySelector<HTMLElement>('[aria-roledescription="globe"]');
}

/**
 * Focuses the view. Without scrolling: the app's frame is overflow-hidden,
 * and a scroll there shifts the whole page (Prompt 4.5's trap); the list
 * brings its own row into view.
 */
export function focusView(): void {
  viewFocusTarget()?.focus({ preventScroll: true });
}

/** How much of `scroller`'s height, from the bottom up, the scrubber or an open sheet covers. */
function coveredBelow(scroller: HTMLElement): number {
  const box = scroller.getBoundingClientRect();
  let top = box.bottom;
  for (const cover of document.querySelectorAll<HTMLElement>('[data-covers="bottom"]')) {
    const rect = cover.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) top = Math.min(top, rect.top);
  }
  return Math.max(0, box.bottom - top);
}

/** How much of `scroller`'s height, from the top down, the search bar and filters cover. */
function coveredAbove(scroller: HTMLElement): number {
  const box = scroller.getBoundingClientRect();
  let bottom = box.top;
  for (const cover of document.querySelectorAll<HTMLElement>('[data-covers="top"]')) {
    const rect = cover.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) bottom = Math.max(bottom, rect.bottom);
  }
  return Math.max(0, bottom - box.top);
}

/**
 * Scrolls `scroller` (by setting scrollTop) just enough to show `element`
 * in the part nothing covers: below the search bar, above the scrubber or
 * an open sheet.
 */
export function revealIn(scroller: HTMLElement, element: HTMLElement): void {
  const box = scroller.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const margin = 12;
  const below = rect.bottom - (box.bottom - coveredBelow(scroller)) + margin;
  const above = box.top + coveredAbove(scroller) - rect.top + margin;
  if (above > 0) scroller.scrollTop -= above;
  else if (below > 0) scroller.scrollTop += below;
}
