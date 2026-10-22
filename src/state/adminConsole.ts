// Directly, not through the barrels: only the /admin chunk carries the console.
import {
  ADMIN_PAGE,
  AdminError,
  cleanDraft,
  draftProblem,
  localMidnight,
  type DebateDraft,
} from '@/core/admin';

import type { ConsoleStore, DraftField, OpenForm, SuggestionNote } from './adminConsoleStore';
import type { AdminSession } from './adminSession';
import { wallClockNow } from './clock';

/**
 * The admin console's hot stories, counters and opening form (Prompt 4.6).
 * It decides who may see the console, for every tab: the database decides
 * who is an admin, and this asks it once on arrival.
 */

export interface ConsoleController {
  /** Who is here, then the counters and the queue. */
  start(): Promise<void>;
  refresh(): Promise<void>;
  refreshCounters(): Promise<void>;
  /** Shows the form for a story at once, and asks for a suggestion. */
  beginOpen(storyId: string): void;
  edit(field: DraftField, value: string): void;
  suggestAgain(): void;
  cancel(): void;
  /** Opens the discussion; true when it opened. */
  confirm(): Promise<boolean>;
}

const EMPTY_DRAFT: DebateDraft = { prompt: '', sideA: '', sideB: '' };

export function createConsoleController(options: {
  readonly store: ConsoleStore;
  readonly connect: () => Promise<AdminSession>;
  readonly now?: () => number;
}): ConsoleController {
  const { store, connect } = options;
  const now = options.now ?? wallClockNow;
  /** Only the latest suggestion request may fill the form. */
  let asked = 0;

  const remote = async () => (await connect()).console;
  const updateForm = (change: Partial<OpenForm>): void => {
    const form = store.getState().form;
    if (form !== null) store.setState({ form: { ...form, ...change } });
  };
  const titleOf = (storyId: string): string =>
    store.getState().stories.find((story) => story.storyId === storyId)?.title ?? 'That story';
  const dropStory = (storyId: string): void =>
    store.setState({ stories: store.getState().stories.filter((s) => s.storyId !== storyId) });
  /** A refusal that means this account is no admin (any more). */
  const lostAccess = (error: unknown): boolean => {
    const code = error instanceof AdminError ? error.code : null;
    if (code === 'not-admin') store.setState({ access: 'not-admin', form: null });
    else if (code === 'signed-out') store.setState({ access: 'signed-out', form: null });
    else return false;
    return true;
  };

  async function refreshCounters(): Promise<void> {
    try {
      const counters = await (await remote()).counters(localMidnight(now()));
      store.setState({ counters });
    } catch (error) {
      lostAccess(error);
    }
  }

  async function refreshStories(): Promise<void> {
    try {
      const stories = await (await remote()).storyQueue(ADMIN_PAGE);
      store.setState({ stories, storiesStatus: 'ready' });
    } catch (error) {
      if (!lostAccess(error)) store.setState({ storiesStatus: 'failed' });
    }
  }

  async function refresh(): Promise<void> {
    await Promise.all([refreshCounters(), refreshStories()]);
  }

  function requestSuggestion(storyId: string): void {
    const request = ++asked;
    updateForm({ suggesting: true, note: null });
    void (async () => {
      let note: SuggestionNote;
      let words: DebateDraft | null = null;
      try {
        const result = await (await remote()).suggest(storyId);
        note = result.kind === 'ok' ? 'suggested' : result.reason;
        if (result.kind === 'ok') words = result.draft;
      } catch (error) {
        if (request !== asked || lostAccess(error)) return;
        if (error instanceof AdminError && error.code === 'missing') {
          store.setState({ form: null, message: { kind: 'gone', title: titleOf(storyId) } });
          dropStory(storyId);
          return;
        }
        note = 'failed';
      }
      const form = store.getState().form;
      if (request !== asked || form === null || form.storyId !== storyId) return;
      const draft = { ...form.draft };
      if (words !== null) {
        for (const field of ['prompt', 'sideA', 'sideB'] as const) {
          if (!form.typed.includes(field)) draft[field] = words[field];
        }
      }
      updateForm({ draft, suggesting: false, note });
    })();
  }

  return {
    async start() {
      store.setState({ access: 'loading' });
      try {
        const session = await connect();
        if (!(await session.signedIn())) {
          store.setState({ access: 'signed-out' });
          return;
        }
        const profile = await session.account.myProfile();
        store.setState({ handle: profile?.handle ?? null });
        if (profile?.isAdmin !== true) {
          store.setState({ access: 'not-admin' });
          return;
        }
      } catch {
        store.setState({ access: 'unreachable' });
        return;
      }
      store.setState({ access: 'ready' });
      await refresh();
    },

    refresh,
    refreshCounters,

    beginOpen(storyId) {
      if (store.getState().form?.sending === true) return;
      store.setState({
        form: {
          storyId,
          draft: EMPTY_DRAFT,
          typed: [],
          suggesting: true,
          note: null,
          sending: false,
          problem: null,
        },
        message: null,
      });
      requestSuggestion(storyId);
    },

    edit(field, value) {
      const form = store.getState().form;
      if (form === null || form.sending) return;
      updateForm({
        draft: { ...form.draft, [field]: value },
        typed: form.typed.includes(field) ? form.typed : [...form.typed, field],
        problem: null,
      });
    },

    suggestAgain() {
      const form = store.getState().form;
      if (form === null || form.sending) return;
      // Asking again replaces every field: that is what the button says.
      updateForm({ typed: [] });
      requestSuggestion(form.storyId);
    },

    cancel() {
      asked += 1;
      if (store.getState().form?.sending !== true) store.setState({ form: null });
    },

    async confirm() {
      const form = store.getState().form;
      if (form === null || form.sending) return false;
      const problem = draftProblem(form.draft);
      if (problem !== null) {
        updateForm({ problem });
        return false;
      }
      asked += 1;
      updateForm({ sending: true, suggesting: false, problem: null });
      const title = titleOf(form.storyId);
      try {
        const opened = await (await remote()).openDiscussion(form.storyId, cleanDraft(form.draft));
        dropStory(form.storyId);
        const counters = store.getState().counters;
        store.setState({
          form: null,
          message: { kind: 'opened', title, closesAtMs: opened.closesAtMs },
          counters: counters && {
            ...counters,
            openDiscussions: opened.openCount,
            maxOpen: opened.maxOpen,
          },
        });
        void refreshCounters();
        return true;
      } catch (error) {
        if (lostAccess(error)) return false;
        const code = error instanceof AdminError ? error.code : 'unknown';
        if (code === 'cap' && error instanceof AdminError) {
          updateForm({ sending: false });
          // The counters held here may be from before the cap was reached
          // (or changed): the refusal is worded from fresh ones.
          await refreshCounters();
          const maxOpen = store.getState().counters?.maxOpen ?? 0;
          store.setState({
            message: { kind: 'cap', maxOpen, nextCloseAtMs: error.nextCloseAtMs },
          });
        } else if (code === 'not-queued' || code === 'missing') {
          dropStory(form.storyId);
          store.setState({ form: null, message: { kind: 'gone', title } });
        } else if (code === 'invalid') {
          updateForm({ sending: false, problem: 'refused' });
        } else {
          updateForm({ sending: false });
          store.setState({ message: { kind: 'failed' } });
        }
        return false;
      }
    },
  };
}
