import { byRank, type DiscussionInfo, type DiscussionPost, type RoomBalance } from './discussion';
import type { PostKind, PostStance } from './posting';

/**
 * A made-up discussion for tests and the dev benchmark (Prompt 4.5): the
 * same posts every time, with no network. Nothing here is a real person.
 */

export const FIXTURE_STORY_ID = '00000000-0000-4000-8000-0000000004f5';

export const FIXTURE_DISCUSSION: DiscussionInfo = {
  storyId: FIXTURE_STORY_ID,
  prompt: 'Should the city move its main market to the new river district?',
  sideA: 'Move it',
  sideB: 'Keep it where it is',
  state: 'open',
  closesAtMs: Date.UTC(2026, 9, 22, 12),
  postCount: 60,
};

const STANCES: readonly PostStance[] = ['a', 'b', 'a', 'neutral', 'b'];
const KINDS: readonly PostKind[] = ['argument', 'argument', 'eyewitness', 'evidence', 'expert'];
const LINES = [
  'Traders lose a week of takings in any move, and most of them work on thin margins.',
  'The river site has parking and shade; the old square floods every monsoon.',
  'I sell vegetables there every morning. The lane is too narrow for the delivery vans.',
  'The council survey found two thirds of stallholders would stay if rents held for a year.',
  'Markets that moved in nearby towns lost their evening crowd for about two years.',
  'Footfall depends on the bus routes more than the site; ask the transport office first.',
];

/** Post `i` of the fixture: votes thin out as i rises. */
export function fixturePost(
  i: number,
  createdAtMs = Date.UTC(2026, 9, 20, 9) - i * 60_000,
): DiscussionPost {
  const kind = KINDS[i % KINDS.length] ?? 'argument';
  const helpful = Math.max(0, 40 - i);
  const crossSide = Math.max(0, 12 - Math.floor(i / 2));
  const changedMind = Math.max(0, 6 - Math.floor(i / 4));
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    authorId: `00000000-0000-4000-9000-${String(i % 17).padStart(12, '0')}`,
    authorHandle: `reader${i % 17}`,
    body: `${LINES[i % LINES.length] ?? ''} (${i + 1})`,
    stance: STANCES[i % STANCES.length] ?? 'neutral',
    kind,
    evidenceUrl: kind === 'evidence' ? `https://example.org/report/${i}` : null,
    regionLabel: i % 7 === 0 ? 'Bengaluru area, India' : null,
    modState: 'ok',
    helpfulCount: helpful,
    crossSideCount: crossSide,
    changedMindCount: changedMind,
    rankScore:
      Math.log1p(helpful) * (0.5 + crossSide / Math.max(helpful, 1)) +
      1.5 * Math.log1p(changedMind),
    createdAtMs,
  };
}

/** The first `count` posts, best first, as the remote returns them. */
export function fixturePosts(count = FIXTURE_DISCUSSION.postCount): DiscussionPost[] {
  return Array.from({ length: count }, (_, i) => fixturePost(i)).sort(byRank);
}

export function fixtureBalance(posts: readonly DiscussionPost[]): RoomBalance {
  return {
    a: posts.filter((post) => post.stance === 'a').length,
    b: posts.filter((post) => post.stance === 'b').length,
    neutral: posts.filter((post) => post.stance === 'neutral').length,
  };
}
