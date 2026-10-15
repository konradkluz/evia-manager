import { createRootRoute, createRoute, createRouter, Navigate, Outlet, useRouterState, type RouterHistory } from '@tanstack/react-router';
import { CustomerPage } from './pages/customer-page.tsx';
import { CustomersPage } from './pages/customers-page.tsx';
import { AuditPage } from './pages/audit-page.tsx';
import { ActivationPage } from './pages/activation-page.tsx';
import { LoginPage } from './pages/login-page.tsx';
import { MfaSetupPage } from './pages/mfa-setup-page.tsx';
import { NewWorkOrderPage } from './pages/new-work-order-page.tsx';
import { PaymentsPage } from './pages/payments-page.tsx';
import { PrivacyPage } from './pages/privacy-page.tsx';
import { WorkOrderPage } from './pages/work-order-page.tsx';
import { SecondStepPage } from './pages/second-step-page.tsx';
import { WorkOrdersPage } from './pages/work-orders-page.tsx';
import {
  ACTIVATE_PATH,
  ADMINISTRATION_PATH,
  AUDIT_PATH,
  CUSTOMERS_PATH,
  LOGIN_PATH,
  LOGIN_SECOND_STEP_PATH,
  MFA_SETUP_PATH,
  NEW_WORK_ORDER_PATH,
  PAYMENTS_PATH,
  PRIVACY_PATH,
  PUBLIC_PATHS,
  WORK_ORDERS_PATH,
} from './paths.ts';
import { validateSearch as validatePaymentsSearch } from './payments/unpaid-filters.ts';
import { validateSearch } from './work-orders/filters.ts';
import { ErrorState } from './shell/error-state.tsx';
import { PrivacyGate } from './shell/privacy-gate.tsx';
import { SessionGate } from './shell/session-gate.tsx';

/**
 * Public pages (link activation, login) render without a session; everything else sits behind the session gate. W-19 is
 * open to both (EVM-063 AC5): its own gate picks the layout from the session and never redirects.
 */
function Root() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (pathname === PRIVACY_PATH) return <PrivacyGate />;
  return PUBLIC_PATHS.includes(pathname) ? <Outlet /> : <SessionGate />;
}

const rootRoute = createRootRoute({ component: Root });

const ToWorkOrders = () => <Navigate to={WORK_ORDERS_PATH} replace />;

const ToAudit = () => <Navigate to={AUDIT_PATH} replace />;

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: ToWorkOrders });

/** The address of W-10 carries only `status` and `view` (EVM-017 AC2); anything else in it is dropped. */
const workOrdersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: WORK_ORDERS_PATH,
  component: WorkOrdersPage,
  validateSearch,
});
const newWorkOrderRoute = createRoute({ getParentRoute: () => rootRoute, path: NEW_WORK_ORDER_PATH, component: NewWorkOrderPage });
/** W-06 (EVM-018): the identifier is a UUID of the API; the page reads the order by it, four reads anchored in the order. */
const workOrderRoute = createRoute({ getParentRoute: () => rootRoute, path: `${WORK_ORDERS_PATH}/$workOrderId`, component: WorkOrderPage });
/** W-14 (EVM-039): the list of customers, and one customer by the UUID of the API. */
const customersRoute = createRoute({ getParentRoute: () => rootRoute, path: CUSTOMERS_PATH, component: CustomersPage });
const customerRoute = createRoute({ getParentRoute: () => rootRoute, path: `${CUSTOMERS_PATH}/$customerId`, component: CustomerPage });
/** W-11 (EVM-055): the address carries only `view=overdue`; a customer, a range of dates and a cursor stay in the memory of the tab. */
const paymentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: PAYMENTS_PATH,
  component: PaymentsPage,
  validateSearch: validatePaymentsSearch,
});
const administrationRoute = createRoute({ getParentRoute: () => rootRoute, path: ADMINISTRATION_PATH, component: ToAudit });
const auditRoute = createRoute({ getParentRoute: () => rootRoute, path: AUDIT_PATH, component: AuditPage });
const activateRoute = createRoute({ getParentRoute: () => rootRoute, path: ACTIVATE_PATH, component: ActivationPage });
const mfaSetupRoute = createRoute({ getParentRoute: () => rootRoute, path: MFA_SETUP_PATH, component: MfaSetupPage });
/** `returnTo` is read as a plain text only; the page resolves it against the origin of the panel (SR-WEB-06). */
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: LOGIN_PATH,
  component: LoginPage,
  validateSearch: (search: Record<string, unknown>): { returnTo?: string } =>
    typeof search['returnTo'] === 'string' ? { returnTo: search['returnTo'] } : {},
});
/** W-19 (EVM-063): static content for every role and for a visitor without a session. */
const privacyRoute = createRoute({ getParentRoute: () => rootRoute, path: PRIVACY_PATH, component: PrivacyPage });
const secondStepRoute = createRoute({ getParentRoute: () => rootRoute, path: LOGIN_SECOND_STEP_PATH, component: SecondStepPage });

const routeTree = rootRoute.addChildren([
  indexRoute,
  workOrdersRoute,
  newWorkOrderRoute,
  workOrderRoute,
  customersRoute,
  customerRoute,
  paymentsRoute,
  administrationRoute,
  auditRoute,
  activateRoute,
  mfaSetupRoute,
  loginRoute,
  secondStepRoute,
  privacyRoute,
]);

/**
 * Router of the panel (ADR-0006): `/` → `/work-orders`; an unknown path also lands on the list (no other pages
 * yet) — behind the session gate, so without a session it ends on the login page; a rendering error of a page shows
 * the error state inside the shell — never the router's default error screen with technical details.
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
