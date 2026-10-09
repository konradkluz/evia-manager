/**
 * Writes the demo data through the use cases of the domain (EVM-077 AC7): the same validation, rules, audit events and
 * transitions as the panel, with the active Administrator as the author — no direct INSERT, no own status writing. The records
 * have fixed identifiers, so a repeat meets `409 id_conflict` and counts the record as existing without touching it (a record
 * entered by hand keeps its content; an order already in the system is not moved again). Only counts are reported.
 */
import { ProblemException } from '../../src/platform/http/problem.ts';
import type { EventContext } from '../../src/platform/events/event-bus.ts';
import type { Principal } from '../../src/platform/http/principal.ts';
import { CUSTOMERS, ORDERS, PARTIES, PATH, SITES } from './data.ts';

type Create = (principal: Principal, body: unknown, key: undefined, context: EventContext) => Promise<unknown>;

export interface SeedServices {
  readonly parties: { create: Create };
  readonly customers: { create: Create };
  readonly sites: { create: Create };
  readonly orders: { create(...args: Parameters<Create>): Promise<{ workOrder: { id: string; version: number } }> };
  readonly transitions: {
    transition(
      principal: Principal,
      params: unknown,
      ifMatch: string,
      body: unknown,
      key: undefined,
      context: EventContext,
    ): Promise<{ workOrder: { version: number } }>;
  };
}

export interface SeedCounts {
  readonly created: number;
  readonly existing: number;
}

/** A seed has no session: the nil UUID in the audit record says so (it is not the identifier of any session). */
export const NO_SESSION = '00000000-0000-0000-0000-000000000000';

/** The principal of the active Administrator for the use cases (the guard of the HTTP layer is not involved: nothing here is a request). */
export function seedPrincipal(userId: string, now: Date): Principal {
  return {
    userId,
    role: 'administrator',
    channel: 'web',
    sessionId: NO_SESSION,
    state: 'active',
    csrfToken: '',
    passkeyAuthenticatedAt: null,
    lastSeenAt: now,
    idleExpiresAt: now,
    absoluteExpiresAt: now,
  };
}

function failure(label: string, error: unknown): Error {
  if (error instanceof ProblemException) {
    const errors = (error.extras as { errors?: ReadonlyArray<{ pointer: string; code: string }> }).errors ?? [];
    const details = errors.map((item) => `${item.pointer}:${item.code}`).join(',');
    return new Error(`demo data: ${label} refused (${error.code}${details === '' ? '' : ` ${details}`})`);
  }
  return new Error(`demo data: ${label} failed`);
}

export async function seedDemoData(
  services: SeedServices,
  principal: Principal,
  templateIds: readonly string[],
  context: EventContext,
): Promise<SeedCounts> {
  let created = 0;
  let existing = 0;

  /** @returns true when the record was created by this run */
  const attempt = async (label: string, run: () => Promise<unknown>): Promise<boolean> => {
    try {
      await run();
      created += 1;
      return true;
    } catch (error) {
      if (error instanceof ProblemException && error.code === 'id_conflict') {
        existing += 1;
        return false;
      }
      throw failure(label, error);
    }
  };

  for (const party of PARTIES) await attempt('party', () => services.parties.create(principal, party, undefined, context));
  for (const customer of CUSTOMERS) await attempt('customer', () => services.customers.create(principal, customer, undefined, context));
  for (const site of SITES) await attempt('site', () => services.sites.create(principal, site, undefined, context));

  for (const order of ORDERS) {
    const templateId = templateIds.length === 0 ? null : (templateIds[order.template % templateIds.length] ?? null);
    let version = 0;
    const wasCreated = await attempt('work order', async () => {
      const result = await services.orders.create(
        principal,
        {
          id: order.id,
          customerId: CUSTOMERS[order.customer]?.id,
          siteId: SITES[order.site]?.id,
          templateId,
          title: order.title,
        },
        undefined,
        context,
      );
      version = result.workOrder.version;
    });
    if (!wasCreated) continue;
    for (const to of PATH[order.status]) {
      try {
        const result = await services.transitions.transition(
          principal,
          { workOrderId: order.id },
          `"${version}"`,
          { to },
          undefined,
          context,
        );
        version = result.workOrder.version;
      } catch (error) {
        throw failure(`transition to ${to}`, error);
      }
    }
  }
  return { created, existing };
}
