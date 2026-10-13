import { Navigate, Outlet } from '@tanstack/react-router';
import { ApiError } from '../api/client.ts';
import { MFA_SETUP_PATH } from '../paths.ts';
import { useSession } from '../session/session.ts';
import { PanelShell } from './panel-shell.tsx';
import { PublicPageLayout } from './public-page-layout.tsx';
import { SessionExpiryWarning } from './session-expiry-warning.tsx';
import { SessionLoading } from './session-gate.tsx';

/**
 * Gate of W-19 (EVM-063 AC1, AC5; SR-AUTHZ-05): the page is open to every role and to a visitor without a session, so it
 * does not send anyone to W-01 — it only decides the layout. The layout of the panel (Sidebar, TopBar with the name and
 * the e-mail) appears ONLY when the server has confirmed an `active` session; `401` — also when the tab still holds the
 * data of an earlier session — gives the public layout, and so does a failure that left us without any answer (the page
 * has no data of its own, so an unknown state is never the panel). `mfa_enrollment` leads to W-03 like everywhere else.
 */
export function PrivacyGate() {
  const session = useSession();
  const noSession = session.isError && session.error instanceof ApiError && session.error.status === 401;
  if (noSession) return <PublicLayout />;
  if (session.isPending) return <SessionLoading />;
  const current = session.data;
  if (current === undefined) return <PublicLayout />;
  // The panel only for a state the server confirmed as `active`; the only other state (`mfa_enrollment`) leads to W-03.
  if (current.state === 'active') {
    return (
      <>
        <PanelShell session={current} />
        <SessionExpiryWarning session={current} />
      </>
    );
  }
  return <Navigate to={MFA_SETUP_PATH} replace />;
}

function PublicLayout() {
  return (
    <PublicPageLayout>
      <Outlet />
    </PublicPageLayout>
  );
}
