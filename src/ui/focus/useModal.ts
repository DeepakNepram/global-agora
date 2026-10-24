import { useAccountStore, useDiscussionStage, useOnboardingStore } from '@/state';

/**
 * Whether a modal sheet is up (sign-in, setup, the account, onboarding):
 * everything behind it is inert, so neither Tab nor a screen reader's
 * reading cursor wanders out of it (Prompt 5.1).
 */
export function useModalSheetOpen(): boolean {
  const account = useAccountStore((state) => state.sheet !== null);
  const onboarding = useOnboardingStore((state) => state.open);
  return account || onboarding;
}

/** A modal sheet, or a discussion (itself modal, with the account sheets above it). */
export function useAnyModalOpen(): boolean {
  const sheet = useModalSheetOpen();
  const discussion = useDiscussionStage((state) => state.phase !== 'closed');
  return sheet || discussion;
}
