import { InlineAlert } from '@evia/ui-web';
import { useTranslation } from 'react-i18next';
import type { AccountFailure } from './account-failure.ts';

/**
 * The one alert of a card or a dialog of the own account for a failure (flows/12 → W-15 → "Stany" → Błąd); the data of the form stays.
 * `notFound` is the text for an object that is not there (a stranger's and a missing one look the same — "Nie znaleziono klucza.").
 */
export function AccountFailureAlert({ failure, notFound }: { readonly failure: AccountFailure; readonly notFound: string }) {
  const { t } = useTranslation();
  const text = (() => {
    switch (failure.kind) {
      case 'network':
        return t('account.failure.network');
      case 'cancelled':
        return t('account.failure.cancelled');
      case 'ended':
        return t('account.failure.ended');
      case 'forbidden':
        return t('account.failure.forbidden');
      case 'notFound':
        return notFound;
      case 'currentSession':
        return t('account.failure.currentSession');
      case 'configured':
        return t('account.failure.configured');
      case 'unavailable':
        return t('account.failure.unavailable');
      case 'reauthenticationExpired':
        return t('account.failure.reauthenticationExpired');
      case 'lastMethod':
        return failure.required === 'passkey' ? t('account.rules.administratorKey') : t('account.rules.lastMethod');
      case 'rate':
        return t('account.failure.rateLimited', { minutes: failure.minutes });
      case 'server':
        return t('account.failure.server', { code: failure.code });
    }
  })();
  return <InlineAlert tone="error">{text}</InlineAlert>;
}
