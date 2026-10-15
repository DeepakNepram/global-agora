/**
 * The account button (AccountButton.tsx, marked data-account-button), for a
 * sheet that opened by itself (a resumed setup, a sign-in return) to hand
 * focus to when it closes, since no button opened it.
 */
export function accountButtonElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-account-button]');
}
