import { ArrowLeft, Banner, TextLink, WifiOff } from '@evia/ui-web';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LOGIN_PATH } from '../paths.ts';
import { RouterLink } from './router-link.tsx';
import { useOnline } from './use-online.ts';

/**
 * Layout of a page of content opened without a session (W-19 before logging in, flow 15 mockup B): the name of the panel
 * and "Wróć do logowania" — no Sidebar, no TopBar, no account menu, nothing of a user. The way back is a plain link to
 * `/login` without a query (no `returnTo`, SR-WEB-06).
 */
export function PublicPageLayout({ children }: { readonly children: ReactNode }) {
  const { t } = useTranslation();
  const online = useOnline();
  return (
    <div className="flex flex-col min-h-screen bg-bg-canvas text-text-primary">
      <header className="flex items-center justify-between gap-inline-md px-grid-compact-margin medium:px-grid-medium-margin py-stack-md">
        <p className="text-label-lg font-semibold">{t('app.name')}</p>
        <TextLink href={LOGIN_PATH} link={RouterLink}>
          <span className="inline-flex items-center gap-inline-xs min-h-touch-target-min">
            <ArrowLeft aria-hidden="true" className="size-icon-md shrink-0" />
            {t('privacy.backToLogin')}
          </span>
        </TextLink>
      </header>
      {online ? null : <Banner icon={WifiOff}>{t('shell.offline')}</Banner>}
      <main className="flex-1 px-grid-compact-margin medium:px-grid-medium-margin py-stack-lg">
        <div className="w-full max-w-form-max-width">{children}</div>
      </main>
    </div>
  );
}
