import {
  leadOutlet,
  rowOfStory,
  vec3ToLatLon,
  type DiscussionState,
  type LatLon,
  type NodeBuffer,
  type StoryDetail,
} from '@/core';

/**
 * What the peek card shows, from whatever is at hand: the payload row arrives
 * with the globe, so the card fills at once; the full story (outlet,
 * discussion state, participants) follows about 100 ms later. A shared link
 * can open a story outside the payload, which then waits for the details.
 */
export interface StorySummary {
  readonly id: number;
  readonly headline: string;
  readonly place: string;
  readonly sourceCount: number;
  readonly publishedAtMs: number;
  /** Null until the full story says which outlet broke it. */
  readonly outlet: string | null;
  readonly discussion: DiscussionState;
  readonly participants: number | null;
  readonly at: LatLon;
  /** The story's payload row, or −1 when the payload does not hold it. */
  readonly row: number;
}

export function summarize(
  nodes: NodeBuffer | null,
  id: number,
  detail: StoryDetail | null,
): StorySummary | null {
  const full = detail?.id === id ? detail : null;
  const row = nodes ? rowOfStory(nodes, id) : -1;
  if (nodes && row >= 0) {
    const p = nodes.positions;
    return {
      id,
      headline: nodes.headlines[row] ?? '',
      place: nodes.places[row] ?? '',
      sourceCount: nodes.sourceCounts[row] ?? 0,
      publishedAtMs: (nodes.epochSec + (nodes.publishedSec[row] ?? 0)) * 1000,
      outlet: full ? leadOutlet(full) : null,
      // The payload knows only open or not; the full story says which.
      discussion: full?.discussion.state ?? (nodes.discussionOpen[row] ? 'open' : 'none'),
      participants: full?.discussion.participants ?? null,
      at: vec3ToLatLon({ x: p[row * 3] ?? 0, y: p[row * 3 + 1] ?? 0, z: p[row * 3 + 2] ?? 0 }),
      row,
    };
  }
  if (!full) return null;
  return {
    id,
    headline: full.title,
    place: full.place.name,
    sourceCount: full.sourceCount,
    publishedAtMs: full.publishedAtMs,
    outlet: leadOutlet(full),
    discussion: full.discussion.state,
    participants: full.discussion.participants,
    at: { lat: full.place.lat, lon: full.place.lon },
    row: -1,
  };
}
