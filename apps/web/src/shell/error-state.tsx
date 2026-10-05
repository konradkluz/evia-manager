import { Button, CircleAlert, EmptyState } from '@evia/ui-web';
import { useTranslation } from 'react-i18next';

/**
 * Screen error (styleguide § 4.9; EVM-008 "UX / UI" → error state): no technical details, one action that reloads
 * the page. `headingLevel` 1 when it replaces the whole screen, 2 inside the shell (the page h1 is gone then too, so
 * the route error uses 1 as well).
 */
export function ErrorState({
  onReload = () => {
    globalThis.location.reload();
  },
}: {
  readonly onReload?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={CircleAlert}
      headingLevel={1}
      title={t('error.boundary.title')}
      description={t('error.boundary.description')}
      action={<Button onClick={onReload}>{t('error.boundary.action')}</Button>}
    />
  );
}
