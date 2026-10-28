/**
 * What the integration tests of the deletion, the restoration and the anonymization of a customer share (EVM-041): the application with the
 * in-memory register of deletions, a browser per role, a customer with synthetic personal data (the CANARIES: a test looks for them in the
 * audit trail, the logs, the register and the problems), the orders of a customer and a few reads. A TEST helper outside `src`; everything is
 * synthetic.
 */
import { sql } from 'kysely';
import { DELETION_REGISTER } from '../../src/platform/deletion-register/deletion-register.ts';
import { InMemoryDeletionRegister } from '../../src/platform/deletion-register/in-memory-deletion-register.ts';
import type { WorkOrderStatus } from '../../src/modules/work-orders/domain/work-order-status.ts';
import { CLOCK } from '../../src/platform/tokens.ts';
import { PANEL_ORIGIN } from './app.ts';
import { insertCustomer, type CustomerSpec } from './customer-fixtures.ts';
import { createIdentityApp, type IdentityApp } from './identity-app.ts';
import { createSession, createUser, type Role } from './identity-fixtures.ts';
import { PanelClient } from './panel-client.ts';
import { insertWorkOrders } from './work-order-fixtures.ts';

/** 2026-10-28 12:00 Europe/Warsaw (CET). */
export const NOW = '2026-10-28T11:00:00.000Z';
export const CUSTOMERS = '/api/v1/customers';

/** Personal data that must be found where it belongs and nowhere else. */
export const CANARY = {
  firstName: 'Zdzisław',
  lastName: 'Kanarkowski',
  phone: '+48601999888',
  phoneDigits: '601999888',
  email: 'kanarek.pii@example.invalid',
  city: 'Kanarowo',
  notes: 'CANARY-NOTATKA-NIE-DO-LOGOW',
  company: 'Kanarkowa Firma sp. z o.o.',
  taxId: '5260250274',
} as const;
export const CANARY_VALUES = [
  CANARY.firstName,
  CANARY.lastName,
  CANARY.phone,
  CANARY.phoneDigits,
  CANARY.email,
  CANARY.city,
  CANARY.notes,
  CANARY.company,
  CANARY.taxId,
];

export interface ErasureApp {
  readonly current: IdentityApp;
  /** the in-memory register the application writes to */
  readonly register: () => InMemoryDeletionRegister;
}

export async function startErasureApp(): Promise<ErasureApp> {
  let register: InMemoryDeletionRegister | undefined;
  const current = await createIdentityApp({
    now: NOW,
    configure: (builder) =>
      builder.overrideProvider(DELETION_REGISTER).useFactory({
        inject: [CLOCK],
        factory: (clock: IdentityApp['clock']) => {
          register = new InMemoryDeletionRegister(clock);
          return register;
        },
      }),
  });
  return {
    current,
    register: () => {
      if (register === undefined) throw new Error('the register was not created');
      return register;
    },
  };
}

export interface Browser {
  readonly userId: string;
  readonly panel: PanelClient;
}

export async function signInTo(
  current: IdentityApp,
  role: Role,
  options: { fresh?: boolean; channel?: 'web' | 'mobile' } = {},
): Promise<Browser> {
  const admin = current.database.admin;
  const user = await createUser(admin, current.clock, { role });
  const session = await createSession(admin, current.clock, user, {
    ...(options.channel === undefined ? {} : { channel: options.channel }),
    ...(options.fresh === true ? { passkeyAuthenticatedAt: current.clock.now() } : {}),
  });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}

export const tag = (version: number): string => `"${version}"`;
export const codeOf = (body: unknown): string | undefined => (body as { code?: string }).code;

/** A customer with the canary data (a person unless `kind` says otherwise); returns its id. */
export function canaryCustomer(current: IdentityApp, spec: CustomerSpec = {}): Promise<string> {
  return insertCustomer(current.database.admin, {
    firstName: CANARY.firstName,
    lastName: CANARY.lastName,
    phone: CANARY.phone,
    email: CANARY.email,
    city: CANARY.city,
    notes: CANARY.notes,
    ...spec,
  });
}

let numbering = 0;
/** An order of the customer in the status (the numbers never repeat in a run); returns its id. */
export async function orderOf(
  current: IdentityApp,
  customerId: string,
  status: WorkOrderStatus,
  options: { deleted?: boolean; title?: string } = {},
): Promise<string> {
  numbering += 1;
  const ids = await insertWorkOrders(current.database.admin, [
    {
      number: `ZL-8${String(numbering).padStart(3, '0')}-0001`,
      customerId,
      status,
      ...(options.title === undefined ? {} : { title: options.title }),
      ...(options.deleted === true ? { deletedAt: new Date(NOW) } : {}),
    },
  ]);
  return [...ids.values()][0] ?? '';
}

export interface CustomerRowState {
  version: number;
  deleted_at: Date | null;
  deleted_by: string | null;
  anonymized_at: Date | null;
  anonymized_by: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  tax_id: string | null;
  phone: string;
  email: string | null;
  city: string | null;
  notes: string | null;
  display_name: string;
  search_text: string;
}

export async function rowOf(current: IdentityApp, id: string): Promise<CustomerRowState | undefined> {
  const { rows } = await sql<CustomerRowState>`
    select version, deleted_at, deleted_by, anonymized_at, anonymized_by, first_name, last_name, company_name, tax_id, phone, email, city,
           notes, display_name, search_text
    from customers.customers where id = ${id}`.execute(current.database.admin);
  return rows[0];
}

export async function auditOf(
  current: IdentityApp,
  objectId: string,
): Promise<Array<{ action: string; outcome: string; actor_user_id: string | null }>> {
  const { rows } = await sql<{ action: string; outcome: string; actor_user_id: string | null }>`
    select action, outcome, actor_user_id from audit.events where object_id = ${objectId} and action like 'customer.%' order by occurred_at, id`.execute(
    current.database.admin,
  );
  return rows;
}

/** Every audit row as one text (the canaries must not be in it). */
export async function auditText(current: IdentityApp): Promise<string> {
  const { rows } = await sql<{ t: string }>`select coalesce(string_agg(to_jsonb(e)::text, ' '), '') as t from audit.events e`.execute(
    current.database.admin,
  );
  return rows[0]?.t ?? '';
}
