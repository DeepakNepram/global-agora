import type { LibraryRemote, OAuthProvider } from '@/core';

import type { AccountSession } from './accountSession';
import type { AccountStore } from './accountStore';

/** The account controller's surface and what it is built from (accountController.ts). */

/** The browser around the controller; tests pass a fake. */
export interface AccountEnvironment {
  search(): string;
  hash(): string;
  /** Rewrites the address bar in place (no history entry). */
  replaceAddress(search: string, hash: string): void;
  storageKeys(): readonly string[];
  hasStoredSession(): boolean;
  /** Where a sign-in link, Google or Apple should send the reader back to. */
  redirectTo(): string;
}

export interface LibraryLink {
  /** Moves the device's library up; false (and the reader told) when it could not. */
  enter(remote: LibraryRemote): Promise<boolean>;
  leave(): void;
}

export interface AccountControllerOptions {
  readonly store: AccountStore;
  readonly load: () => Promise<AccountSession>;
  readonly environment: AccountEnvironment;
  readonly library?: LibraryLink;
  readonly now?: () => number;
}

export interface AccountController {
  /** At start: resume a stored session, or finish a sign-in return. A guest loads nothing. */
  start(): Promise<void>;
  sendEmailLink(email: string): Promise<boolean>;
  verifyEmailCode(code: string): Promise<boolean>;
  startOAuth(provider: OAuthProvider): Promise<void>;
  answerAge(adult: boolean): Promise<void>;
  handlesAvailable(handles: readonly string[]): Promise<string[]>;
  chooseHandle(handle: string): Promise<boolean>;
  /** Back from the rules to the handle, which can change until "I agree". */
  backToHandle(): void;
  agreeToRules(): Promise<boolean>;
  /** Leaves setup unfinished: signs out. The next sign-in resumes it. */
  notNow(): Promise<void>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<boolean>;
  /** Appeals a suspension (Prompt 5.2); true once sent, and the profile shows it waiting. */
  sendAppeal(body: string): Promise<boolean>;
  /** Reads the account again after it could not be reached. */
  retry(): Promise<void>;
  dispose(): void;
}
