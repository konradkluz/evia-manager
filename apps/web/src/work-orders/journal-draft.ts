import type { NoteCategory } from '@evia/contracts';
import { NOTE_CATEGORIES } from '../i18n/journal-labels.ts';
import { discardDraft, readDraft, saveDraft } from '../session/draft-store.ts';

/** The most the server accepts (code points, after normalization — SR-INPUT-05). */
export const ENTRY_BODY_MAX = 10_000;

/** What the person has typed in the field of a new entry (W-08). Kept in the memory of the tab only (SR-WEB-05, TM-10). */
export interface JournalDraft {
  readonly kind: 'note' | 'comment';
  readonly category: NoteCategory;
  /** Id of the stage, '' for none. */
  readonly stageId: string;
  readonly body: string;
  /** When the draft was last changed (ms) — "Szkic w tej karcie · 14:05". */
  readonly savedAt: number;
}

export const EMPTY_DRAFT: JournalDraft = { kind: 'note', category: 'arrangement', stageId: '', body: '', savedAt: 0 };

const formOf = (workOrderId: string): string => `journal:${workOrderId}`;

function isCategory(value: unknown): value is NoteCategory {
  return typeof value === 'string' && (NOTE_CATEGORIES as readonly string[]).includes(value);
}

/** The draft of an order for this person, or the empty form; a malformed record is ignored, never trusted. */
export function loadDraft(userId: string | undefined, workOrderId: string): JournalDraft {
  if (userId === undefined) return EMPTY_DRAFT;
  const raw = readDraft(userId, formOf(workOrderId));
  if (raw === undefined) return EMPTY_DRAFT;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return {
      kind: value['kind'] === 'comment' ? 'comment' : 'note',
      category: isCategory(value['category']) ? value['category'] : EMPTY_DRAFT.category,
      stageId: typeof value['stageId'] === 'string' ? value['stageId'] : '',
      body: typeof value['body'] === 'string' ? value['body'] : '',
      savedAt: typeof value['savedAt'] === 'number' ? value['savedAt'] : 0,
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

/** Keeps the draft; a form with nothing typed is no draft (the choices alone are not worth keeping). */
export function storeDraft(userId: string | undefined, workOrderId: string, draft: JournalDraft): void {
  if (userId === undefined) return;
  if (draft.body === '') discardDraft(formOf(workOrderId));
  else saveDraft(userId, formOf(workOrderId), JSON.stringify(draft));
}

export function dropDraft(workOrderId: string): void {
  discardDraft(formOf(workOrderId));
}

/** The length of a text in code points, as the server counts it (an emoji is one character, not two). */
export function codePointLength(text: string): number {
  let length = 0;
  for (let index = 0; index < text.length; index += 1) {
    // A code point above U+FFFF takes two UTF-16 units: skip the second one.
    if ((text.codePointAt(index) ?? 0) > 0xffff) index += 1;
    length += 1;
  }
  return length;
}
