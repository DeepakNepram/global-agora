import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { LegalDocId } from '@/core/legal/types';

/**
 * Which of the app's documents (about, rules, privacy, terms, contact) is
 * open in the sheet over everything (Prompt 5.2), and which section to show
 * first. Closed, nothing is.
 */
export interface DocumentState {
  readonly open: LegalDocId | null;
  /** A section id to scroll to (the privacy policy's "local-badge"), or null for the top. */
  readonly section: string | null;
  openDocument(id: LegalDocId, section?: string): void;
  closeDocument(): void;
}

export type DocumentStore = StoreApi<DocumentState>;

export function createDocumentStore(): DocumentStore {
  return createStore<DocumentState>()((set) => ({
    open: null,
    section: null,
    openDocument(id, section) {
      set({ open: id, section: section ?? null });
    },
    closeDocument() {
      set({ open: null, section: null });
    },
  }));
}

export const documentStore: DocumentStore = createDocumentStore();

export function useDocumentStore<T>(selector: (state: DocumentState) => T): T {
  return useStore(documentStore, selector);
}
