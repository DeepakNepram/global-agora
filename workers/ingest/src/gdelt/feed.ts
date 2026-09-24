/**
 * The GDELT 2.0 file feed: a manifest of the latest files, and one zip per
 * 15-minute slot.
 *
 * Observed on 2026-09-24: `lastupdate.txt` names a slot about an hour before
 * that slot's GKG file exists (09:00-09:45 were listed but 404 while 08:45
 * downloaded). So a 404 means "not yet", never an error, and callers walk
 * forward from the last slot they finished rather than trusting the manifest.
 */

import { isSlot } from './slots.ts';
import { unzipText } from './zip.ts';

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class FeedError extends Error {
  override readonly name = 'FeedError';
}

export interface Feed {
  /** The GKG slot the manifest currently names (possibly not downloadable yet). */
  latestListedSlot(): Promise<string>;
  /** Whether a slot's file exists, without downloading it. */
  hasSlot(slot: string): Promise<boolean>;
  /** A slot's GKG file as text, or null if it is not published (yet). */
  fetchSlot(slot: string): Promise<{ text: string; bytes: number } | null>;
}

export function gkgUrl(baseUrl: string, slot: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${slot}.gkg.csv.zip`;
}

/** The slot of the GKG line in a `lastupdate.txt` body ("size md5 url" per line). */
export function parseManifest(body: string): string | null {
  for (const line of body.split('\n')) {
    const url = line.trim().split(/\s+/)[2];
    const match = url === undefined ? null : /\/(\d{14})\.gkg\.csv\.zip$/.exec(url);
    if (match?.[1] !== undefined && isSlot(match[1])) return match[1];
  }
  return null;
}

export function createFeed(baseUrl: string, fetchFn: Fetch = fetch): Feed {
  const base = baseUrl.replace(/\/+$/, '');

  return {
    async latestListedSlot(): Promise<string> {
      const response = await fetchFn(`${base}/lastupdate.txt`);
      if (!response.ok) throw new FeedError(`lastupdate.txt: HTTP ${response.status}`);
      const slot = parseManifest(await response.text());
      if (slot === null) throw new FeedError('lastupdate.txt lists no GKG file');
      return slot;
    },

    async hasSlot(slot: string): Promise<boolean> {
      const response = await fetchFn(gkgUrl(base, slot), { method: 'HEAD' });
      if (response.status === 404) return false;
      if (!response.ok) throw new FeedError(`${slot}: HTTP ${response.status}`);
      return true;
    },

    async fetchSlot(slot: string): Promise<{ text: string; bytes: number } | null> {
      const response = await fetchFn(gkgUrl(base, slot));
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok) throw new FeedError(`${slot}: HTTP ${response.status}`);
      const zip = new Uint8Array(await response.arrayBuffer());
      return { text: await unzipText(zip), bytes: zip.byteLength };
    },
  };
}
