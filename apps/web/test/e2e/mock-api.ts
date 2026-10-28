import type { Page, Request, Route } from '@playwright/test';
import {
  answerAssignable,
  answerCreate,
  answerOrderDelete,
  answerOrderRead,
  answerOrderRestore,
  answerTransition,
  answerTemplates,
  createdListItems,
  deletedListItems,
  INITIAL_TEMPLATES,
  type OrderServer,
} from './mock-work-orders.ts';
import { answerEntryErase } from './mock-journal-erase.ts';
import { answerJournalCreate, answerJournalList, newJournalServer, type JournalServer } from './mock-journal.ts';
import {
  answerCreateProcedure,
  answerCreateStage,
  answerDeleted,
  answerDelete,
  answerEditedProcedures,
  answerRestore,
  type EditingState,
} from './mock-procedure-editing.ts';
import { answerStagePatch, answerStageTransition } from './mock-procedures.ts';
import {
  answerPaymentCreate,
  answerPaymentDelete,
  answerPaymentPatch,
  answerPayments,
  answerPaymentTransition,
  paymentsCondition,
  paymentsEffect,
} from './mock-payments.ts';
import {
  answerUnpaidList,
  answerUnpaidOrderPayments,
  answerUnpaidTransition,
  isUnpaidOrder,
  newUnpaidServer,
  type UnpaidServer,
} from './mock-unpaid.ts';
import {
  answerAccountOperation,
  answerInvite,
  answerResend,
  answerUserList,
  newUsersServer,
  type AccountOperationName,
  type UsersServer,
} from './mock-users.ts';
import { answerAccountRoute, newAccountServer, spendMark, type AccountServer } from './mock-account.ts';
import { answerCatalogItems, answerCatalogProcedures, answerOrderPatch, answerScopeChange, answerScopeCreate } from './mock-scope.ts';
import { answerPatch as answerLocationPatch, answerRead as answerLocationRead, partyOf, siteOf } from './mock-locations.ts';
import {
  answerList,
  answerPatch,
  answerRead,
  answerSearch,
  e164,
  fold,
  type MockCustomerRecord,
  type PatchKeys,
} from './mock-customers.ts';

/**
 * A synthetic API for the panel's browser tests (EVM-016 AC3–AC6). It plays the server side of the contract closely
 * enough that the browser does the real work: the origin check looks at the header the browser itself sends (`Origin`), the passkey is verified against the challenge and the origin the browser really put into
 * `clientDataJSON`. Everything is synthetic — no real accounts, tokens or addresses. The full stack (real API and
 * database) is covered by the API integration tests and the QA run; here the target is the tab.
 */
export type SessionKind = 'none' | 'active' | 'enrollment';

export const VALID_TOKEN = 'Vz3-_Aq9'.repeat(5) + 'xyz';
/** EVM-025: the token of a password reset link of the synthetic server (a different one than the activation link). */
export const RESET_TOKEN = 'Rs4-_Kd8'.repeat(5) + 'xyz';
export const EMAIL = 'anna.testowa@example.com';
export const DISPLAY_NAME = 'Anna Testowa';
export const PASSWORD = 'zażółć gęślą jaźń!';
/** Relying party of the synthetic server: `localhost` is the only host that WebAuthn accepts besides domain names. */
export const RP_ID = 'localhost';
/** EVM-023: the codes of the synthetic server — a code of the authenticator app is valid once (the same code twice is refused), as is the recovery code. */
export const TOTP_CODE = '123456';
export const RECOVERY_CODE = 'ABCDEFGHIJKLMNOPQRST';
export const TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const RECOVERY_CODES = Array.from({ length: 10 }, (_, index) =>
  index === 0 ? RECOVERY_CODE : `ABCDEFGHIJKLMNOPQR${String(index).padStart(2, '2')}`,
);

export interface Seen {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly postData: string | null;
}

export interface MockApi {
  readonly seen: Seen[];
  session: SessionKind;
  /** Decides the answer for `checkActivationLink` (default: valid only for VALID_TOKEN). */
  tokenValid: (token: string) => boolean;
  /** EVM-025: decides the answer for the check and the completion of a password reset link (default: valid only for RESET_TOKEN, once). */
  resetLinkValid: (token: string) => boolean;
  /** Answers of the next calls, to rehearse failures. */
  failNext: Map<string, { status: number; code: string; headers?: Record<string, string> }>;
  /** EVM-067: the account of the synthetic server has a passkey (`second_step`) or none (`mfa_enrollment`). */
  loginMode: 'second_step' | 'mfa_enrollment';
  /** EVM-023: the methods of the second step that the server offers in the answer of the password (the order of the server). */
  methods: string[];
  /** EVM-023: the codes of the authenticator app and the recovery codes the server has already accepted (each works once). */
  usedCodes: Set<string>;
  /** EVM-067: id (base64url) of the passkey the test registered in the virtual authenticator; the login accepts only it. */
  credentialId: string | null;
  /** EVM-067: the server has ended the session (`GET /session` answers `401 session_expired`). */
  expired: boolean;
  /** EVM-067: minutes from the first read of a session to the end of inactivity and to the absolute end. */
  sessionMinutes: { idle: number; absolute: number };
  /** EVM-067: how far the clock of the tab was moved (`page.clock`), so that the server counts in the tab's time. */
  clockOffsetMs: number;
  /** EVM-067: the deadlines of the current session (fixed at its first read; moved only by the extension). */
  deadlines: { idle: number; absolute: number } | null;
  /** EVM-067: the first-step token that was issued, to check it never travels anywhere but the POST bodies. */
  loginToken: string | null;
  /** EVM-029: the role of the account (the audit log is for the Administrator only). */
  role: 'administrator' | 'editor' | 'read_only';
  /** EVM-029: `required` — the audit log answers `403 step_up_required` until the passkey step-up; `fresh` — the window is open. */
  stepUp: 'required' | 'fresh';
  /** EVM-029: the CSRF token of the active session; the step-up rotates it. */
  csrf: string;
  /** EVM-029: how many events the synthetic audit log holds (newest first). */
  auditEvents: number;
  /** EVM-017: how many work orders the synthetic list holds (0 = the empty state; the shell specs of EVM-008 expect it). */
  workOrders: number;
  /** EVM-034: the synthetic orders have waits and due dates (the columns "Czekamy na" and "Termin"); `false` — none of them waits. */
  waits: boolean;
  /** EVM-020: the customers of the synthetic server (searched by name, city or phone; saved ones are added). */
  customers: MockCustomer[];
  /** EVM-021: the sites of the synthetic server (searched by address; saved ones are added). */
  sites: MockSite[];
  /** EVM-021: the parties of the synthetic server (searched by name and kind; saved ones are added). */
  parties: MockParty[];
  /** EVM-022: the catalogue of templates, the users who can be a coordinator and the orders created so far (W-05, W-10). */
  orders: OrderServer;
  /** EVM-042: the structure of the processes of the orders after a process or a stage was added, removed or restored by hand. */
  procedureEdits: EditingState;
  /** EVM-055: the twelve invoiced instalments of W-11 (the unpaid list). */
  unpaid: UnpaidServer;
  /** EVM-024: the accounts of W-16 (the list, the invitations and their idempotency keys). */
  users: UsersServer;
  /** EVM-028: the own account of W-15 (the passkeys with names, the code of the app, the recovery codes, the sessions and the one-time mark of the full re-authentication). */
  account: AccountServer;
  /** EVM-037: the journal of the orders (the entries and the idempotency keys of the synthetic server). */
  journal: JournalServer;
  /** EVM-020: the answer to these calls is lost after the server has done the work (a network error after sending). */
  dropResponseNext: Set<string>;
}

export type MockCustomer = MockCustomerRecord;

export interface MockSite {
  readonly id: string;
  readonly siteType: string;
  readonly street: string;
  readonly buildingNumber: string;
  readonly apartmentNumber?: string;
  readonly postalCode: string;
  readonly city: string;
  readonly parkingSpotNumber?: string;
  readonly garageLevel?: string;
}

export interface MockParty {
  readonly id: string;
  readonly kind: string;
  readonly legalForm: string;
  readonly displayName: string;
}

const MANAGER_KINDS = ['building_administration', 'property_manager', 'housing_community'];

const problem = (status: number, code: string, extra: object = {}, headers: Record<string, string> = {}) => ({
  status,
  headers: { 'Content-Type': 'application/problem+json', ...headers },
  body: JSON.stringify({ type: `/problems/${code}`, title: code, status, code, traceId: '0123456789abcdef0123456789abcdef', ...extra }),
});

const ok = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  status,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

const MINUTE = 60_000;
export const LOGIN_TOKEN = 'Lg7-_Qz2'.repeat(5) + 'abc';

function sessionBody(
  kind: Exclude<SessionKind, 'none'>,
  deadlines = { idle: Date.now() + 60 * MINUTE, absolute: Date.now() + 720 * MINUTE },
  active: { csrf: string; role: string; displayName?: string } = { csrf: 'csrf-active', role: 'administrator' },
) {
  return {
    user: { id: '11111111-1111-4111-8111-111111111111', displayName: active.displayName ?? DISPLAY_NAME, role: active.role },
    state: kind === 'active' ? 'active' : 'mfa_enrollment',
    channel: 'web',
    csrfToken: kind === 'active' ? active.csrf : 'csrf-enrollment',
    idleExpiresAt: new Date(deadlines.idle).toISOString(),
    absoluteExpiresAt: new Date(deadlines.absolute).toISOString(),
  };
}

const AUDIT_ACTIONS = ['audit.read', 'login.succeeded', 'login.failed', 'session.created', 'step_up.succeeded'] as const;

/** One synthetic event of the audit log (newest first; no real data): the same index always gives the same event. */
function auditEvent(index: number) {
  const action = AUDIT_ACTIONS[index % AUDIT_ACTIONS.length] ?? 'audit.read';
  const failed = action === 'login.failed';
  const suffix = String(index).padStart(12, '0');
  return {
    id: `00000000-0000-4000-8000-${suffix}`,
    occurredAt: new Date(Date.UTC(2026, 9, 4, 12, 0) - index * 7 * MINUTE).toISOString(),
    actor: failed ? null : { userId: '11111111-1111-4111-8111-111111111111', displayName: DISPLAY_NAME },
    action,
    outcome: failed ? 'denied' : 'success',
    reasonCode: failed ? 'bad_password' : null,
    objectType: action === 'audit.read' ? 'audit' : action === 'session.created' ? 'session' : 'user',
    objectId: action === 'audit.read' ? null : `33333333-3333-4333-8333-${suffix}`,
    ipPrefix: index % 7 === 6 ? '2001:db8:1234::/48' : '198.51.100.0/24',
  };
}

const ORDER_STATUSES = ['new', 'quoting', 'accepted', 'in_progress', 'completed', 'settled', 'on_hold', 'cancelled'] as const;
const COORDINATORS = [
  { id: '11111111-1111-4111-8111-111111111111', displayName: DISPLAY_NAME },
  { id: '22222222-2222-4222-8222-222222222222', displayName: 'Jan Przykładowy' },
  null,
] as const;

/** The kinds of party the synthetic waits are for (EVM-034): the names are the ones of W-06 ("Stoen Operator (OSD)"). */
const WAITS = [
  // 0: the OSD for 15 days and one more wait, a due date that has passed
  {
    waiting: {
      waitingOn: 'party',
      party: { id: '01968f3e-0000-7000-8000-00000000ddd1', displayName: 'Stoen Operator', kind: 'distribution_system_operator' },
      since: '2026-09-18',
      days: 15,
      otherCount: 1,
    },
    nextDueDate: '2026-09-30',
    hasOverdueStage: true,
  },
  // 1: the customer for 3 days
  {
    waiting: { waitingOn: 'customer', party: null, since: '2026-09-30', days: 3, otherCount: 0 },
    nextDueDate: '2026-10-20',
    hasOverdueStage: false,
  },
  // 2: the administration for 20 days, no due date
  {
    waiting: {
      waitingOn: 'party',
      party: { id: '01968f3e-0000-7000-8000-00000000ddd2', displayName: 'Administracja Testowa', kind: 'building_administration' },
      since: '2026-09-13',
      days: 20,
      otherCount: 0,
    },
    nextDueDate: null,
    hasOverdueStage: false,
  },
  // 3: the OSD for 10 days (under the threshold of the view)
  {
    waiting: {
      waitingOn: 'party',
      party: { id: '01968f3e-0000-7000-8000-00000000ddd1', displayName: 'Stoen Operator', kind: 'distribution_system_operator' },
      since: '2026-09-23',
      days: 10,
      otherCount: 0,
    },
    nextDueDate: '2026-10-12',
    hasOverdueStage: false,
  },
  // 4: nobody, a due date
  { waiting: null, nextDueDate: '2026-10-05', hasOverdueStage: false },
  // 5: nobody, no due date
  { waiting: null, nextDueDate: null, hasOverdueStage: false },
] as const;

type MockWait = (typeof WAITS)[number];

const pln = (amountMinor: number) => ({ amountMinor, currency: 'PLN' });
/**
 * EVM-056: the column "Płatność" of the synthetic orders, in turn by `index % 5` — after the due date (3 600,00 zł, the oldest
 * instalment due on 2026-09-26), one invoiced (4 500,00 zł), all paid, nothing invoiced (twice). The state is the server's, counted
 * from the synthetic day 2026-10-03 (the clock of the server is frozen: the browser compares nothing).
 */
const PAYMENTS = [
  { payment: { state: 'overdue', invoicedCount: 1, invoicedTotal: pln(360_000), overdueTotal: pln(360_000) }, overdueSince: '2026-09-26' },
  { payment: { state: 'unpaid', invoicedCount: 1, invoicedTotal: pln(450_000), overdueTotal: pln(0) }, overdueSince: null },
  { payment: { state: 'paid', invoicedCount: 0, invoicedTotal: pln(0), overdueTotal: pln(0) }, overdueSince: null },
  { payment: { state: 'none', invoicedCount: 0, invoicedTotal: pln(0), overdueTotal: pln(0) }, overdueSince: null },
  { payment: { state: 'none', invoicedCount: 0, invoicedTotal: pln(0), overdueTotal: pln(0) }, overdueSince: null },
] as const;

/** "Najpilniejsze" of the synthetic server (ADR-0017 D9, the day 2026-10-03): the group 1–4 and its key; ties go by the identifier. */
function urgencyOf(entry: {
  status: string;
  overdueSince: string | null;
  hasOverdueStage: boolean;
  nextDueDate: string | null;
  waiting: { days: number; since: string } | null;
}): readonly [number, string] {
  if (entry.status === 'settled' || entry.status === 'cancelled') return [4, 'infinity'];
  const overdue = [entry.overdueSince, entry.hasOverdueStage ? entry.nextDueDate : null].filter((day) => day !== null).sort();
  if (overdue[0] !== undefined) return [1, overdue[0]];
  if (entry.waiting !== null && entry.waiting.days > 14) return [2, entry.waiting.since];
  if (entry.nextDueDate !== null) return [3, entry.nextDueDate];
  return [4, 'infinity'];
}

/**
 * EVM-072: the customer and the location of a synthetic order. Customers and sites alternate (even — "Jan Przykładowy", odd — "Firma
 * Testowa"; the site by `index % 4`), and every seventh order has a deleted customer (`{ deleted: true }` — no name, no identifier).
 * The type of the object and the template are what the panel "Więcej filtrów" filters by.
 */
function placeOf(customers: readonly MockCustomer[], sites: readonly MockSite[], index: number) {
  const customer = customers[index % 2];
  const site = sites[index % 4 < 2 ? 0 : 1];
  return {
    customer:
      index % 7 === 6 ? { deleted: true as const } : customer === undefined ? null : { id: customer.id, displayName: customer.displayName },
    site: site === undefined ? null : { id: site.id, city: site.city, street: site.street, buildingNumber: site.buildingNumber },
    // Not part of the item: the filters of the panel work on them.
    siteType: site?.siteType ?? '',
    templateId: INITIAL_TEMPLATES[index % 2]?.id ?? '',
  };
}

/** What the synthetic search matches: number, title, the customer and the address, without diacritics and case (like the server). */
const searchTextOf = (entry: {
  number: string;
  title: string;
  customer: { displayName?: string } | null;
  site: { city: string; street: string } | null;
}) => fold([entry.number, entry.title, entry.customer?.displayName ?? '', entry.site?.city ?? '', entry.site?.street ?? ''].join(' '));

/** A synthetic work order (EVM-017): number from 1, statuses and coordinators in turn, newest created last. */
function workOrder(index: number, waits = true, customers: readonly MockCustomer[] = [], sites: readonly MockSite[] = []) {
  const wait: MockWait = (waits ? WAITS[index % WAITS.length] : undefined) ?? WAITS[5];
  return {
    ...placeOf(customers, sites, index),
    ...wait,
    ...(PAYMENTS[index % PAYMENTS.length] ?? PAYMENTS[3]),
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    number: `ZL-2026-${String(index + 1).padStart(4, '0')}`,
    title: index % 4 === 0 ? 'Garaż — pełny proces z bardzo długim tytułem, który zawija się w komórce tabeli' : 'Dom — pełny pakiet',
    status: ORDER_STATUSES[index % ORDER_STATUSES.length] ?? 'new',
    coordinator: COORDINATORS[index % COORDINATORS.length] ?? null,
    createdAt: new Date(Date.UTC(2026, 8, 1, 8, 0) + index * 60 * MINUTE).toISOString(),
  };
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

export async function installMockApi(page: Page, session: SessionKind, origin: string): Promise<MockApi> {
  const api: MockApi = {
    seen: [],
    session,
    tokenValid: (token) => token === VALID_TOKEN,
    resetLinkValid: (token) => token === RESET_TOKEN && !resetLinkUsed,
    failNext: new Map(),
    loginMode: 'second_step',
    methods: ['passkey'],
    usedCodes: new Set(),
    credentialId: null,
    expired: false,
    sessionMinutes: { idle: 60, absolute: 720 },
    clockOffsetMs: 0,
    deadlines: null,
    loginToken: null,
    role: 'administrator',
    stepUp: 'required',
    csrf: 'csrf-active',
    auditEvents: 40,
    workOrders: 0,
    waits: true,
    customers: [
      {
        id: '01968f3e-0000-7000-8000-00000000aaa1',
        displayName: 'Jan Przykładowy',
        phone: '+48600000001',
        text: 'jan przykladowy lodz jan.przykladowy@example.com',
        kind: 'person',
        firstName: 'Jan',
        lastName: 'Przykładowy',
        email: 'jan.przykladowy@example.com',
        notes: 'Kontakt najlepiej po 16:00.',
        version: 1,
      },
      {
        id: '01968f3e-0000-7000-8000-00000000aaa2',
        displayName: 'Firma Testowa sp. z o.o.',
        phone: '+48600000002',
        text: 'firma testowa sp. z o.o. warszawa',
        kind: 'company',
        companyName: 'Firma Testowa sp. z o.o.',
        taxId: '5260250274',
        contactPersonName: 'Ewa Kontaktowa',
        postalAddress: { street: 'ul. Testowa', buildingNumber: '7', postalCode: '00-001', city: 'Warszawa' },
        version: 1,
      },
    ],
    sites: [
      {
        id: '01968f3e-0000-7000-8000-00000000bbb1',
        siteType: 'multi_family_garage',
        street: 'ul. Testowa',
        buildingNumber: '7',
        postalCode: '00-001',
        city: 'Warszawa',
        parkingSpotNumber: '15',
        garageLevel: '-1',
      },
      {
        id: '01968f3e-0000-7000-8000-00000000bbb2',
        siteType: 'single_family_house',
        street: 'ul. Przykładowa',
        buildingNumber: '2',
        postalCode: '90-001',
        city: 'Łódź',
      },
    ],
    parties: [
      {
        id: '01968f3e-0000-7000-8000-00000000ddd1',
        kind: 'distribution_system_operator',
        legalForm: 'organization',
        displayName: 'Operator Testowy',
      },
      {
        id: '01968f3e-0000-7000-8000-00000000ddd2',
        kind: 'housing_community',
        legalForm: 'organization',
        displayName: 'Wspólnota Testowa',
      },
    ],
    orders: {
      templates: INITIAL_TEMPLATES.map((entry) => ({ ...entry })),
      assignable: [
        { id: '11111111-1111-4111-8111-111111111111', displayName: DISPLAY_NAME },
        { id: '22222222-2222-4222-8222-222222222222', displayName: 'Piotr Testowy' },
      ],
      created: [],
      // The customers and sites are the lists above (the same objects: saved ones appear in both).
      customers: [],
      sites: [],
      keys: new Map(),
      parties: [],
      gone: new Set(),
      states: new Map(),
      stages: new Map(),
      transitionKeys: new Map(),
      edits: new Map(),
      editKeys: new Map(),
      notes: 'Wjazd od ul. Fikcyjnej, klucz u administratora.',
      siteEdits: new Map(),
      partyEdits: new Map(),
      otherOrders: [],
      patchKeys: new Map(),
      goneSites: new Set(),
      goneParties: new Set(),
    },
    procedureEdits: new Map(),
    unpaid: newUnpaidServer(),
    users: newUsersServer(),
    account: newAccountServer(PASSWORD),
    journal: newJournalServer(),
    dropResponseNext: new Set(),
  };
  // The server of orders reads the same customers and sites that the searches use.
  Object.assign(api.orders, { customers: api.customers, sites: api.sites, parties: api.parties });
  const customerKeys = new Map<string, string>();
  const siteKeys = new Map<string, string>();
  const partyKeys = new Map<string, string>();
  const customerPatchKeys: PatchKeys = new Map();
  let stepUpChallenge = '';
  const active = () => ({ csrf: api.csrf, role: api.role, displayName: api.account.displayName });
  /** A function call, so that the compiler does not narrow `api.session` after the branch (the session changes between requests). */
  const inActiveSession = () => api.session === 'active';
  let loginChallenge = '';
  let loginTokenUsed = false;
  let resetLinkUsed = false;
  let challenge = '';

  /** The list of work orders (`GET`) and its search (`POST`, EVM-072): the same filters, the phrase only for the search. */
  const answerWorkOrderList = (query: URLSearchParams, phrase: string | null) => {
    const statuses = query.get('status')?.split(',') ?? null;
    // EVM-034: the filters "Czekamy na", the saved view and the two sorts (the days are the ones of the synthetic data, 2026-10-03).
    const waitingOn = query.get('waitingOn');
    const waitingKind = query.get('waitingOnPartyKind');
    const longerThan = query.get('waitingLongerThanDays');
    if (longerThan !== null && !/^[1-9]\d{0,2}$/.test(longerThan)) return problem(400, 'validation_failed');
    const closed = (status: string) => status === 'settled' || status === 'cancelled';
    const matching = Array.from({ length: api.workOrders }, (_, index) => workOrder(index, api.waits, api.customers, api.sites))
      .filter((entry) => query.get('view') !== 'all_open' || !closed(entry.status))
      .filter(
        (entry) =>
          query.get('view') !== 'waiting_on_dso_over_14_days' ||
          (!closed(entry.status) && entry.waiting?.party?.kind === 'distribution_system_operator' && entry.waiting.days > 14),
      )
      // EVM-056 AC2: the payment views — open orders only.
      .filter((entry) => query.get('view') !== 'overdue_payments' || (!closed(entry.status) && entry.payment.state === 'overdue'))
      .filter(
        (entry) =>
          query.get('view') !== 'unpaid' ||
          (!closed(entry.status) && (entry.payment.state === 'overdue' || entry.payment.state === 'unpaid')),
      )
      .filter((entry) => waitingOn === null || entry.waiting?.waitingOn === waitingOn)
      .filter((entry) => waitingKind === null || entry.waiting?.party?.kind === waitingKind)
      .filter((entry) => longerThan === null || (entry.waiting !== null && entry.waiting.days > Number(longerThan)))
      .filter((entry) => query.get('view') !== 'mine' || entry.coordinator?.id === COORDINATORS[0].id)
      .filter((entry) => statuses === null || statuses.includes(entry.status))
      .filter((entry) => query.get('coordinatorId') === null || entry.coordinator?.id === query.get('coordinatorId'))
      // EVM-072 AC4: "Typ obiektu" and "Szablon" of "Więcej filtrów".
      .filter((entry) => query.get('siteType') === null || entry.siteType === query.get('siteType'))
      .filter((entry) => query.get('templateId') === null || entry.templateId === query.get('templateId'))
      // EVM-072 AC2: number, title, the customer (not a deleted one) and the address — without diacritics ("Lodz" finds "Łódź").
      .filter((entry) => phrase === null || searchTextOf(entry).includes(fold(phrase)));
    const sort = query.get('sort') ?? '-number';
    // Numbers and creation times rise together, so "newest first" is the reverse order for both keys.
    const byWait = (a: { waiting: { days: number } | null }, b: { waiting: { days: number } | null }) =>
      (b.waiting?.days ?? -1) - (a.waiting?.days ?? -1);
    const byDue = (a: { nextDueDate: string | null }, b: { nextDueDate: string | null }) =>
      (a.nextDueDate ?? '9999-12-31').localeCompare(b.nextDueDate ?? '9999-12-31');
    const byUrgency = (a: Parameters<typeof urgencyOf>[0] & { id: string }, b: Parameters<typeof urgencyOf>[0] & { id: string }) => {
      const [groupA, keyA] = urgencyOf(a);
      const [groupB, keyB] = urgencyOf(b);
      return groupA - groupB || keyA.localeCompare(keyB) || a.id.localeCompare(b.id);
    };
    const sorted =
      sort === 'urgency'
        ? matching.toSorted(byUrgency)
        : sort === 'longestWaitingSince'
          ? matching.toSorted(byWait)
          : sort === 'nextDueDate'
            ? matching.toSorted(byDue)
            : [...(sort.startsWith('-') ? matching.toReversed() : matching)];
    // The filters work on these two fields; they are not part of the item of the contract.
    const ordered: object[] = sorted.map((entry) => {
      const item: Record<string, unknown> = { ...entry };
      delete item['siteType'];
      delete item['templateId'];
      delete item['overdueSince'];
      return item;
    });
    // The orders created in this run come first (the newest number is the highest) — only in the list: a phrase and the filters of the panel are not matched by them.
    const plain = phrase === null && query.get('siteType') === null && query.get('templateId') === null;
    if (query.get('view') !== 'mine' && plain) ordered.unshift(...createdListItems(api.orders));
    const start = query.get('cursor') === null ? 0 : Number(decodeBase64Url(query.get('cursor') ?? ''));
    const limit = Number(query.get('limit') ?? '25');
    const nextCursor = start + limit < ordered.length ? Buffer.from(String(start + limit)).toString('base64url') : null;
    return ok(200, { items: ordered.slice(start, start + limit), nextCursor }, { 'Cache-Control': 'no-store' });
  };

  const answer = async (route: Route, request: Request) => {
    const url = new URL(request.url());
    const headers = await request.allHeaders();
    const key = `${request.method()} ${url.pathname}`;
    api.seen.push({ method: request.method(), url: request.url(), headers, postData: request.postData() });

    const failure = api.failNext.get(key);
    if (failure) {
      api.failNext.delete(key);
      return route.fulfill(problem(failure.status, failure.code, {}, failure.headers));
    }
    const mutation = request.method() !== 'GET';
    // `Sec-Fetch-Site` is added after Playwright's interception, so only `Origin` is visible here; the full pair is
    // checked by the API tests.
    if (mutation && headers['origin'] !== origin) return route.fulfill(problem(403, 'csrf_failed'));
    const csrfOk =
      headers['x-csrf-token'] === sessionBody(api.session === 'none' ? 'enrollment' : api.session, undefined, active()).csrfToken;
    const body = (): unknown => JSON.parse(request.postData() ?? '{}');

    // EVM-028: the own account (W-15) — the profile, the password, the removal of a method, the sessions; the mark of the full re-authentication is one-time.
    if (api.session === 'active' && url.pathname.startsWith('/api/v1/account') && mutation && !csrfOk) {
      return route.fulfill(problem(403, 'csrf_failed'));
    }
    const ownAccount =
      api.session === 'active'
        ? answerAccountRoute(api.account, {
            method: request.method(),
            pathname: url.pathname,
            body,
            role: api.role,
            email: EMAIL,
            stepUpFresh: api.stepUp === 'fresh',
          })
        : null;
    if (ownAccount !== null) return route.fulfill(ownAccount);
    // EVM-024: the resend of an invitation (W-16) — the account is anchored in the path; it needs the step-up like the invitation.
    const resend = request.method() === 'POST' ? /^\/api\/v1\/users\/([^/]+)\/invitations$/.exec(url.pathname) : null;
    if (resend !== null) {
      if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
      if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
      if (api.role !== 'administrator') return route.fulfill(problem(403, 'forbidden'));
      if (api.stepUp !== 'fresh') return route.fulfill(problem(403, 'step_up_required'));
      return route.fulfill(answerResend(api.users, resend[1] ?? ''));
    }
    // EVM-027: the five operations on an account (W-16) — role, deactivation, reactivation, end of sessions, reset of the second step.
    const accountOperation = /^\/api\/v1\/users\/([^/]+)\/(role|deactivation|reactivation|sessions|second-step-reset)$/.exec(url.pathname);
    if (accountOperation !== null && ['PUT', 'POST', 'DELETE'].includes(request.method())) {
      if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
      if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
      if (api.role !== 'administrator') return route.fulfill(problem(403, 'forbidden'));
      if (api.stepUp !== 'fresh') return route.fulfill(problem(403, 'step_up_required'));
      const input = (request.postData() ?? '') === '' ? {} : (body() as Record<string, unknown>);
      return route.fulfill(
        answerAccountOperation(
          api.users,
          (accountOperation[2] ?? 'role') as AccountOperationName,
          accountOperation[1] ?? '',
          headers['if-match'],
          input,
        ),
      );
    }
    // EVM-018: the four reads of one order (W-06) — the order is anchored in the path (a malformed id is 400, a missing or gone one 404).
    const orderRead =
      request.method() === 'GET'
        ? /^\/api\/v1\/work-orders\/([^/]+)(?:\/(scope-items|customer|site|site-orders))?$/.exec(url.pathname)
        : null;
    if (orderRead !== null) {
      if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
      const [, id = '', part = ''] = orderRead;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
        return route.fulfill(problem(400, 'validation_failed', { errors: [{ pointer: '/workOrderId', code: 'invalid_format' }] }));
      }
      return route.fulfill({
        ...answerOrderRead(api.orders, id, part as Parameters<typeof answerOrderRead>[2], api.role),
      });
    }
    // EVM-039: the details and the edit of one customer (W-14) — the customer is anchored in the path.
    const customerRead = /^\/api\/v1\/customers\/([^/]+)$/.exec(url.pathname);
    if (customerRead !== null && (request.method() === 'GET' || request.method() === 'PATCH')) {
      if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
      const id = customerRead[1] ?? '';
      if (request.method() === 'GET') return route.fulfill(answerRead(api.customers, id));
      if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
      const answer = answerPatch(
        api.customers,
        id,
        { role: api.role, ifMatch: headers['if-match'], key: headers['idempotency-key'], raw: request.postData() ?? '{}' },
        customerPatchKeys,
      );
      if (answer.status === 200 && api.dropResponseNext.delete('PATCH /api/v1/customers/:id')) return route.abort('connectionreset');
      return route.fulfill(answer);
    }
    // EVM-036: the site and the party of the dialogs "Edytuj lokalizację" and "Edytuj stronę" — each is anchored in the path.
    const location = /^\/api\/v1\/(sites|parties)\/([^/]+)$/.exec(url.pathname);
    if (location !== null && (request.method() === 'GET' || request.method() === 'PATCH')) {
      if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
      const which = location[1] === 'sites' ? 'site' : 'party';
      const id = location[2] ?? '';
      if (request.method() === 'GET') {
        return route.fulfill(answerLocationRead(which === 'site' ? siteOf(api.orders, id) : partyOf(api.orders, id), id));
      }
      if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
      return route.fulfill(
        answerLocationPatch(api.orders, which, id, {
          role: api.role,
          ifMatch: headers['if-match'],
          key: headers['idempotency-key'],
          raw: request.postData() ?? '{}',
        }),
      );
    }
    // EVM-040: one entry of the journal — the read with its ETag, the delete, the restore and the redaction (Administrator).
    const erasing = /^\/api\/v1\/work-orders\/([0-9a-f-]{36})\/timeline\/([0-9a-f-]{36})(\/restore|\/redact)?$/.exec(url.pathname);
    if (erasing !== null) {
      if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
      const verb = erasing[3];
      const operation =
        request.method() === 'GET' ? 'read' : request.method() === 'DELETE' ? 'delete' : verb === '/redact' ? 'redact' : 'restore';
      if (operation !== 'read' && !csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
      return route.fulfill(
        answerEntryErase(api.journal, api.orders, erasing[1] ?? '', erasing[2] ?? '', operation, {
          role: api.role,
          ifMatch: headers['if-match'],
          stepUpFresh: api.stepUp === 'fresh',
        }),
      );
    }
    // EVM-037: the journal of one order (the tab "Dziennik" of W-06) — the order is anchored in the path.
    const journal = /^\/api\/v1\/work-orders\/([0-9a-f-]{36})\/timeline$/.exec(url.pathname);
    if (journal !== null && (request.method() === 'GET' || request.method() === 'POST')) {
      if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
      const id = journal[1] ?? '';
      if (request.method() === 'GET') return route.fulfill(answerJournalList(api.journal, api.orders, id, url.searchParams));
      if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
      const created = answerJournalCreate(api.journal, api.orders, id, {
        role: api.role,
        userId: '11111111-1111-4111-8111-111111111111',
        key: headers['idempotency-key'],
        raw: request.postData() ?? '{}',
      });
      if (created.status === 201 && api.dropResponseNext.delete('POST /api/v1/work-orders/:id/timeline'))
        return route.abort('connectionreset');
      return route.fulfill(created);
    }
    // EVM-031: the processes of one order and the change of a stage (the section "Procesy i etapy" of W-06).
    const processes = request.method() === 'GET' ? /^\/api\/v1\/work-orders\/([0-9a-f-]{36})\/procedures$/.exec(url.pathname) : null;
    if (processes !== null) {
      if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
      return route.fulfill(answerEditedProcedures(api.orders, api.procedureEdits, processes[1] ?? ''));
    }
    // EVM-042: processes and stages added, removed and restored by hand, and the list of the deleted ones (Administrator only).
    const editing =
      /^\/api\/v1\/work-orders\/([0-9a-f-]{36})\/(procedures|procedure-stages|deleted-procedures)(?:\/([0-9a-f-]{36}))?(?:\/(stages|restore))?$/.exec(
        url.pathname,
      );
    if (editing !== null && !(request.method() === 'GET' && editing[2] === 'procedures')) {
      if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
      const [, orderId = '', area, id = '', action] = editing;
      const input = { role: api.role, ifMatch: headers['if-match'], raw: request.postData() ?? '{}' };
      const method = request.method();
      if (method === 'GET' && area === 'deleted-procedures' && id === '') {
        return route.fulfill(answerDeleted(api.orders, api.procedureEdits, orderId, api.role));
      }
      if (method !== 'GET' && !csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
      if (method === 'POST' && area === 'procedures' && id === '' && action === undefined) {
        return route.fulfill(answerCreateProcedure(api.orders, api.procedureEdits, orderId, input));
      }
      if (method === 'POST' && area === 'procedures' && action === 'stages') {
        return route.fulfill(answerCreateStage(api.orders, api.procedureEdits, orderId, id, input));
      }
      if (method === 'DELETE' && action === undefined && (area === 'procedures' || area === 'procedure-stages')) {
        return route.fulfill(
          answerDelete(api.orders, api.procedureEdits, orderId, area === 'procedures' ? 'procedure' : 'stage', id, input),
        );
      }
      if (method === 'POST' && action === 'restore') {
        return route.fulfill(
          answerRestore(api.orders, api.procedureEdits, orderId, area === 'procedures' ? 'procedure' : 'stage', id, input),
        );
      }
    }
    const stagePatch =
      request.method() === 'PATCH'
        ? /^\/api\/v1\/work-orders\/([0-9a-f-]{36})\/procedure-stages\/([0-9a-f-]{36})$/.exec(url.pathname)
        : null;
    if (stagePatch !== null) {
      if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
      if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
      return route.fulfill(
        answerStagePatch(api.orders, stagePatch[1] ?? '', stagePatch[2] ?? '', {
          role: api.role,
          ifMatch: headers['if-match'],
          raw: request.postData() ?? '{}',
        }),
      );
    }
    // EVM-032: the transition of one stage (the menu of the badge of a stage in W-06).
    const stageTransition =
      request.method() === 'POST'
        ? /^\/api\/v1\/work-orders\/([0-9a-f-]{36})\/procedure-stages\/([0-9a-f-]{36})\/transitions$/.exec(url.pathname)
        : null;
    if (stageTransition !== null) {
      if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
      if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
      return route.fulfill(
        answerStageTransition(api.orders, stageTransition[1] ?? '', stageTransition[2] ?? '', {
          role: api.role,
          ifMatch: headers['if-match'],
          raw: request.postData() ?? '{}',
        }),
      );
    }
    // EVM-035: the edit of the data of one order and of its scope (W-06 (a), (c)).
    const orderPatch = request.method() === 'PATCH' ? /^\/api\/v1\/work-orders\/([0-9a-f-]{36})$/.exec(url.pathname) : null;
    const scopeCreate = request.method() === 'POST' ? /^\/api\/v1\/work-orders\/([0-9a-f-]{36})\/scope-items$/.exec(url.pathname) : null;
    const scopeChange =
      request.method() === 'PATCH' || request.method() === 'DELETE'
        ? /^\/api\/v1\/work-orders\/([0-9a-f-]{36})\/scope-items\/([0-9a-f-]{36})$/.exec(url.pathname)
        : null;
    if (orderPatch !== null || scopeCreate !== null || scopeChange !== null) {
      if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
      if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
      const input = {
        role: api.role,
        ifMatch: headers['if-match'],
        key: headers['idempotency-key'],
        raw: request.postData() ?? '{}',
        path: url.pathname,
      };
      if (orderPatch !== null) {
        const id = orderPatch[1] ?? '';
        return route.fulfill(answerOrderPatch(api.orders, id, input, () => answerOrderRead(api.orders, id, '', api.role)));
      }
      if (scopeCreate !== null) return route.fulfill(answerScopeCreate(api.orders, scopeCreate[1] ?? '', input));
      const method = request.method() === 'DELETE' ? 'DELETE' : 'PATCH';
      return route.fulfill(answerScopeChange(api.orders, scopeChange?.[1] ?? '', scopeChange?.[2] ?? '', method, input));
    }
    // EVM-060: the deletion and the restore of a whole order (the menu `⋮` of W-06, "Przywróć" of the view "Usunięte" of W-10).
    const wholeOrder = /^\/api\/v1\/work-orders\/([0-9a-f-]{36})(\/restore)?$/.exec(url.pathname);
    if (
      wholeOrder !== null &&
      ((request.method() === 'DELETE' && wholeOrder[2] === undefined) || (request.method() === 'POST' && wholeOrder[2] !== undefined))
    ) {
      if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
      if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
      const input = { role: api.role, ifMatch: headers['if-match'] };
      return route.fulfill(
        request.method() === 'DELETE'
          ? answerOrderDelete(api.orders, wholeOrder[1] ?? '', input)
          : answerOrderRestore(api.orders, wholeOrder[1] ?? '', input),
      );
    }
    // EVM-030: the transition of one order (the status menu of W-06).
    const transition = request.method() === 'POST' ? /^\/api\/v1\/work-orders\/([0-9a-f-]{36})\/transitions$/.exec(url.pathname) : null;
    if (transition !== null) {
      if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
      if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
      return route.fulfill(
        answerTransition(api.orders, transition[1] ?? '', {
          role: api.role,
          stepUpFresh: api.stepUp === 'fresh',
          ifMatch: headers['if-match'],
          key: headers['idempotency-key'],
          raw: request.postData() ?? '{}',
          condition: (to) => paymentsCondition(api.orders, transition[1] ?? '', to),
          effect: (to) => {
            paymentsEffect(api.orders, transition[1] ?? '', to);
          },
        }),
      );
    }
    // EVM-055: the unpaid list of W-11 (every role of the office reads it).
    if (request.method() === 'GET' && url.pathname === '/api/v1/payment-milestones') {
      if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
      return route.fulfill(answerUnpaidList(api.unpaid, url.searchParams));
    }
    // EVM-055: the instalments of the twelve orders of W-11 (what the dialog reads on a `412`) and the payment of one.
    const unpaidOrder = /^\/api\/v1\/work-orders\/([0-9a-f-]{36})\/payment-milestones(?:\/([0-9a-f-]{36})\/transitions)?$/.exec(
      url.pathname,
    );
    if (unpaidOrder !== null && isUnpaidOrder(api.unpaid, unpaidOrder[1] ?? '')) {
      if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
      if (request.method() === 'GET' && unpaidOrder[2] === undefined)
        return route.fulfill(answerUnpaidOrderPayments(api.unpaid, unpaidOrder[1] ?? ''));
      if (request.method() === 'POST' && unpaidOrder[2] !== undefined) {
        if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
        return route.fulfill(
          answerUnpaidTransition(api.unpaid, unpaidOrder[1] ?? '', unpaidOrder[2], {
            role: api.role,
            ifMatch: headers['if-match'],
            raw: request.postData() ?? '{}',
          }),
        );
      }
    }
    // EVM-053: the instalments of one order — the list, "Dodaj transzę" and "Zmień kwotę" (the section "Płatności" of W-06).
    // EVM-054: also the transitions of an instalment (`…/{milestoneId}/transitions`).
    const payments = /^\/api\/v1\/work-orders\/([0-9a-f-]{36})\/payment-milestones(?:\/([0-9a-f-]{36})(\/transitions)?)?$/.exec(
      url.pathname,
    );
    if (payments !== null) {
      if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
      const [, orderId = '', milestoneId, transitions] = payments;
      if (request.method() === 'GET' && milestoneId === undefined) return route.fulfill(answerPayments(api.orders, orderId, api.role));
      if (request.method() === 'POST' && milestoneId !== undefined && transitions !== undefined) {
        if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
        return route.fulfill(
          answerPaymentTransition(api.orders, orderId, milestoneId, {
            role: api.role,
            ifMatch: headers['if-match'],
            key: headers['idempotency-key'],
            raw: request.postData() ?? '{}',
            stepUpFresh: api.stepUp === 'fresh',
          }),
        );
      }
      if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
      if (request.method() === 'POST' && milestoneId === undefined) {
        return route.fulfill(
          answerPaymentCreate(api.orders, orderId, { role: api.role, key: headers['idempotency-key'], raw: request.postData() ?? '{}' }),
        );
      }
      if (request.method() === 'PATCH' && milestoneId !== undefined) {
        return route.fulfill(
          answerPaymentPatch(api.orders, orderId, milestoneId, {
            role: api.role,
            ifMatch: headers['if-match'],
            raw: request.postData() ?? '{}',
            stepUpFresh: api.stepUp === 'fresh',
          }),
        );
      }
      // EVM-057 AC4: the soft delete of an instalment (the Administrator with a step-up).
      if (request.method() === 'DELETE' && milestoneId !== undefined && transitions === undefined) {
        return route.fulfill(
          answerPaymentDelete(api.orders, orderId, milestoneId, {
            role: api.role,
            ifMatch: headers['if-match'],
            key: headers['idempotency-key'],
            stepUpFresh: api.stepUp === 'fresh',
          }),
        );
      }
    }
    switch (key) {
      case 'GET /api/v1/auth/session':
        if (api.session !== 'none' && api.expired) {
          api.session = 'none';
          return route.fulfill(problem(401, 'session_expired'));
        }
        if (api.session === 'none') return route.fulfill(problem(401, 'unauthenticated'));
        api.deadlines ??= {
          idle: Date.now() + api.clockOffsetMs + api.sessionMinutes.idle * MINUTE,
          absolute: Date.now() + api.clockOffsetMs + api.sessionMinutes.absolute * MINUTE,
        };
        return route.fulfill(ok(200, sessionBody(api.session, api.deadlines, active())));
      case 'POST /api/v1/auth/login': {
        const { email, password } = body() as { email?: string; password?: string };
        if (email !== EMAIL || password !== PASSWORD) return route.fulfill(problem(401, 'invalid_credentials'));
        if (api.loginMode === 'mfa_enrollment') {
          api.session = 'enrollment';
          return route.fulfill(ok(200, { state: 'mfa_enrollment', csrfToken: 'csrf-enrollment' }));
        }
        api.loginToken = LOGIN_TOKEN;
        loginTokenUsed = false;
        return route.fulfill(ok(200, { state: 'second_step', loginToken: LOGIN_TOKEN, methods: api.methods }));
      }
      case 'POST /api/v1/auth/login/totp': {
        const { loginToken, code } = body() as { loginToken?: string; code?: string };
        if (loginToken !== api.loginToken || loginTokenUsed) return route.fulfill(problem(401, 'unauthenticated'));
        // Administrator in the panel has no code of the app (P1); a code is valid once.
        if (api.role === 'administrator') return route.fulfill(problem(403, 'forbidden'));
        if (code !== TOTP_CODE || api.usedCodes.has(`totp:${code}`)) return route.fulfill(problem(401, 'totp_failed'));
        api.usedCodes.add(`totp:${code}`);
        loginTokenUsed = true;
        api.session = 'active';
        api.deadlines = null;
        return route.fulfill(ok(200, { state: 'active', csrfToken: api.csrf }));
      }
      case 'POST /api/v1/auth/login/recovery-code': {
        const { loginToken, code } = body() as { loginToken?: string; code?: string };
        if (loginToken !== api.loginToken || loginTokenUsed) return route.fulfill(problem(401, 'unauthenticated'));
        if (code !== RECOVERY_CODE || api.usedCodes.has(`recovery:${code}`)) return route.fulfill(problem(401, 'recovery_code_failed'));
        api.usedCodes.add(`recovery:${code}`);
        loginTokenUsed = true;
        api.session = 'active';
        api.deadlines = null;
        return route.fulfill(ok(200, { state: 'active', csrfToken: api.csrf, remainingCodes: 9 }));
      }
      case 'POST /api/v1/account/reauthentication': {
        if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
        if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
        const proof = body() as {
          purpose?: 'second_step_change' | 'password_change';
          password?: string;
          method?: string;
          code?: string;
          credential?: { id: string; response: { clientDataJSON: string } };
        };
        if (proof.purpose !== 'second_step_change' && proof.purpose !== 'password_change')
          return route.fulfill(problem(400, 'validation_failed'));
        // The password belongs to `second_step_change` only (the form of the page carries it for the change of the password).
        if ((proof.purpose === 'second_step_change') === (proof.password === undefined))
          return route.fulfill(problem(400, 'validation_failed'));
        const passwordOk = proof.purpose === 'password_change' || proof.password === api.account.password;
        let secondOk = false;
        if (proof.method === 'totp') {
          if (api.role === 'administrator') return route.fulfill(problem(403, 'forbidden'));
          secondOk = proof.code === TOTP_CODE && !api.usedCodes.has(`totp:${proof.code}`);
          if (secondOk) api.usedCodes.add(`totp:${proof.code}`);
        } else if (proof.credential !== undefined) {
          const client = JSON.parse(decodeBase64Url(proof.credential.response.clientDataJSON)) as {
            type: string;
            challenge: string;
            origin: string;
          };
          secondOk =
            client.type === 'webauthn.get' &&
            client.challenge === stepUpChallenge &&
            client.origin === origin &&
            proof.credential.id === api.credentialId;
          stepUpChallenge = '';
        }
        // ONE answer for every factor (no oracle).
        if (!passwordOk || !secondOk) return route.fulfill(problem(401, 'reauthentication_failed'));
        api.account.mark = proof.purpose;
        return route.fulfill({ status: 204, headers: {}, body: '' });
      }
      case 'POST /api/v1/account/totp/enrolment':
        if (inActiveSession()) {
          if (api.role === 'administrator') return route.fulfill(problem(403, 'forbidden'));
          if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
          if (api.account.mark !== 'second_step_change') return route.fulfill(problem(403, 'reauthentication_required'));
          if (api.account.totp !== null) return route.fulfill(problem(409, 'mfa_already_configured'));
          return route.fulfill(
            ok(
              200,
              {
                secret: TOTP_SECRET,
                otpauthUri: `otpauth://totp/EVia%20Manager:${encodeURIComponent(EMAIL)}?secret=${TOTP_SECRET}&issuer=EVia%20Manager`,
              },
              { 'Cache-Control': 'no-store' },
            ),
          );
        }
        if (api.session !== 'enrollment') return route.fulfill(problem(api.session === 'none' ? 401 : 409, 'mfa_already_configured'));
        if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
        if (api.role === 'administrator') return route.fulfill(problem(403, 'forbidden'));
        return route.fulfill(
          ok(
            200,
            {
              secret: TOTP_SECRET,
              otpauthUri: `otpauth://totp/EVia%20Manager:${encodeURIComponent(EMAIL)}?secret=${TOTP_SECRET}&issuer=EVia%20Manager`,
            },
            { 'Cache-Control': 'no-store' },
          ),
        );
      case 'POST /api/v1/account/totp/confirm': {
        if (inActiveSession()) {
          if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
          const { code } = body() as { code?: string };
          if (code !== TOTP_CODE || api.usedCodes.has(`totp:${code}`)) return route.fulfill(problem(400, 'totp_verification_failed'));
          const refused = spendMark(api.account, 'second_step_change');
          if (refused !== null) return route.fulfill(refused);
          api.usedCodes.add(`totp:${code}`);
          api.account.totp = { addedAt: new Date().toISOString() };
          return route.fulfill(ok(200, { state: 'active', csrfToken: api.csrf }));
        }
        if (api.session !== 'enrollment') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
        if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
        const { code } = body() as { code?: string };
        if (code !== TOTP_CODE || api.usedCodes.has(`totp:${code}`)) return route.fulfill(problem(400, 'totp_verification_failed'));
        api.usedCodes.add(`totp:${code}`);
        // The confirmation opens the window of the step-up (the code has just been verified); the session is a new one.
        api.session = 'active';
        api.stepUp = 'fresh';
        api.deadlines = null;
        return route.fulfill(ok(200, { state: 'active', csrfToken: api.csrf }));
      }
      case 'POST /api/v1/account/recovery-codes':
        if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
        if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
        // EVM-028 AC5: new codes from the account — the one-time mark of the full re-authentication, no window needed.
        if (api.account.mark === 'second_step_change') {
          api.account.mark = null;
          api.account.recovery = { remaining: 10, generatedAt: new Date().toISOString() };
          return route.fulfill(ok(200, { codes: RECOVERY_CODES }, { 'Cache-Control': 'no-store' }));
        }
        if (api.stepUp !== 'fresh') return route.fulfill(problem(403, 'step_up_required'));
        return route.fulfill(ok(200, { codes: RECOVERY_CODES }, { 'Cache-Control': 'no-store' }));
      case 'POST /api/v1/auth/login/passkey/options': {
        const { loginToken } = body() as { loginToken?: string };
        if (loginToken !== api.loginToken || loginTokenUsed || api.credentialId === null)
          return route.fulfill(problem(401, 'unauthenticated'));
        loginChallenge = Buffer.from(`login-challenge-${String(api.seen.length)}-0123456789abcdef`).toString('base64url');
        return route.fulfill(
          ok(200, {
            challenge: loginChallenge,
            rpId: RP_ID,
            timeout: 300_000,
            userVerification: 'required',
            allowCredentials: [{ id: api.credentialId, type: 'public-key' }],
          }),
        );
      }
      case 'POST /api/v1/auth/login/passkey': {
        const { loginToken, credential } = body() as {
          loginToken?: string;
          credential: { id: string; response: { clientDataJSON: string } };
        };
        if (loginToken !== api.loginToken || loginTokenUsed) return route.fulfill(problem(401, 'unauthenticated'));
        const client = JSON.parse(decodeBase64Url(credential.response.clientDataJSON)) as {
          type: string;
          challenge: string;
          origin: string;
        };
        const verified =
          client.type === 'webauthn.get' &&
          client.challenge === loginChallenge &&
          client.origin === origin &&
          credential.id === api.credentialId;
        if (!verified) return route.fulfill(problem(401, 'passkey_failed'));
        loginTokenUsed = true;
        api.session = 'active';
        api.deadlines = null;
        return route.fulfill(ok(200, { state: 'active', csrfToken: 'csrf-active' }));
      }
      case 'POST /api/v1/auth/session/extend': {
        if (api.session === 'none') return route.fulfill(problem(401, 'unauthenticated'));
        if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
        if (api.deadlines === null) return route.fulfill(problem(401, 'unauthenticated'));
        // Inactivity counts from now (in the time of the tab), never beyond the absolute end.
        api.deadlines = {
          idle: Math.min(Date.now() + api.clockOffsetMs + api.sessionMinutes.idle * MINUTE, api.deadlines.absolute),
          absolute: api.deadlines.absolute,
        };
        return route.fulfill(
          ok(200, {
            idleExpiresAt: new Date(api.deadlines.idle).toISOString(),
            absoluteExpiresAt: new Date(api.deadlines.absolute).toISOString(),
          }),
        );
      }
      case 'POST /api/v1/auth/password-reset/request':
        // Always the same answer, whatever the address (EVM-025 AC1).
        return route.fulfill(ok(202, {}));
      case 'POST /api/v1/auth/password-reset/check': {
        const { token } = body() as { token?: string };
        return api.resetLinkValid(token ?? '')
          ? route.fulfill(ok(200, { email: EMAIL }))
          : route.fulfill(problem(400, 'password_reset_link_invalid'));
      }
      case 'POST /api/v1/auth/password-reset/complete': {
        const { token, password } = body() as { token?: string; password?: string };
        if (!api.resetLinkValid(token ?? '')) return route.fulfill(problem(400, 'password_reset_link_invalid'));
        const length = Array.from((password ?? '').normalize('NFC')).length;
        if (length < 15) return route.fulfill(problem(400, 'validation_failed', { errors: [{ pointer: '/password', code: 'too_short' }] }));
        if (/^password/i.test(password ?? '')) {
          return route.fulfill(problem(400, 'validation_failed', { errors: [{ pointer: '/password', code: 'too_weak' }] }));
        }
        // The password is saved, the link is spent, every session is over and none is created (AC4, AC5).
        resetLinkUsed = true;
        api.session = 'none';
        api.loginToken = LOGIN_TOKEN;
        loginTokenUsed = false;
        return route.fulfill(ok(200, { state: 'second_step', loginToken: LOGIN_TOKEN, methods: api.methods }));
      }
      case 'POST /api/v1/auth/activation/check': {
        const { token } = body() as { token?: string };
        return api.tokenValid(token ?? '')
          ? route.fulfill(ok(200, { email: EMAIL, role: 'administrator' }))
          : route.fulfill(problem(400, 'activation_link_invalid'));
      }
      case 'POST /api/v1/auth/activation/password': {
        const { token, password } = body() as { token?: string; password?: string };
        if (!api.tokenValid(token ?? '')) return route.fulfill(problem(400, 'activation_link_invalid'));
        const length = Array.from((password ?? '').normalize('NFC')).length;
        if (length < 15) return route.fulfill(problem(400, 'validation_failed', { errors: [{ pointer: '/password', code: 'too_short' }] }));
        if (/^password/i.test(password ?? '')) {
          return route.fulfill(problem(400, 'validation_failed', { errors: [{ pointer: '/password', code: 'too_weak' }] }));
        }
        api.session = 'enrollment';
        return route.fulfill(ok(200, { csrfToken: 'csrf-enrollment' }));
      }
      case 'POST /api/v1/account/passkeys/registration-options':
        if (api.session === 'none') return route.fulfill(problem(401, 'unauthenticated'));
        if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
        // EVM-028: in an active session the options are given after the full re-authentication (the mark is checked, not spent).
        if (api.session === 'active' && api.account.mark !== 'second_step_change')
          return route.fulfill(problem(403, 'reauthentication_required'));
        challenge = Buffer.from(`challenge-${String(api.seen.length)}-0123456789abcdef`).toString('base64url');
        return route.fulfill(
          ok(200, {
            rp: { id: RP_ID, name: 'EVia Manager' },
            user: { id: Buffer.from('user-handle-synthetic-0123456789').toString('base64url'), name: EMAIL, displayName: DISPLAY_NAME },
            challenge,
            pubKeyCredParams: [
              { type: 'public-key', alg: -7 },
              { type: 'public-key', alg: -257 },
            ],
            timeout: 300_000,
            authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
            attestation: 'none',
          }),
        );
      case 'POST /api/v1/account/passkeys': {
        if (api.session === 'none') return route.fulfill(problem(401, 'forbidden'));
        if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
        const { credential, name } = body() as {
          credential: { id: string; response: { clientDataJSON: string; attestationObject: string } };
          name?: string;
        };
        if (inActiveSession()) {
          // EVM-028: one more key from the account — the ceremony is checked, then the mark is spent with the registration.
          const added = JSON.parse(decodeBase64Url(credential.response.clientDataJSON)) as {
            type: string;
            challenge: string;
            origin: string;
          };
          if (!(added.type === 'webauthn.create' && added.challenge === challenge && added.origin === origin)) {
            return route.fulfill(problem(400, 'passkey_verification_failed'));
          }
          const refused = spendMark(api.account, 'second_step_change');
          if (refused !== null) return route.fulfill(refused);
          const passkey = {
            id: `22222222-2222-4222-8222-2222222222${String(10 + api.account.passkeys.length)}`,
            name: name ?? 'Klucz dostępu',
            createdAt: new Date().toISOString(),
          };
          api.account.passkeys.push(passkey);
          return route.fulfill(ok(201, { ...passkey, deviceType: 'multi_device', backedUp: true }));
        }
        if (api.session !== 'enrollment') return route.fulfill(problem(403, 'forbidden'));
        const client = JSON.parse(decodeBase64Url(credential.response.clientDataJSON)) as {
          type: string;
          challenge: string;
          origin: string;
        };
        const verified =
          client.type === 'webauthn.create' &&
          client.challenge === challenge &&
          client.origin === origin &&
          credential.response.attestationObject.length > 0;
        if (!verified) return route.fulfill(problem(400, 'passkey_verification_failed'));
        // The server stores the key of the account: the step-up and the login accept it from now on.
        api.credentialId = credential.id;
        api.session = 'active';
        return route.fulfill(
          ok(201, {
            id: '22222222-2222-4222-8222-222222222222',
            createdAt: '2026-10-06T10:00:00Z',
            deviceType: 'multi_device',
            backedUp: true,
          }),
        );
      }
      case 'POST /api/v1/auth/step-up/options': {
        if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
        if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
        stepUpChallenge = Buffer.from(`step-up-challenge-${String(api.seen.length)}-0123456789abcdef`).toString('base64url');
        return route.fulfill(
          ok(200, {
            challenge: stepUpChallenge,
            rpId: RP_ID,
            timeout: 300_000,
            userVerification: 'required',
            allowCredentials: api.credentialId === null ? [] : [{ id: api.credentialId, type: 'public-key' }],
          }),
        );
      }
      case 'POST /api/v1/auth/step-up': {
        if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
        if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
        const stepUpBody = body() as { method?: string; code?: string; credential: { id: string; response: { clientDataJSON: string } } };
        if (stepUpBody.method === 'totp') {
          // EVM-023 AC7: the code of the app (an Editor or a Read-only user; never the Administrator in the panel).
          if (api.role === 'administrator') return route.fulfill(problem(403, 'forbidden'));
          if (stepUpBody.code !== TOTP_CODE || api.usedCodes.has(`totp:${stepUpBody.code}`)) {
            return route.fulfill(problem(401, 'totp_failed'));
          }
          api.usedCodes.add(`totp:${stepUpBody.code}`);
          api.stepUp = 'fresh';
          api.csrf = 'csrf-rotated';
          return route.fulfill(ok(200, { csrfToken: api.csrf }));
        }
        const { credential } = stepUpBody;
        const client = JSON.parse(decodeBase64Url(credential.response.clientDataJSON)) as {
          type: string;
          challenge: string;
          origin: string;
        };
        const verified =
          client.type === 'webauthn.get' &&
          client.challenge === stepUpChallenge &&
          client.origin === origin &&
          credential.id === api.credentialId;
        stepUpChallenge = '';
        if (!verified) return route.fulfill(problem(401, 'passkey_failed'));
        // The session is rotated: the new token replaces the old one (the cookie of the old session is dead on the real server).
        api.stepUp = 'fresh';
        api.csrf = 'csrf-rotated';
        return route.fulfill(ok(200, { csrfToken: api.csrf }));
      }
      case 'GET /api/v1/users': {
        if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
        if (api.role !== 'administrator') return route.fulfill(problem(403, 'forbidden'));
        return route.fulfill(answerUserList(api.users, url.searchParams));
      }
      case 'POST /api/v1/users': {
        if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
        if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
        if (api.role !== 'administrator') return route.fulfill(problem(403, 'forbidden'));
        if (api.stepUp !== 'fresh') return route.fulfill(problem(403, 'step_up_required'));
        const invited = answerInvite(api.users, body() as Record<string, unknown>, headers['idempotency-key']);
        // The answer is lost after the server has done the work: the retry with the same key must not make a second account.
        if (invited.status === 201 && api.dropResponseNext.delete(key)) return route.abort('connectionreset');
        return route.fulfill(invited);
      }
      case 'GET /api/v1/audit/events': {
        if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
        if (api.role !== 'administrator') return route.fulfill(problem(403, 'forbidden'));
        if (api.stepUp !== 'fresh') return route.fulfill(problem(403, 'step_up_required'));
        const query = url.searchParams;
        const matching = Array.from({ length: api.auditEvents }, (_, index) => auditEvent(index)).filter(
          (entry) =>
            (query.get('action') === null || entry.action === query.get('action')) &&
            (query.get('outcome') === null || entry.outcome === query.get('outcome')),
        );
        const start = query.get('cursor') === null ? 0 : Number(decodeBase64Url(query.get('cursor') ?? ''));
        const limit = Number(query.get('limit') ?? '50');
        const nextCursor = start + limit < matching.length ? Buffer.from(String(start + limit)).toString('base64url') : null;
        return route.fulfill(ok(200, { items: matching.slice(start, start + limit), nextCursor }));
      }
      case 'GET /api/v1/work-orders': {
        if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
        const query = url.searchParams;
        // EVM-060: the view "Usunięte" is the Administrator's.
        if (query.get('view') === 'deleted') {
          if (api.role !== 'administrator') return route.fulfill(problem(403, 'forbidden'));
          return route.fulfill(ok(200, { items: deletedListItems(api.orders), nextCursor: null }));
        }
        // EVM-039: "Historia zleceń" of a customer — the orders created in this run for that customer, newest first.
        const ofCustomer = query.get('customerId');
        if (ofCustomer !== null) return route.fulfill(ok(200, { items: createdListItems(api.orders, ofCustomer), nextCursor: null }));
        return route.fulfill(answerWorkOrderList(query, null));
      }
      case 'POST /api/v1/work-orders/search': {
        if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
        if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
        // EVM-072: the phrase is in the body (never in the address); the filters are the ones of the list, the cursor is in the body too.
        const input = body() as Record<string, unknown>;
        const phrase = typeof input['query'] === 'string' ? input['query'].normalize('NFC').trim() : '';
        if (Array.from(phrase).length < 3) {
          return route.fulfill(problem(400, 'validation_failed', { errors: [{ pointer: '/query', code: 'too_short' }] }));
        }
        const query = new URLSearchParams();
        for (const [name, value] of Object.entries(input)) {
          if (name === 'query' || value === undefined || value === null) continue;
          if (Array.isArray(value)) query.set(name, value.join(','));
          else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') query.set(name, String(value));
        }
        return route.fulfill(answerWorkOrderList(query, phrase));
      }
      case 'GET /api/v1/customers': {
        if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
        return route.fulfill(answerList(api.customers, url.searchParams));
      }
      case 'POST /api/v1/customers/search': {
        if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
        if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
        return route.fulfill(answerSearch(api.customers, request.postData() ?? '{}'));
      }
      case 'POST /api/v1/customers': {
        if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
        if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
        if (api.role === 'read_only') return route.fulfill(problem(403, 'forbidden'));
        const input = body() as {
          id: string;
          kind: 'person' | 'company';
          firstName?: string;
          lastName?: string;
          companyName?: string;
          phone?: string;
          email?: string;
        };
        const idempotencyKey = headers['idempotency-key'];
        const hash = request.postData() ?? '';
        if (idempotencyKey !== undefined) {
          const seen = customerKeys.get(idempotencyKey);
          if (seen !== undefined && seen !== hash) return route.fulfill(problem(422, 'idempotency_mismatch'));
          const replayed = seen === undefined ? undefined : api.customers.find((entry) => entry.id === input.id);
          if (replayed !== undefined) {
            return route.fulfill(
              ok(
                201,
                { ...input, phone: replayed.phone, displayName: replayed.displayName, version: 1 },
                { 'Idempotent-Replayed': 'true', ETag: '"1"' },
              ),
            );
          }
        }
        if (api.customers.some((entry) => entry.id === input.id)) return route.fulfill(problem(409, 'id_conflict'));
        const errors: Array<{ pointer: string; code: string }> = [];
        const person = input.kind === 'person';
        if (person && !input.firstName) errors.push({ pointer: '/firstName', code: 'required' });
        if (person && !input.lastName) errors.push({ pointer: '/lastName', code: 'required' });
        if (!person && !input.companyName) errors.push({ pointer: '/companyName', code: 'required' });
        const phone = e164(input.phone ?? '');
        if (phone === null) errors.push({ pointer: '/phone', code: 'invalid_format' });
        if (errors.length > 0 || phone === null) return route.fulfill(problem(400, 'validation_failed', { errors }));
        const displayName = person ? `${input.firstName ?? ''} ${input.lastName ?? ''}` : (input.companyName ?? '');
        api.customers.push({
          id: input.id,
          displayName,
          phone,
          text: fold(`${displayName} ${input.email ?? ''}`),
          kind: input.kind,
          ...(input.firstName === undefined ? {} : { firstName: input.firstName }),
          ...(input.lastName === undefined ? {} : { lastName: input.lastName }),
          ...(input.companyName === undefined ? {} : { companyName: input.companyName }),
          ...(input.email === undefined ? {} : { email: input.email }),
          version: 1,
        });
        if (idempotencyKey !== undefined) customerKeys.set(idempotencyKey, hash);
        if (api.dropResponseNext.delete(key)) return route.abort('connectionreset');
        return route.fulfill(ok(201, { ...input, phone, displayName, version: 1 }, { ETag: '"1"' }));
      }
      case 'POST /api/v1/sites/search': {
        if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
        if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
        const phrase = ((body() as { query?: string }).query ?? '').normalize('NFC').trim();
        if (Array.from(phrase).length < 3) {
          return route.fulfill(problem(400, 'validation_failed', { errors: [{ pointer: '/query', code: 'too_short' }] }));
        }
        const items = api.sites
          .filter((entry) =>
            fold(`${entry.street} ${entry.buildingNumber} ${entry.postalCode} ${entry.city} ${entry.parkingSpotNumber ?? ''}`).includes(
              fold(phrase),
            ),
          )
          .slice(0, 20);
        return route.fulfill(ok(200, { items, nextCursor: null }, { 'Cache-Control': 'no-store' }));
      }
      case 'POST /api/v1/sites': {
        if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
        if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
        if (api.role === 'read_only') return route.fulfill(problem(403, 'forbidden'));
        const input = body() as MockSite & {
          distributionSystemOperatorPartyId?: string;
          managerPartyId?: string;
          connectionPowerKw?: number;
        };
        const idempotencyKey = headers['idempotency-key'];
        const hash = request.postData() ?? '';
        if (idempotencyKey !== undefined) {
          const seen = siteKeys.get(idempotencyKey);
          if (seen !== undefined && seen !== hash) return route.fulfill(problem(422, 'idempotency_mismatch'));
          if (seen !== undefined && api.sites.some((entry) => entry.id === input.id)) {
            return route.fulfill(ok(201, { ...input, version: 1 }, { 'Idempotent-Replayed': 'true', ETag: '"1"' }));
          }
        }
        if (api.sites.some((entry) => entry.id === input.id)) return route.fulfill(problem(409, 'id_conflict'));
        const errors: Array<{ pointer: string; code: string }> = [];
        if (!/^\d{2}-\d{3}$/.test(input.postalCode)) errors.push({ pointer: '/postalCode', code: 'invalid_format' });
        if (input.connectionPowerKw !== undefined && !(input.connectionPowerKw > 0 && input.connectionPowerKw <= 1000)) {
          errors.push({ pointer: '/connectionPowerKw', code: 'out_of_range' });
        }
        const checks: Array<[string, string | undefined, readonly string[]]> = [
          ['/distributionSystemOperatorPartyId', input.distributionSystemOperatorPartyId, ['distribution_system_operator']],
          ['/managerPartyId', input.managerPartyId, MANAGER_KINDS],
        ];
        for (const [pointer, id, kinds] of checks) {
          if (id === undefined) continue;
          const party = api.parties.find((entry) => entry.id === id);
          if (party === undefined) errors.push({ pointer, code: 'unknown_party' });
          else if (!kinds.includes(party.kind)) errors.push({ pointer, code: 'wrong_party_kind' });
        }
        if (errors.length > 0) return route.fulfill(problem(400, 'validation_failed', { errors }));
        api.sites.push({
          id: input.id,
          siteType: input.siteType,
          street: input.street,
          buildingNumber: input.buildingNumber,
          postalCode: input.postalCode,
          city: input.city,
          ...(input.apartmentNumber === undefined ? {} : { apartmentNumber: input.apartmentNumber }),
          ...(input.parkingSpotNumber === undefined ? {} : { parkingSpotNumber: input.parkingSpotNumber }),
          ...(input.garageLevel === undefined ? {} : { garageLevel: input.garageLevel }),
        });
        if (idempotencyKey !== undefined) siteKeys.set(idempotencyKey, hash);
        if (api.dropResponseNext.delete(key)) return route.abort('connectionreset');
        return route.fulfill(ok(201, { ...input, version: 1 }, { ETag: '"1"' }));
      }
      case 'POST /api/v1/parties/search': {
        if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
        if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
        const { query, kinds } = body() as { query?: string; kinds?: string[] };
        const phrase = (query ?? '').normalize('NFC').trim();
        if (Array.from(phrase).length < 3) {
          return route.fulfill(problem(400, 'validation_failed', { errors: [{ pointer: '/query', code: 'too_short' }] }));
        }
        const items = api.parties
          .filter((entry) => (kinds === undefined || kinds.includes(entry.kind)) && fold(entry.displayName).includes(fold(phrase)))
          .slice(0, 20);
        return route.fulfill(ok(200, { items, nextCursor: null }, { 'Cache-Control': 'no-store' }));
      }
      case 'POST /api/v1/parties': {
        if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
        if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
        if (api.role === 'read_only') return route.fulfill(problem(403, 'forbidden'));
        const input = body() as MockParty & { phone?: string };
        const idempotencyKey = headers['idempotency-key'];
        const hash = request.postData() ?? '';
        if (idempotencyKey !== undefined) {
          const seen = partyKeys.get(idempotencyKey);
          if (seen !== undefined && seen !== hash) return route.fulfill(problem(422, 'idempotency_mismatch'));
          if (seen !== undefined && api.parties.some((entry) => entry.id === input.id)) {
            return route.fulfill(ok(201, { ...input, version: 1 }, { 'Idempotent-Replayed': 'true', ETag: '"1"' }));
          }
        }
        if (api.parties.some((entry) => entry.id === input.id)) return route.fulfill(problem(409, 'id_conflict'));
        const errors: Array<{ pointer: string; code: string }> = [];
        if (!input.displayName) errors.push({ pointer: '/displayName', code: 'required' });
        const phone = input.phone === undefined ? undefined : e164(input.phone);
        if (input.phone !== undefined && phone === null) errors.push({ pointer: '/phone', code: 'invalid_format' });
        if (errors.length > 0) return route.fulfill(problem(400, 'validation_failed', { errors }));
        api.parties.push({ id: input.id, kind: input.kind, legalForm: input.legalForm, displayName: input.displayName });
        if (idempotencyKey !== undefined) partyKeys.set(idempotencyKey, hash);
        if (api.dropResponseNext.delete(key)) return route.abort('connectionreset');
        return route.fulfill(ok(201, { ...input, version: 1 }, { ETag: '"1"' }));
      }
      case 'GET /api/v1/catalog/service-items':
      case 'GET /api/v1/catalog/procedure-templates': {
        if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
        return route.fulfill(key.endsWith('service-items') ? answerCatalogItems() : answerCatalogProcedures());
      }
      case 'GET /api/v1/catalog/work-order-templates':
      case 'GET /api/v1/users/assignable': {
        if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
        if (key.endsWith('assignable') && api.role === 'read_only') return route.fulfill(problem(403, 'forbidden'));
        return route.fulfill(key.endsWith('assignable') ? answerAssignable(api.orders) : answerTemplates(api.orders));
      }
      case 'POST /api/v1/work-orders': {
        if (api.session !== 'active') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
        if (api.role === 'read_only') return route.fulfill(problem(403, 'forbidden'));
        if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
        const result = answerCreate(
          api.orders,
          body() as Parameters<typeof answerCreate>[1],
          headers['idempotency-key'],
          request.postData() ?? '',
          sessionBody('active', undefined, active()).user.id,
          api.dropResponseNext.delete(key),
        );
        return result === 'abort' ? route.abort('connectionreset') : route.fulfill(result);
      }
      case 'POST /api/v1/auth/logout':
        if (api.session === 'none') return route.fulfill(problem(401, 'session_revoked'));
        if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
        api.session = 'none';
        return route.fulfill({ status: 204, headers: { 'Clear-Site-Data': '"cache", "storage"' } });
      default:
        return route.fulfill(problem(404, 'not_found'));
    }
  };

  await page.route('**/api/**', answer);
  return api;
}
