import { BlockingState, KeyRound } from '@evia/ui-web';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../shell/use-page-title.ts';

/**
 * Placeholder of W-01 until EVM-067 (logging in at the next visits): the destination of "Przejdź do logowania", of a
 * logout and of a missing session. It renders no form and fetches nothing.
 */
export function LoginPage() {
  const { t } = useTranslation();
  usePageTitle(t('login.pageTitle'));
  return <BlockingState brand={t('app.name')} icon={KeyRound} title={t('login.title')} description={t('login.description')} />;
}
