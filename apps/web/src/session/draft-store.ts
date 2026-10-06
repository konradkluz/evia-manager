/**
 * Drafts of forms (AC6, SR-WEB-05, TM-10; styleguide § 4.1): in the memory of the tab only — never in localStorage,
 * sessionStorage, IndexedDB or the URL. A draft belongs to the person (`userId`) who typed it: it survives an expired
 * session and comes back only after the same person logs in again in the same tab; another person's login drops it, and
 * so does "Wyloguj". A refresh of the tab loses it by design.
 */
let owner: string | null = null;
const drafts = new Map<string, string>();

/** Keeps a draft of a form of `userId`; a draft of another owner is dropped first (a tab holds one person's drafts). */
export function saveDraft(userId: string, form: string, value: string): void {
  if (owner !== userId) drafts.clear();
  owner = userId;
  drafts.set(form, value);
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
}

/** After a login: drafts stay only when the same person logged in again; any other person gets none. */
export function reconcileDrafts(userId: string): void {
  if (owner !== userId) clearDrafts();
}
