import type { NodeBuffer } from '../nodeBuffer';

import { fetchNodes, type FetchLike } from './nodes';

/**
 * Keeps the globe's stories current: fetches the payload now, then re-checks
 * every `refreshMs`, conditionally, so an unchanged payload costs a 304 and no
 * decode. Failures retry sooner, backing off from 5 s up to the refresh
 * interval. The host pauses it while the page is hidden and resumes it (with
 * an immediate check) when the page is back.
 *
 * Timers are injected so tests drive time; no DOM, so a native shell can host
 * it unchanged.
 */

export interface NodesFeedCallbacks {
  onUpdate(nodes: NodeBuffer, etag: string | null): void;
  onUnchanged(etag: string | null): void;
  /** `failures` counts consecutive failed checks, from 1. */
  onError(error: unknown, failures: number): void;
}

export interface Timers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface NodesFeedOptions extends NodesFeedCallbacks {
  readonly baseUrl: string;
  readonly hours: number;
  readonly refreshMs: number;
  readonly fetch: FetchLike;
  readonly timers: Timers;
}

export interface NodesFeed {
  /** Stops checking until resume(). An in-flight check still lands. */
  pause(): void;
  /** Checks now, then keeps to the schedule. */
  resume(): void;
  /** For good: aborts an in-flight check. */
  stop(): void;
}

const FIRST_RETRY_MS = 5000;

/** 5 s, 10 s, 20 s… never longer than the normal refresh. */
export function retryDelayMs(failures: number, refreshMs: number): number {
  return Math.min(refreshMs, FIRST_RETRY_MS * 2 ** Math.max(0, failures - 1));
}

export function startNodesFeed(options: NodesFeedOptions): NodesFeed {
  const { timers } = options;
  let etag: string | null = null;
  let failures = 0;
  let timer: unknown = null;
  let controller: AbortController | null = null;
  let paused = false;
  let stopped = false;

  const clearTimer = (): void => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };

  const schedule = (ms: number): void => {
    clearTimer();
    if (!paused && !stopped) timer = timers.set(() => void check(), ms);
  };

  async function check(): Promise<void> {
    if (stopped || controller !== null) return;
    clearTimer();
    controller = new AbortController();
    try {
      const result = await fetchNodes({
        baseUrl: options.baseUrl,
        hours: options.hours,
        fetch: options.fetch,
        signal: controller.signal,
        etag,
      });
      if (stopped) return;
      failures = 0;
      etag = result.etag;
      if (result.status === 'updated') options.onUpdate(result.nodes, result.etag);
      else options.onUnchanged(result.etag);
      schedule(options.refreshMs);
    } catch (error) {
      if (stopped) return;
      failures++;
      options.onError(error, failures);
      schedule(retryDelayMs(failures, options.refreshMs));
    } finally {
      controller = null;
    }
  }

  void check();

  return {
    pause() {
      paused = true;
      clearTimer();
    },
    resume() {
      paused = false;
      void check();
    },
    stop() {
      stopped = true;
      clearTimer();
      controller?.abort();
    },
  };
}
