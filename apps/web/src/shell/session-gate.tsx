import { Skeleton } from '@evia/ui-web';
import { Navigate, Outlet, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client.ts';
import { LOGIN_PATH, MFA_SETUP_PATH, WORK_ORDERS_PATH } from '../paths.ts';
import { useSession } from '../session/session.ts';
import { ErrorState } from './error-state.tsx';
import { PanelShell } from './panel-shell.tsx';

/**
 * Everything but the public pages sits behind the session (AC4, SR-AUTH-06): no session → login; `mfa_enrollment` →
 * W-03 on every address; an active session → the panel (and W-03 leads back to it). The server authorizes every
 * operation anyway — this only decides what the tab shows.
 */
export function SessionGate() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const session = useSession();
  // A failed refresh in the background keeps the data: the shell stays (the offline banner does its part). Only 401 or
  // a session that was never read ends the panel.
  if (session.isError && (session.data === undefined || (session.error instanceof ApiError && session.error.status === 401))) {
    return session.error instanceof ApiError && session.error.status === 401 ? <Navigate to={LOGIN_PATH} replace /> : <ErrorState />;
  }
  if (session.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-stack-md p-inset-lg">
        <p role="status" className="text-body text-text-secondary">
          {t('shell.loading')}
        </p>
        <Skeleton />
        <Skeleton className="w-1/2" />
      </div>
    );
  }
  if (session.data.state === 'mfa_enrollment') {
    return pathname === MFA_SETUP_PATH ? <Outlet /> : <Navigate to={MFA_SETUP_PATH} replace />;
  }
  return pathname === MFA_SETUP_PATH ? <Navigate to={WORK_ORDERS_PATH} replace /> : <PanelShell session={session.data} />;
}
