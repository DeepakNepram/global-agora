import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

// Directly, not through the barrels: only the /admin chunk carries the console.
import type {
  AdminCounters,
  DebateDraft,
  DraftProblem,
  HotStory,
  SuggestionReason,
} from '@/core/admin';

/** The admin console's state (Prompt 4.6); adminConsole.ts moves it. */

export type AccessStatus = 'loading' | 'signed-out' | 'not-admin' | 'ready' | 'unreachable';
export type DraftField = keyof DebateDraft;
/** Where the form's words came from, or why it has none. */
export type SuggestionNote = 'suggested' | SuggestionReason | 'failed';

export interface OpenForm {
  readonly storyId: string;
  readonly draft: DebateDraft;
  /** Fields the admin typed in: a suggestion never overwrites them. */
  readonly typed: readonly DraftField[];
  readonly suggesting: boolean;
  readonly note: SuggestionNote | null;
  readonly sending: boolean;
  /** Set by a confirm the draft could not pass, or the database refused. */
  readonly problem: DraftProblem | 'refused' | null;
}

/** What the last action did, as data; the page words it (adminView.ts). */
export type ConsoleMessage =
  | { readonly kind: 'opened'; readonly title: string; readonly closesAtMs: number }
  | { readonly kind: 'cap'; readonly maxOpen: number; readonly nextCloseAtMs: number | null }
  | { readonly kind: 'gone'; readonly title: string }
  | { readonly kind: 'failed' };

export interface ConsoleState {
  readonly access: AccessStatus;
  readonly handle: string | null;
  readonly counters: AdminCounters | null;
  readonly stories: readonly HotStory[];
  readonly storiesStatus: 'loading' | 'ready' | 'failed';
  readonly form: OpenForm | null;
  readonly message: ConsoleMessage | null;
}

export type ConsoleStore = StoreApi<ConsoleState>;

export function createConsoleStore(): ConsoleStore {
  return createStore<ConsoleState>()(() => ({
    access: 'loading',
    handle: null,
    counters: null,
    stories: [],
    storiesStatus: 'loading',
    form: null,
    message: null,
  }));
}

export const consoleStore: ConsoleStore = createConsoleStore();

export function useConsoleStore<T>(selector: (state: ConsoleState) => T): T {
  return useStore(consoleStore, selector);
}
