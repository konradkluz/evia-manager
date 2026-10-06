import { createRootRoute, createRoute, createRouter, Navigate, type RouterHistory } from '@tanstack/react-router';
import { WorkOrdersPage } from './pages/work-orders-page.tsx';
import { WORK_ORDERS_PATH } from './paths.ts';
import { ErrorState } from './shell/error-state.tsx';
import { PanelShell } from './shell/panel-shell.tsx';

const rootRoute = createRootRoute({ component: PanelShell });

const ToWorkOrders = () => <Navigate to={WORK_ORDERS_PATH} replace />;

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: ToWorkOrders });

const workOrdersRoute = createRoute({ getParentRoute: () => rootRoute, path: WORK_ORDERS_PATH, component: WorkOrdersPage });

const routeTree = rootRoute.addChildren([indexRoute, workOrdersRoute]);

/**
 * Router of the panel (ADR-0006): `/` → `/work-orders`; an unknown path also lands on the list (no other pages
 * yet); a rendering error of a page shows the error state inside the shell — never the router's default error screen
 * with technical details.
 */
export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    ...(history ? { history } : {}),
    defaultNotFoundComponent: ToWorkOrders,
    defaultErrorComponent: () => <ErrorState />,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
