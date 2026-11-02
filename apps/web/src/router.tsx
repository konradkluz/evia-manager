import { createRootRoute, createRoute, createRouter, Navigate, Outlet, useRouterState, type RouterHistory } from '@tanstack/react-router';
import { AccountPage } from './pages/account-page.tsx';
import { CustomerPage } from './pages/customer-page.tsx';
import { CustomersPage } from './pages/customers-page.tsx';
import { AdministrationLayout } from './administration/administration-layout.tsx';
import { AuditPage } from './pages/audit-page.tsx';
import { DevicesPage } from './pages/devices-page.tsx';
import { ActivationPage } from './pages/activation-page.tsx';
import { LoginPage } from './pages/login-page.tsx';
import { MfaSetupPage } from './pages/mfa-setup-page.tsx';
import { NewWorkOrderPage } from './pages/new-work-order-page.tsx';
import { PaymentsPage } from './pages/payments-page.tsx';
import { ResetPasswordPage } from './pages/reset-password-page.tsx';
import { ResetRequestPage } from './pages/reset-request-page.tsx';
import { PrivacyPage } from './pages/privacy-page.tsx';
import { UsersPage } from './pages/users-page.tsx';
import { WorkOrderPage } from './pages/work-order-page.tsx';
import { SecondStepPage } from './pages/second-step-page.tsx';
import { WorkOrdersPage } from './pages/work-orders-page.tsx';
import {
  ACCOUNT_PATH,
  ACTIVATE_PATH,
  ADMINISTRATION_PATH,
  CUSTOMERS_PATH,
  LOGIN_PATH,
  LOGIN_RESET_PATH,
  LOGIN_SECOND_STEP_PATH,
  MFA_SETUP_PATH,
  NEW_WORK_ORDER_PATH,
  PAYMENTS_PATH,
  PRIVACY_PATH,
  PUBLIC_PATHS,
  RESET_PASSWORD_PATH,
  USERS_PATH,
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

const ToUsers = () => <Navigate to={USERS_PATH} replace />;

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
/** The administration (EVM-024, EVM-029): a layout with tabs; `/administration` is W-16, the users (the default tab). */
const administrationRoute = createRoute({ getParentRoute: () => rootRoute, path: ADMINISTRATION_PATH, component: AdministrationLayout });
const administrationIndexRoute = createRoute({ getParentRoute: () => administrationRoute, path: '/', component: ToUsers });
const usersRoute = createRoute({ getParentRoute: () => administrationRoute, path: 'users', component: UsersPage });
const auditRoute = createRoute({ getParentRoute: () => administrationRoute, path: 'audit', component: AuditPage });
const devicesRoute = createRoute({ getParentRoute: () => administrationRoute, path: 'devices', component: DevicesPage });
/** W-15 (EVM-028): the own account of every role; the data is the session's, so there is no identifier in the address. */
const accountRoute = createRoute({ getParentRoute: () => rootRoute, path: ACCOUNT_PATH, component: AccountPage });
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
/** W-12 (EVM-025): the token of the link is in memory (the fragment was removed before the router); W-01 "Zresetuj hasło" asks for a link. */
const resetPasswordRoute = createRoute({ getParentRoute: () => rootRoute, path: RESET_PASSWORD_PATH, component: ResetPasswordPage });
const resetRequestRoute = createRoute({ getParentRoute: () => rootRoute, path: LOGIN_RESET_PATH, component: ResetRequestPage });
const secondStepRoute = createRoute({ getParentRoute: () => rootRoute, path: LOGIN_SECOND_STEP_PATH, component: SecondStepPage });

const routeTree = rootRoute.addChildren([
  indexRoute,
  workOrdersRoute,
  newWorkOrderRoute,
  workOrderRoute,
  customersRoute,
  customerRoute,
  paymentsRoute,
  administrationRoute.addChildren([administrationIndexRoute, usersRoute, auditRoute, devicesRoute]),
  accountRoute,
  activateRoute,
  mfaSetupRoute,
  loginRoute,
  secondStepRoute,
  resetPasswordRoute,
  resetRequestRoute,
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
