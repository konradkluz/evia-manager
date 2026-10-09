import type { CurrentSession } from '@evia/contracts';
import {
  AccountMenu,
  AppShell,
  Banner,
  ClipboardList,
  InlineAlert,
  ShieldCheck,
  Users,
  WifiOff,
  type LinkComponent,
  type NavigationItem,
} from '@evia/ui-web';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ADMINISTRATION_PATH, AUDIT_PATH, CUSTOMERS_PATH, WORK_ORDERS_PATH } from '../paths.ts';
import { useLogout } from '../session/use-logout.ts';
import { useOnline } from './use-online.ts';

/** Router link for the UI library (typed paths of the panel). */
const RouterLink: LinkComponent = ({ href, children, ...rest }) => (
  <Link to={href as typeof WORK_ORDERS_PATH | typeof CUSTOMERS_PATH | typeof AUDIT_PATH} {...rest}>
    {children}
  </Link>
);

/**
 * Layout of every page behind the session: AppShell with the translated navigation, the offline banner (§ 4.10) and
 * the account menu with "Wyloguj" on every screen (EVM-016 AC6).
 */
export function PanelShell({ session }: { readonly session: CurrentSession }) {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const online = useOnline();
  const { logout, failed: logoutFailed } = useLogout();
  const navigation: NavigationItem[] = [
    {
      id: 'work-orders',
      label: t('nav.workOrders'),
      href: WORK_ORDERS_PATH,
      icon: ClipboardList,
      current: pathname.startsWith(WORK_ORDERS_PATH),
    },
    {
      id: 'customers',
      label: t('nav.customers'),
      href: CUSTOMERS_PATH,
      icon: Users,
      current: pathname.startsWith(CUSTOMERS_PATH),
    },
    // Only an Administrator sees the administration; the server authorizes every operation anyway (SR-AUTHZ-11).
    ...(session.user.role === 'administrator'
      ? [
          {
            id: 'administration',
            label: t('nav.administration'),
            href: AUDIT_PATH,
            icon: ShieldCheck,
            current: pathname.startsWith(ADMINISTRATION_PATH),
          },
        ]
      : []),
  ];
  return (
    <AppShell
      brand={t('app.name')}
      navigation={navigation}
      labels={{
        skipToContent: t('shell.skipToContent'),
        navigation: t('nav.label'),
        openMenu: t('shell.menu'),
        closeMenu: t('shell.closeMenu'),
      }}
      banner={online ? undefined : <Banner icon={WifiOff}>{t('shell.offline')}</Banner>}
      account={
        <AccountMenu
          triggerText={session.user.displayName}
          triggerLabel={t('shell.accountMenu', { name: session.user.displayName })}
          items={[{ id: 'logout', label: t('shell.logout'), onSelect: logout }]}
        />
      }
      linkComponent={RouterLink}
    >
      {logoutFailed ? <InlineAlert tone="error">{t('shell.logoutError')}</InlineAlert> : null}
      <Outlet />
    </AppShell>
  );
}
