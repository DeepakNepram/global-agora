import { useSyncExternalStore } from 'react';

import { wallClockNow } from '@/state';

import { afterStart } from './afterStart';

/**
 * Registers the service worker (src/sw/sw.ts, Prompt 5.2) and reports when a
 * new build has installed and is waiting, so the page can offer a reload
 * rather than switch code under a reader mid-session.
 */

/** An installed app can stay open for days: look for a new build at most this often. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();

function setWaiting(worker: ServiceWorker): void {
  waiting = worker;
  for (const listener of listeners) listener();
}

function watch(registration: ServiceWorkerRegistration): void {
  // A first install has no controller: there is nothing to replace, so nothing to offer.
  if (registration.waiting && navigator.serviceWorker.controller) setWaiting(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    installing?.addEventListener('statechange', () => {
      if (installing.state === 'installed' && navigator.serviceWorker.controller) {
        setWaiting(installing);
      }
    });
  });

  let checkedAt = wallClockNow();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || wallClockNow() - checkedAt < UPDATE_CHECK_MS)
      return;
    checkedAt = wallClockNow();
    registration.update().catch(() => undefined);
  });
}

/**
 * In production builds only: development has no shell to cache, and
 * benchmark builds must measure the network as a first visit sees it.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || import.meta.env.MODE === 'bench') return;
  if (!('serviceWorker' in navigator)) return;
  afterStart(() => {
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then(watch, (error: unknown) => console.warn('The offline shell could not install.', error));
  });
}

/** Switches to the waiting build and reloads into it. */
export function applyUpdate(): void {
  const worker = waiting;
  if (!worker) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
    once: true,
  });
  worker.postMessage({ type: 'skip-waiting' });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True once a new build is waiting for "Reload". */
export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => waiting !== null,
    () => false,
  );
}
