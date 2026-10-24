/**
 * Runs `task` once the page has loaded and the browser is idle: work that
 * must never compete with the globe's first frame (installing the offline
 * shell, loading the error reporter). Safari has no requestIdleCallback.
 */
export function afterStart(task: () => void): void {
  const idle = (): void => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(task, { timeout: 5000 });
    } else {
      window.setTimeout(task, 1000);
    }
  };
  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle, { once: true });
}
