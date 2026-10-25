/**
 * The app's documents (Prompt 5.2): about, the community rules, privacy,
 * terms and contact. Plain data, shown as pages (/privacy) and in a sheet
 * inside the app, from the same text.
 *
 * DRAFTS, written against the code they describe. The owner edits the
 * wording, and someone qualified should review them before invitations go
 * out. Tests check the facts that the code enforces (privacyPolicy.test.ts,
 * legal.test.ts).
 */

export type LegalDocId = 'about' | 'rules' | 'privacy' | 'terms' | 'contact';

export interface LegalSection {
  /** Unique within its document: the fragment that links to it (/privacy#local-badge). */
  readonly id: string;
  readonly title: string;
  readonly paragraphs: readonly string[];
  /** A list after the paragraphs. */
  readonly items?: readonly string[];
}

export interface LegalDocument {
  readonly id: LegalDocId;
  readonly title: string;
  /** One or two sentences under the title. */
  readonly summary: string;
  readonly sections: readonly LegalSection[];
}

/** Who runs the service, from the build (legalSiteFromEnv); null while unset (development). */
export interface LegalSite {
  readonly operator: string | null;
  /** Its country, whose law governs the terms. */
  readonly country: string | null;
  /** The contact address: a real inbox (VITE_CONTACT_EMAIL). */
  readonly contactEmail: string | null;
  /** Where Supabase keeps the database, e.g. "the EU (Frankfurt)". */
  readonly dataRegion: string | null;
}
