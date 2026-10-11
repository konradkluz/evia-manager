import type { TFunction } from 'i18next';
import { ENTRY_BODY_MAX } from './journal-draft.ts';
import type { JournalFailure } from './use-journal.ts';

/** A failure that belongs to the field of the text (shown under it); the others are an alert above the button. */
export const isBodyFailure = (failure: JournalFailure): boolean =>
  failure.kind === 'required' || failure.kind === 'tooLong' || failure.kind === 'invalidCharacters';

/** The words for a failure of saving an entry; nothing of the request is repeated in them (no values — SR-LOG-02). */
export function journalFailureText(t: TFunction, failure: JournalFailure): string {
  switch (failure.kind) {
    case 'required':
      return t('workOrder.journal.failure.required');
    case 'tooLong':
      return t('workOrder.journal.failure.tooLong', { max: ENTRY_BODY_MAX.toLocaleString('pl-PL') });
    case 'invalidCharacters':
      return t('workOrder.journal.failure.invalidCharacters');
    case 'stage':
      return t('workOrder.journal.failure.stage');
    case 'entryGone':
      return t('workOrder.journal.failure.entryGone');
    case 'superseded':
      return t('workOrder.journal.failure.superseded');
    case 'gone':
      return t('workOrder.journal.failure.gone');
    case 'forbidden':
      return t('workOrder.journal.failure.forbidden');
    case 'rate':
      return t('workOrder.journal.failure.rateLimited', { seconds: failure.seconds });
    case 'server':
      return t('workOrder.journal.failure.server', { code: failure.code });
    case 'fields':
    case 'network':
    case 'inProgress':
      return t('workOrder.journal.failure.network');
  }
}
