import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PRIVACY_PATH } from '../paths.ts';

const LINK = 'inline-flex items-center min-h-touch-target-min underline text-text-on-brand text-body-sm focus-visible:focus-ring-inverse';

/**
 * Footer of W-01 (EVM-063 AC1; WCAG 3.2.6): "Prywatność · Pomoc" in the same place before logging in as the account menu
 * is after it. Two links to W-19 with a fixed anchor each — static, so nothing of the address of W-01 (`returnTo`) goes
 * along (SR-WEB-06) and nothing of a user is shown.
 */
export function AuthFooter() {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('login.footerLabel')} className="flex items-center gap-inline-md">
      <Link to={PRIVACY_PATH} hash="prywatnosc" className={LINK}>
        {t('login.footerPrivacy')}
      </Link>
      <span aria-hidden="true" className="text-text-on-brand">
        {t('login.footerSeparator')}
      </span>
      <Link to={PRIVACY_PATH} hash="pomoc" className={LINK}>
        {t('login.footerHelp')}
      </Link>
    </nav>
  );
}
