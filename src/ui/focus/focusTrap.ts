import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * Focus within dialogs (Prompt 5.1): what Tab can reach inside an element,
 * and the wrap that keeps a modal's focus inside it. One definition, so the
 * account sheets, onboarding and the discussion panel agree.
 */

const CANDIDATES = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(', ');

/** A radio Tab skips: one of a named group that has another member checked. */
function skippedRadio(element: HTMLElement, root: HTMLElement): boolean {
  if (!(element instanceof HTMLInputElement) || element.type !== 'radio' || element.checked) {
    return false;
  }
  if (element.name === '') return false;
  const group = root.querySelectorAll<HTMLInputElement>(
    `input[type="radio"][name="${CSS.escape(element.name)}"]`,
  );
  return [...group].some((radio) => radio.checked);
}

/**
 * Everything Tab can reach inside `root`, in order: enabled, not taken out
 * of the order (tabindex −1), not inside an inert or hidden subtree, laid
 * out, and only the checked radio of a group.
 */
export function tabbable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(CANDIDATES)].filter(
    (element) =>
      element.tabIndex >= 0 &&
      element.closest('[inert], [hidden]') === null &&
      element.getClientRects().length > 0 &&
      !skippedRadio(element, root),
  );
}

/**
 * Keeps Tab inside `root` (a modal): from the last element it wraps to the
 * first, and Shift+Tab from the first to the last. Returns true when it
 * moved focus itself.
 */
export function trapTab(event: KeyboardEvent | ReactKeyboardEvent, root: HTMLElement): boolean {
  if (event.key !== 'Tab') return false;
  const items = tabbable(root);
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) {
    // Nothing to tab to: stay put rather than leave the dialog.
    event.preventDefault();
    return true;
  }
  const active = document.activeElement;
  const outside = !(active instanceof Node) || !root.contains(active);
  // A heading that took focus on opening (tabindex −1) is not in the list,
  // but Shift+Tab from it, before the first item, must wrap all the same.
  const atOrBefore = (item: HTMLElement): boolean =>
    active === item ||
    (active instanceof Node &&
      (active.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
  const atOrAfter = (item: HTMLElement): boolean =>
    active === item ||
    (active instanceof Node &&
      (active.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_PRECEDING) !== 0);
  if (event.shiftKey && (outside || atOrBefore(first))) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && (outside || atOrAfter(last))) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
