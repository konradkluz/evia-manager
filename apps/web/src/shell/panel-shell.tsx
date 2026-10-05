import { AppShell, Banner, ClipboardList, WifiOff, type LinkComponent, type NavigationItem } from '@evia/ui-web';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { WORK_ORDERS_PATH } from '../paths.ts';
import { useOnline } from './use-online.ts';

/** Router link for the UI library (typed paths of the panel). */
const RouterLink: LinkComponent = ({ href, children, ...rest }) => (
  <Link to={href as typeof WORK_ORDERS_PATH} {...rest}>
    {children}
  </Link>
);

/** Layout of every page: AppShell with the translated navigation and the offline banner (§ 4.10). */
export function PanelShell() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const online = useOnline();
  const navigation: NavigationItem[] = [
    {
      id: 'work-orders',
      label: t('nav.workOrders'),
      href: WORK_ORDERS_PATH,
      icon: ClipboardList,
      current: pathname.startsWith(WORK_ORDERS_PATH),
    },
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
      linkComponent={RouterLink}
    >
      <Outlet />
    </AppShell>
  );
}
