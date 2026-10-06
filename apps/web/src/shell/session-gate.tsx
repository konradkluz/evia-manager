import { Skeleton } from '@evia/ui-web';
import { Navigate, Outlet, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client.ts';
import { LOGIN_PATH, MFA_SETUP_PATH, WORK_ORDERS_PATH } from '../paths.ts';
import { DEFAULT_RETURN_TO, resolveReturnTo } from '../session/return-to.ts';
import { useSession } from '../session/session.ts';
import { ErrorState } from './error-state.tsx';
import { PanelShell } from './panel-shell.tsx';
import { SessionExpiryWarning } from './session-expiry-warning.tsx';

/**
 * Everything but the public pages sits behind the session (AC4, SR-AUTH-06): no session → login; `mfa_enrollment` →
 * W-03 on every address; an active session → the panel (and W-03 leads back to it). The server authorizes every
 * operation anyway — this only decides what the tab shows.
 */
export function SessionGate() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const session = useSession();
  // A failed refresh in the background keeps the data: the shell stays (the offline banner does its part). Only 401 or
  // a session that was never read ends the panel.
  if (session.isError && (session.data === undefined || (session.error instanceof ApiError && session.error.status === 401))) {
    if (!(session.error instanceof ApiError && session.error.status === 401)) return <ErrorState />;
    // The address the person was on comes back after logging in — as a path, validated again by W-01 (SR-WEB-06).
    const returnTo = resolveReturnTo(`${pathname}${search}`, globalThis.location.origin);
    return <Navigate to={LOGIN_PATH} replace {...(returnTo === DEFAULT_RETURN_TO ? {} : { search: { returnTo } })} />;
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
  // P-11 sits on every screen after logging in, W-03 included (an enrolment session expires like any other).
  const warning = <SessionExpiryWarning session={session.data} />;
  if (session.data.state === 'mfa_enrollment') {
    return pathname === MFA_SETUP_PATH ? (
      <>
        <Outlet />
        {warning}
      </>
    ) : (
      <Navigate to={MFA_SETUP_PATH} replace />
    );
  }
  return pathname === MFA_SETUP_PATH ? (
    <Navigate to={WORK_ORDERS_PATH} replace />
  ) : (
    <>
      <PanelShell session={session.data} />
      {warning}
    </>
  );
}
