import type { CurrentSession, WorkOrderDetails } from '@evia/contracts';
import { ACTIVE_SESSION, json, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { activeSessionApi } from './render.tsx';
import { HEADER, workOrderRoutes } from './work-order-api.ts';

/** Synthetic site survey ZL-2026-0049 (EVM-138): an order without a customer, "Wycena", with a deadline of expiry. */
export const SURVEY_ID = '01968f3e-0000-7000-8000-00000000d049';
export const SURVEY_PATH = `/work-orders/${SURVEY_ID}`;
export const SURVEY_URL = `/api/v1/work-orders/${SURVEY_ID}`;
/** The "now" of the tests: 80 days before the default deadline of the survey. */
export const NOW = '2027-01-30T09:00:00.000Z';

export const JAN = { id: '01968f3e-0000-7000-8000-00000000aaaa', displayName: 'Jan Przykładowy', phone: '+48600000001' };

export function surveyOrder(over: Partial<WorkOrderDetails> = {}): WorkOrderDetails {
  return {
    ...HEADER,
    id: SURVEY_ID,
    number: 'ZL-2026-0049',
    title: 'Wizja lokalna',
    status: 'quoting',
    customer: null,
    version: 5,
    allowedTransitions: ['accepted', 'on_hold', 'cancelled'],
    siteSurvey: { expiresAt: '2027-04-20T10:00:00.000Z', extensionCount: 0, requesterPhone: '+48600000002' },
    ...over,
  };
}

export const roleSession = (role: 'editor' | 'read_only'): CurrentSession => ({
  ...ACTIVE_SESSION,
  user: { ...ACTIVE_SESSION.user, role },
});

/**
 * The reads of W-06 for a survey. The routes of the processes, the instalments, the scope and the card of the customer exist, so a
 * panel that asked for them would be seen in `api.calls(...)` — it must not (a survey has none of them).
 */
export function surveyApi(
  order: WorkOrderDetails = surveyOrder(),
  extra: Record<string, Handler> = {},
  session: CurrentSession = ACTIVE_SESSION,
) {
  return activeSessionApi({
    [SESSION_ROUTE]: () => json(200, session),
    ...workOrderRoutes(SURVEY_ID, { header: () => json(200, order, { ETag: `"${String(order.version)}"` }) }),
    ...extra,
  });
}

/** The card of the customer is not asked for a survey (the API says `404`); the processes, the instalments and the scope are read with the header and ignored. */
export const SURVEY_ROUTES_NOT_ASKED = [`GET ${SURVEY_URL}/customer`] as const;

/** Everything the browser keeps for the tab: keys and values of `localStorage` and `sessionStorage` as one text (a phone must not be in it). */
export function browserStorageText(): string {
  return [localStorage, sessionStorage].flatMap((store) => Object.keys(store).map((key) => `${key}=${store.getItem(key) ?? ''}`)).join('|');
}
