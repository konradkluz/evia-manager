import { Tabs, type TabItem } from '@evia/ui-web';
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { AUDIT_PATH, USERS_PATH } from '../paths.ts';
import { useSession } from '../session/session.ts';

/**
 * Layout of the administration (flows/12: tabs "Użytkownicy" — W-16, the default — and "Dziennik audytu" — W-18; "Urządzenia" comes
 * with E9). The tabs belong to the layout, not to a page, so the focus stays on the tab while the arrows move between them. Only an
 * Administrator gets the tabs: the others get the page alone, which says "Brak dostępu" (the server decides everything anyway).
 */
export function AdministrationLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = useSession();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (session.data?.user.role !== 'administrator') return <Outlet />;
  const tabs: TabItem[] = [
    { id: 'users', label: t('administration.tabs.users') },
    { id: 'audit', label: t('administration.tabs.audit') },
  ];
  return (
    <Tabs
      label={t('administration.tabs.label')}
      tabs={tabs}
      selectedId={pathname.startsWith(AUDIT_PATH) ? 'audit' : 'users'}
      onSelect={(id) => {
        void navigate({ to: id === 'audit' ? AUDIT_PATH : USERS_PATH });
      }}
    >
      <Outlet />
    </Tabs>
  );
}
