import { Button, EmptyState, Lock } from '@evia/ui-web';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { WORK_ORDERS_PATH } from '../paths.ts';

/** "Nie masz dostępu do administracji." (flows/12 → Brak uprawnień): no data, one way out; shared by the pages of the administration. */
export function AccessDenied() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <EmptyState
      icon={Lock}
      headingLevel={1}
      title={t('audit.denied.title')}
      description={t('audit.denied.description')}
      action={
        <Button
          onClick={() => {
            void navigate({ to: WORK_ORDERS_PATH });
          }}
        >
          {t('audit.denied.action')}
        </Button>
      }
    />
  );
}
