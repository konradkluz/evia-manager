import type { User } from '@evia/contracts';
import { Button, InlineAlert } from '@evia/ui-web';
import type { ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { statusLabel } from './labels.ts';
import type { UserFailure } from './user-failure.ts';

/**
 * The one alert of a dialog of W-16 for a failure (flows/12 → "Stany" → Błąd); the data of the dialog stays. `409 email_conflict`
 * names the account when it is on the loaded page of the list ("Konto z tym adresem już istnieje: Jan Przykładowy · Dezaktywowane")
 * and offers "Pokaż konto"; an account of another page or a deleted one gets the same sentence without a name (nothing is
 * guessed). A refused state or a missing account offers "Odśwież listę".
 */
export function UserFailureAlert({
  failure,
  find,
  onShowAccount,
  onRefresh,
  alertRef,
}: {
  readonly failure: UserFailure;
  readonly find: (id: string) => User | undefined;
  readonly onShowAccount: (id: string) => void;
  readonly onRefresh: () => void;
  readonly alertRef?: Ref<HTMLDivElement>;
}) {
  const { t } = useTranslation();
  const refresh = (
    <Button variant="secondary" onClick={onRefresh}>
      {t('users.failure.refresh')}
    </Button>
  );
  let text: string;
  let action: ReactNode;
  switch (failure.kind) {
    case 'fields':
      text = t('users.failure.fields');
      break;
    case 'network':
      text = t('users.failure.network');
      break;
    case 'inProgress':
      text = t('users.failure.inProgress');
      break;
    case 'forbidden':
      text = t('users.failure.forbidden');
      break;
    case 'notConfirmed':
      text = t('users.failure.notConfirmed');
      break;
    case 'rate':
      text = t('users.failure.rateLimited', { minutes: failure.minutes });
      break;
    case 'server':
      text = t('users.failure.server', { code: failure.code });
      break;
    case 'gone':
      text = t('users.failure.gone');
      action = refresh;
      break;
    case 'notInvited':
      text = t('users.failure.notInvited');
      action = refresh;
      break;
    case 'conflict': {
      const known = failure.existingUserId === undefined ? undefined : find(failure.existingUserId);
      if (known === undefined) {
        text = t('users.failure.conflict');
      } else {
        text = t('users.failure.conflictNamed', { name: known.displayName, status: statusLabel(t, known.status) });
        action = (
          <Button
            variant="secondary"
            onClick={() => {
              onShowAccount(known.id);
            }}
          >
            {t('users.failure.showAccount')}
          </Button>
        );
      }
      break;
    }
  }
  return (
    <InlineAlert tone="error" alertRef={alertRef} action={action}>
      {text}
    </InlineAlert>
  );
}
