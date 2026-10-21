/**
 * Brings a post to the middle of the panel by scrolling the panel alone.
 * Not scrollIntoView: that scrolls every ancestor that can scroll, the
 * globe's overflow-hidden frame included, and shifted the whole app.
 */
export function scrollPostIntoPanel(scroller: HTMLElement | null, id: string): HTMLElement | null {
  const item = scroller?.querySelector<HTMLElement>(`[data-post-id="${CSS.escape(id)}"]`) ?? null;
  if (!scroller || !item) return null;
  const centre =
    scroller.scrollTop +
    item.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top -
    (scroller.clientHeight - item.offsetHeight) / 2;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  scroller.scrollTo({ top: Math.max(0, centre), behavior: still ? 'auto' : 'smooth' });
  return item;
}
