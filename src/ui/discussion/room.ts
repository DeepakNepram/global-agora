import { getAccountSession, monotonicNowMs } from '@/state';
import { discussionRoomStore } from '@/state/discussionRoom';
import {
  createDiscussionRoom,
  type DiscussionRoom,
  type RoomRemotes,
} from '@/state/discussionRoomController';

let room: DiscussionRoom | null = null;
let stand: (() => Promise<RoomRemotes>) | null = null;

/**
 * Dev tooling only (the discussion benchmark): the room reads a stand-in
 * instead of the backend, so it runs anywhere, a phone with no stack
 * included. Null puts the backend back.
 */
export function standInDiscussion(remotes: (() => Promise<RoomRemotes>) | null): void {
  stand = remotes;
}

/**
 * The panel's room, on the app's one SDK session (guests read through it
 * too), posting through the API Worker at `apiBaseUrl`. Made once, in the
 * panel's chunk.
 */
export function getDiscussionRoom(apiBaseUrl: string): DiscussionRoom {
  room ??= createDiscussionRoom({
    store: discussionRoomStore,
    async remotes(): Promise<RoomRemotes> {
      if (stand) return stand();
      const session = await getAccountSession();
      if (!session) throw new Error('This build has no discussion service.');
      return {
        discussion: session.discussion,
        posting: session.posting({ apiBaseUrl, fetch: (url, init) => fetch(url, init) }),
        moderation: session.moderation,
      };
    },
    now: monotonicNowMs,
    setTimer: (callback, ms) => window.setTimeout(callback, ms),
    clearTimer: (handle) => window.clearTimeout(handle),
  });
  return room;
}
