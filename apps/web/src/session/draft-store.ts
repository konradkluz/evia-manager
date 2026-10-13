/**
 * Drafts of forms (AC6, SR-WEB-05, TM-10; styleguide § 4.1): in the memory of the tab only — never in localStorage,
 * sessionStorage, IndexedDB or the URL. A draft belongs to the person (`userId`) who typed it: it survives an expired
 * session and comes back only after the same person logs in again in the same tab; another person's login drops it, and
 * so does "Wyloguj". A refresh of the tab loses it by design.
 */
import { clearWorkOrderSearch } from '../search/work-order-search-store.ts';

let owner: string | null = null;
const drafts = new Map<string, string>();

/**
 * The pair `id` + `Idempotency-Key` of a save that was sent for a form, with the content it was sent for. It lives with the
 * draft (same lifetime, same owner): a retry of the same content after the form was left and reopened sends the same pair,
 * so a lost answer never makes a second object (EVM-037 AC5). Neither `id` nor key is personal data.
 */
export interface SavedAttempt {
  readonly content: string;
  readonly id: string;
  readonly key: string;
}
const attempts = new Map<string, SavedAttempt>();

/** Keeps a draft of a form of `userId`; a draft of another owner is dropped first (a tab holds one person's drafts). */
export function saveDraft(userId: string, form: string, value: string): void {
  if (owner !== userId) clearDrafts();
  owner = userId;
  drafts.set(form, value);
}

/** The attempt kept for a form (`undefined`: none yet). */
export function readAttempt(form: string): SavedAttempt | undefined {
  return attempts.get(form);
}

export function saveAttempt(form: string, attempt: SavedAttempt): void {
  attempts.set(form, attempt);
}

/** Forgets the attempt of a form; with `id` only that very attempt (a newer one stays). */
export function discardAttempt(form: string, id?: string): void {
  if (id === undefined || attempts.get(form)?.id === id) attempts.delete(form);
}

/** The draft of a form — only for the person who typed it. */
export function readDraft(userId: string, form: string): string | undefined {
  return owner === userId ? drafts.get(form) : undefined;
}

export function discardDraft(form: string): void {
  drafts.delete(form);
}

/** "Wyloguj" and a logout of any kind: every draft goes. */
export function clearDrafts(): void {
  owner = null;
  drafts.clear();
  attempts.clear();
  // The phrase and the filters of the list of work orders are memory of the tab as well (EVM-072; SR-WEB-05).
  clearWorkOrderSearch();
}

/** After a login: drafts stay only when the same person logged in again; any other person gets none. */
export function reconcileDrafts(userId: string): void {
  if (owner !== userId) clearDrafts();
}
