/**
 * Polish labels of the categories of a journal entry (docs/ux/flows/05-wpis-i-komentarz.md, "Mikrocopy"; EVM-037 AC1).
 * The API sends a stable code; a `Record` over the contract type makes a new category a compile error here until it has a
 * label. A value an older panel does not know gets no label (P-12) — the raw code is never shown.
 */
import type { NoteCategory } from '@evia/contracts';

export const noteCategoryLabels: Readonly<Record<NoteCategory, string>> = {
  phone_call: 'Rozmowa telefoniczna',
  meeting: 'Spotkanie',
  arrangement: 'Ustalenie',
  site_visit: 'Wizyta na miejscu',
  other: 'Inne',
};

/** The order in which the chips of the categories are offered. */
export const NOTE_CATEGORIES: readonly NoteCategory[] = ['phone_call', 'arrangement', 'meeting', 'site_visit', 'other'];

/** The label of a category from the API, `undefined` for a value this panel does not know. */
export const noteCategoryLabel = (category: string): string | undefined =>
  Object.hasOwn(noteCategoryLabels, category) ? noteCategoryLabels[category as NoteCategory] : undefined;
