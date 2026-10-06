import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/** Sets the tab title to "<page> · EVia Manager" (styleguide § 7.1). Titles never carry personal data or tokens. */
export function usePageTitle(page: string): void {
  const { t } = useTranslation();
  useEffect(() => {
    document.title = t('app.pageTitle', { page });
  }, [t, page]);
}
