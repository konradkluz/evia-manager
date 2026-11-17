import { pluralKey } from '../i18n/plural';
import type { GroupSummary } from '../sync/types';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The text of the dialog "Usunąć wizję z telefonu?" (EVM-137; flow 17): what goes with the survey, by kind and with the Polish forms -
 * "Razem z nią usuniemy z telefonu 4 elementy: 2 zdjęcia, 1 film i 1 wpis." Counts only, never a content or an address (W5).
 */
export function surveyDiscardBody(t: Translate, summary: GroupSummary): string {
  if (summary.total === 0) return t('attention.surveyDiscard.alone');
  const parts = [
    summary.photos > 0
      ? t(
          pluralKey(summary.photos, {
            one: 'attention.surveyDiscard.photos_one',
            few: 'attention.surveyDiscard.photos_few',
            many: 'attention.surveyDiscard.photos_many',
          }),
          { count: summary.photos },
        )
      : '',
    summary.videos > 0
      ? t(
          pluralKey(summary.videos, {
            one: 'attention.surveyDiscard.videos_one',
            few: 'attention.surveyDiscard.videos_few',
            many: 'attention.surveyDiscard.videos_many',
          }),
          { count: summary.videos },
        )
      : '',
    summary.entries > 0
      ? t(
          pluralKey(summary.entries, {
            one: 'attention.surveyDiscard.entries_one',
            few: 'attention.surveyDiscard.entries_few',
            many: 'attention.surveyDiscard.entries_many',
          }),
          { count: summary.entries },
        )
      : '',
  ].filter((part) => part !== '');
  const last = parts.pop() ?? '';
  const list = parts.length === 0 ? last : `${parts.join(', ')}${t('attention.surveyDiscard.and')}${last}`;
  const total = t(
    pluralKey(summary.total, {
      one: 'attention.surveyDiscard.items_one',
      few: 'attention.surveyDiscard.items_few',
      many: 'attention.surveyDiscard.items_many',
    }),
    { count: summary.total },
  );
  return t('attention.surveyDiscard.withItems', { total, parts: list });
}
