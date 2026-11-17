import type { Answer } from './mock-locations.ts';

/**
 * The part of the synthetic API that serves one site survey ("Wizja lokalna", EVM-138): the details of ZL-2026-0049, the assignment of a
 * customer (`PUT …/customer`: `412 version_conflict`, `409 customer_already_set`, `422 customer_unavailable`), the transitions with the rule
 * "Zaakceptowane wymaga klienta" (`409 customer_required`), the rejection with a reason code and the restore (the Administrator with the
 * step-up; the Editor `403`), and the empty reads an ordinary order has (a survey has none of them and the panel must not ask — the spec
 * checks it). The rules of the real server that the browser can feel; the database, the policies and the audit belong to the API tests.
 * Synthetic data only.
 */
export const SURVEY_ID = '01968f3e-0000-7000-8000-00000000d049';
export const SURVEY_NUMBER = 'ZL-2026-0049';
export const SURVEY_PATH = `/work-orders/${SURVEY_ID}`;
const BASE = `/api/v1/work-orders/${SURVEY_ID}`;
const DAY_MS = 86_400_000;

export interface SurveyServer {
  status: 'quoting' | 'on_hold' | 'cancelled' | 'accepted';
  version: number;
  customer: { id: string; displayName: string; phone: string } | null;
  /** A survey while it has a deadline; the assignment ends it (`null`). */
  expiresAt: string | null;
  extensionCount: number;
  requesterPhone: string | null;
  /** The next call of the assignment answers `412` once (somebody changed the order meanwhile). */
  conflictOnce: boolean;
  /** Reasons the rejection was given with, in order. */
  rejections: string[];
  /** The assignment bodies as the server saw them. */
  assignments: Array<{ customerId: string; version: number }>;
}

/** Noon UTC of the day `days` from today (a day in Warsaw too): the text "Wygasa za N dni" does not depend on the hour of the run. */
export function deadlineIn(days: number): string {
  const today = new Date().toISOString().slice(0, 10);
  return new Date(Date.parse(`${today}T12:00:00Z`) + days * DAY_MS).toISOString();
}

export function newSurveyServer(daysLeft = 80): SurveyServer {
  return {
    status: 'quoting',
    version: 5,
    customer: null,
    expiresAt: deadlineIn(daysLeft),
    extensionCount: 0,
    requesterPhone: '+48600000002',
    conflictOnce: false,
    rejections: [],
    assignments: [],
  };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Answer => ({
  status,
  headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json', 'Cache-Control': 'no-store', ...headers },
  body: JSON.stringify(body),
});

const problem = (status: number, code: string, extra: Record<string, unknown> = {}): Answer =>
  json(status, { type: `/problems/${code}`, title: code, status, code, traceId: 'abcdef0123456789abcdef0123456789', ...extra });

export interface SurveyInput {
  readonly method: string;
  readonly pathname: string;
  readonly body: () => unknown;
  readonly role: 'administrator' | 'editor' | 'read_only';
  readonly csrfOk: boolean;
  readonly stepUpFresh: boolean;
  readonly ifMatch: string | undefined;
  /** The site of the survey as the details carry it, and as the card "Lokalizacja" does. */
  readonly site: Record<string, unknown>;
  readonly siteCard: Record<string, unknown>;
  readonly customerOf: (id: string) => { id: string; displayName: string; phone: string } | undefined;
}

const allowed = (server: SurveyServer, role: SurveyInput['role']): string[] => {
  if (server.customer !== null) return ['in_progress', 'on_hold', 'cancelled'];
  switch (server.status) {
    case 'quoting':
      return ['accepted', 'on_hold', 'cancelled'];
    case 'on_hold':
      return ['quoting', 'cancelled'];
    case 'cancelled':
      return role === 'administrator' ? ['on_hold'] : [];
    case 'accepted':
      return ['in_progress'];
  }
};

function details(server: SurveyServer, input: SurveyInput): Answer {
  return json(
    200,
    {
      id: SURVEY_ID,
      number: SURVEY_NUMBER,
      title: 'Wizja lokalna',
      status: server.status,
      customer: server.customer === null ? null : { id: server.customer.id, displayName: server.customer.displayName },
      site: input.site,
      coordinator: { id: '11111111-1111-4111-8111-111111111111', displayName: 'Anna Testowa' },
      allowedTransitions: allowed(server, input.role),
      version: server.version,
      createdAt: '2026-11-03T10:00:00.000Z',
      origin: 'office',
      siteSurvey:
        server.expiresAt === null
          ? null
          : { expiresAt: server.expiresAt, extensionCount: server.extensionCount, requesterPhone: server.requesterPhone },
    },
    { ETag: `"${String(server.version)}"` },
  );
}

/** `null` — the request is not about this survey. */
export function answerSurveyRoute(server: SurveyServer, input: SurveyInput): Answer | null {
  if (!input.pathname.startsWith(BASE)) return null;
  const part = input.pathname.slice(BASE.length);
  // the survey is invisible to Tylko odczyt: one answer, no trace of it
  if (input.role === 'read_only') return problem(404, 'not_found');
  if (input.method === 'GET') {
    switch (part) {
      case '':
        return details(server, input);
      case '/site':
        return json(200, input.siteCard);
      case '/site-orders':
        return json(200, { total: 0, items: [] });
      case '/media-assets':
        return json(200, { items: [], nextCursor: null });
      case '/documents':
        return json(200, { items: [], nextCursor: null, totalCount: 0 });
      case '/timeline':
        return json(200, { items: [], nextCursor: null });
      case '/customer':
        return server.customer === null
          ? problem(404, 'not_found')
          : json(200, { displayName: server.customer.displayName, phone: server.customer.phone, email: null, anonymized: false });
      case '/procedures':
        return json(200, { items: [], openStageCount: 0 });
      case '/deleted-procedures':
        return json(200, { procedures: [], stages: [], truncated: false });
      case '/payment-milestones':
        return json(200, {
          items: [],
          totals: { unpaid: { amountMinor: 0, currency: 'PLN' }, paid: { amountMinor: 0, currency: 'PLN' } },
        });
      case '/scope-items':
        return json(200, { items: [] });
      default:
        return null;
    }
  }
  if (!input.csrfOk) return problem(403, 'csrf_failed');
  if (part === '/customer' && input.method === 'PUT') {
    const sent = input.body() as { customerId: string; version: number };
    server.assignments.push(sent);
    if (server.customer !== null) return problem(409, 'customer_already_set');
    if (server.status === 'cancelled') return problem(409, 'invalid_state_transition');
    if (server.conflictOnce) {
      server.conflictOnce = false;
      server.version += 1;
      return problem(412, 'version_conflict');
    }
    if (sent.version !== server.version) return problem(412, 'version_conflict');
    const customer = input.customerOf(sent.customerId);
    if (customer === undefined) return problem(422, 'customer_unavailable');
    server.customer = customer;
    server.expiresAt = null;
    server.requesterPhone = null;
    server.version += 1;
    return details(server, input);
  }
  if (part === '/transitions' && input.method === 'POST') {
    const sent = input.body() as { to: string; reasonCode?: string };
    if (input.ifMatch !== `"${String(server.version)}"`) return problem(412, 'version_conflict');
    if (sent.to === 'accepted' && server.customer === null) return problem(409, 'customer_required');
    if (sent.to === 'cancelled') {
      if (sent.reasonCode === undefined)
        return problem(400, 'validation_failed', { errors: [{ pointer: '/reasonCode', code: 'required' }] });
      if (sent.reasonCode !== 'offer_rejected' && sent.reasonCode !== 'customer_withdrew') {
        return problem(400, 'validation_failed', { errors: [{ pointer: '/reasonCode', code: 'invalid_value' }] });
      }
      server.rejections.push(sent.reasonCode);
      server.status = 'cancelled';
      const soon = Date.now() + 14 * DAY_MS;
      server.expiresAt = new Date(Math.min(Date.parse(server.expiresAt ?? ''), soon)).toISOString();
    } else if (sent.to === 'on_hold' && server.status === 'cancelled') {
      if (input.role !== 'administrator') return problem(403, 'forbidden');
      if (!input.stepUpFresh) return problem(403, 'step_up_required');
      server.status = 'on_hold';
      server.expiresAt = new Date(Math.max(Date.parse(server.expiresAt ?? ''), Date.now() + 14 * DAY_MS)).toISOString();
    } else if (allowed(server, input.role).includes(sent.to)) {
      server.status = sent.to as SurveyServer['status'];
    } else {
      return problem(409, 'invalid_state_transition');
    }
    server.version += 1;
    return details(server, input);
  }
  return null;
}
