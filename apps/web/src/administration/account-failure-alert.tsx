import { Button, InlineAlert } from '@evia/ui-web';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AccountFailure } from './account-failure.ts';

/**
 * The one alert of a dialog of an operation on an account for a failure (flows/12 → "Stany" → Błąd); the data of the dialog stays.
 * `412` offers "Odśwież dane konta" (the dialog stays, the account is read again and the choice is kept); a missing account, a
 * state that moved on and the protection of the last Administrator offer "Odśwież listę" (the dialog closes).
 */
export function AccountFailureAlert({
  failure,
  onRefreshAccount,
  onRefreshList,
}: {
  readonly failure: AccountFailure;
  readonly onRefreshAccount: () => void;
  readonly onRefreshList: () => void;
}) {
  const { t } = useTranslation();
  let action: ReactNode;
  let text: string;
  const list = (
    <Button variant="secondary" onClick={onRefreshList}>
      {t('users.failure.refresh')}
    </Button>
  );
  switch (failure.kind) {
    case 'network':
      text = t('users.account.failure.network');
      break;
    case 'server':
      text = t('users.account.failure.server', { code: failure.code });
      break;
    case 'forbidden':
      text = t('users.account.failure.forbidden');
      break;
    case 'notConfirmed':
      text = t('users.account.failure.notConfirmed');
      break;
    case 'fields':
      text = t('users.account.failure.fields');
      break;
    case 'rate':
      text = t('users.account.failure.rateLimited', { minutes: failure.minutes });
      break;
    case 'ownAccount':
      text = t('users.account.failure.ownAccount');
      break;
    case 'passkeyRequired':
      text = t('users.account.role.passkeyRequired');
      break;
    case 'ended':
      text = t('users.account.failure.ended');
      break;
    case 'gone':
      text = t('users.account.failure.gone');
      action = list;
      break;
    case 'stateChanged':
      text = t('users.account.failure.stateChanged');
      action = list;
      break;
    case 'lastAdministrator':
      text = t('users.account.failure.lastAdministrator');
      action = list;
      break;
    case 'versionConflict':
      text = t('users.account.failure.versionConflict');
      action = (
        <Button variant="secondary" onClick={onRefreshAccount}>
          {t('users.account.failure.refreshAccount')}
        </Button>
      );
      break;
  }
  return (
    <InlineAlert tone="error" action={action}>
      {text}
    </InlineAlert>
  );
}
