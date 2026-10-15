/**
 * The community rules every account agrees to on its first sign-in (Prompt
 * 4.1: an explicit, active "I agree", recorded as profiles.rules_accepted_at).
 *
 * A DRAFT written from the reasons a post can be reported (Prompt 4.3) and
 * the 17+ age line. The owner edits the wording; Prompt 5.2's community rules
 * page shows this same text.
 *
 * When the rules change in substance, move RULES_UPDATED_AT forward: every
 * account that agreed before it is asked again on its next visit.
 */

export interface CommunityRule {
  readonly title: string;
  readonly detail: string;
}

export const COMMUNITY_RULES: readonly CommunityRule[] = [
  {
    title: 'Argue with the idea, not the person.',
    detail: 'No harassment, insults or pile-ons.',
  },
  {
    title: 'No hate.',
    detail:
      'Nothing that attacks people for who they are: race, ethnicity, nationality, religion, ' +
      'gender, sexuality or disability.',
  },
  {
    title: 'No threats.',
    detail: 'Never threaten anyone or encourage violence.',
  },
  {
    title: 'Be honest about what you know.',
    detail:
      'Expertise is self-declared and always shown as unverified. Do not claim to be someone ' +
      'you are not, or to have seen what you did not.',
  },
  {
    title: 'Stay on the story.',
    detail: "Keep to the discussion's question. No spam, ads or repeated posts.",
  },
  {
    title: 'One person, one account, 17 or older.',
    detail: 'Global Agora discussions are for adults.',
  },
  {
    title: 'Breaking the rules has consequences.',
    detail:
      'Posts are checked automatically and by people, and anyone can report one. A post that ' +
      'breaks these rules is removed and its author gets a strike; three strikes suspend the ' +
      'account.',
  },
];

/** When the rules last changed in substance (UTC). */
export const RULES_UPDATED_AT_MS: number = Date.UTC(2026, 9, 15);

/** True when an account must (again) agree: never agreed, or agreed before the last change. */
export function needsRulesAgreement(
  acceptedAtMs: number | null,
  updatedAtMs: number = RULES_UPDATED_AT_MS,
): boolean {
  return acceptedAtMs === null || acceptedAtMs < updatedAtMs;
}
