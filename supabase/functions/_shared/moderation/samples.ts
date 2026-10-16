/**
 * Known-toxic and benign posts, with what moderation must do to each
 * (Prompt 4.3: "tests using known-toxic sample strings to prove the pipeline
 * blocks them"). db:smoke posts every one through the real pipeline, and
 * fixtures.json holds each model's reply to each.
 *
 * Written to be unmistakable without slurs. The benign ones include hard
 * news (a bombing, a resignation call) so a model that over-flags shows up
 * here before it shows up in a real debate.
 */

/**
 * - `removed+strike`: removed, and the author gets a strike;
 * - `removed`: removed without a strike (self-harm, the owner's call);
 * - `not-ok`: hidden or removed, never published (borderline: tuning
 *   decides which);
 * - `ok`: published.
 */
export type SampleExpectation = 'removed+strike' | 'removed' | 'not-ok' | 'ok';

export interface ModerationSample {
  readonly id: string;
  readonly text: string;
  readonly expect: SampleExpectation;
}

export const MODERATION_SAMPLES: readonly ModerationSample[] = [
  {
    id: 'threat',
    text: 'I know where you live, and I am going to kill you and your family.',
    expect: 'removed+strike',
  },
  {
    id: 'harassment',
    text:
      'You are a pathetic, worthless idiot. Everyone here would be better off if you ' +
      'shut your mouth forever.',
    expect: 'removed+strike',
  },
  {
    id: 'hate',
    text: 'People from that country are vermin, not human, and they should all be wiped out.',
    expect: 'removed+strike',
  },
  {
    id: 'self-harm',
    text: "I can't take any more of this. I'm going to end my life tonight.",
    expect: 'removed',
  },
  {
    id: 'borderline-insult',
    text: 'That is the dumbest take I have read all week. Did you even read the article, genius?',
    expect: 'not-ok',
  },
  {
    id: 'argument',
    text:
      'Tariffs on steel will raise costs for car makers here. The 2018 tariffs did exactly ' +
      'that within a year.',
    expect: 'ok',
  },
  {
    id: 'eyewitness',
    text:
      'I live two streets from the station. Trains have been cancelled since 6am and the ' +
      'platforms are packed.',
    expect: 'ok',
  },
  {
    id: 'hard-news',
    text:
      'The bombing killed at least 40 people at the market. The government has to explain ' +
      'why the warnings were ignored.',
    expect: 'ok',
  },
  {
    id: 'strong-disagreement',
    text: 'I strongly disagree. This policy is a mistake and the minister should resign over it.',
    expect: 'ok',
  },
];
