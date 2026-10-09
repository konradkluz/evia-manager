/**
 * The logic of the seed with fake use cases (EVM-077 AC7): what it creates, what it leaves alone, how it reports a refusal.
 * The real use cases run in test/integration/dev-environment.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { ProblemException, type ProblemCode } from '../../src/platform/http/problem.ts';
import { CUSTOMERS, ORDERS, PARTIES, PATH, SITES } from '../../dev/seed/data.ts';
import { NO_SESSION, seedDemoData, seedPrincipal, type SeedServices } from '../../dev/seed/run.ts';

const NOW = new Date('2026-10-09T08:00:00Z');
const context = { origin: 'cli', traceId: 'a'.repeat(32) } as const;
const principal = seedPrincipal('0190a1b2-0000-7000-8000-00000000a001', NOW);
const TOTAL = PARTIES.length + CUSTOMERS.length + SITES.length + ORDERS.length;

interface Fakes {
  readonly services: SeedServices;
  readonly created: Record<string, unknown[]>;
  readonly transitions: Array<{ id: string; to: string; ifMatch: string }>;
}

/** Fake use cases over a set of identifiers that "exist": a known id answers `id_conflict`, like the real ones. */
function fakes(existing: ReadonlySet<string> = new Set(), refuse: Partial<Record<string, ProblemCode>> = {}): Fakes {
  const created: Record<string, unknown[]> = { parties: [], customers: [], sites: [], orders: [] };
  const transitions: Fakes['transitions'] = [];
  const make = (kind: string) => (_principal: unknown, body: unknown) => {
    const id = (body as { id: string }).id;
    if (refuse[kind] !== undefined)
      return Promise.reject(new ProblemException(refuse[kind], { errors: [{ pointer: '/phone', code: 'invalid_format' }] }));
    if (existing.has(id)) return Promise.reject(new ProblemException('id_conflict'));
    created[kind]?.push(body);
    return Promise.resolve({ workOrder: { id, version: 1 } });
  };
  const services: SeedServices = {
    parties: { create: make('parties') },
    customers: { create: make('customers') },
    sites: { create: make('sites') },
    orders: { create: make('orders') },
    transitions: {
      transition: (_principal, params, ifMatch, body) => {
        transitions.push({ id: (params as { workOrderId: string }).workOrderId, to: (body as { to: string }).to, ifMatch });
        return Promise.resolve({ workOrder: { version: Number(ifMatch.replaceAll('"', '')) + 1 } });
      },
    },
  };
  return { services, created, transitions };
}

describe('seed principal (EVM-077 AC7)', () => {
  it('EVM-077 AC7: the author is the active Administrator; there is no session, and the audit says so with the nil UUID', () => {
    expect(principal).toMatchObject({ userId: '0190a1b2-0000-7000-8000-00000000a001', role: 'administrator', sessionId: NO_SESSION });
    expect(NO_SESSION).toBe('00000000-0000-0000-0000-000000000000');
    expect(principal.passkeyAuthenticatedAt).toBeNull();
  });
});

describe('demo data seed (EVM-077 AC7)', () => {
  it('EVM-077 AC7: creates everything once, in an order that satisfies the references, and walks each order to its status through transitions', async () => {
    const { services, created, transitions } = fakes();
    const counts = await seedDemoData(services, principal, ['t1', 't2'], context);
    expect(counts).toEqual({ created: TOTAL, existing: 0 });
    expect(created['parties']).toHaveLength(PARTIES.length);
    expect(created['orders']).toHaveLength(ORDERS.length);
    const walked = transitions.filter((step) => step.id === ORDERS[3]?.id).map((step) => step.to);
    expect(walked).toEqual([...PATH['completed']]);
    // the version of each step is the version returned by the previous one (If-Match)
    expect(transitions.filter((step) => step.id === ORDERS[3]?.id).map((step) => step.ifMatch)).toEqual(['"1"', '"2"', '"3"']);
    expect(transitions.filter((step) => step.id === ORDERS[0]?.id)).toEqual([]); // a new order stays new
    const first = created['orders']?.[0] as { templateId: string };
    expect(first.templateId).toBe('t1');
  });

  it('EVM-077 AC7: a repeat counts what exists, creates nothing and does not move an order again', async () => {
    const everything = new Set([...PARTIES, ...CUSTOMERS, ...SITES, ...ORDERS].map((record) => record.id));
    const { services, created, transitions } = fakes(everything);
    expect(await seedDemoData(services, principal, ['t1'], context)).toEqual({ created: 0, existing: TOTAL });
    expect(Object.values(created).flat()).toEqual([]);
    expect(transitions).toEqual([]);
  });

  it('EVM-077 AC7: a partly present set is completed — only the missing records are created', async () => {
    const some = new Set([CUSTOMERS[0].id, ORDERS[1]?.id ?? '']);
    const { services, created, transitions } = fakes(some);
    expect(await seedDemoData(services, principal, [], context)).toEqual({ created: TOTAL - 2, existing: 2 });
    expect(created['customers']).toHaveLength(CUSTOMERS.length - 1);
    expect(transitions.some((step) => step.id === ORDERS[1]?.id)).toBe(false);
    // without templates the orders are empty (templateId null), as the domain allows
    expect((created['orders']?.[0] as { templateId: unknown }).templateId).toBeNull();
  });

  it('EVM-077 AC7: a refusal of the domain is reported by its code and pointers only — no value of the data', async () => {
    const error = await seedDemoData(fakes(new Set(), { customers: 'validation_failed' }).services, principal, [], context).catch(
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('demo data: customer refused (validation_failed /phone:invalid_format)');
    const plain = await seedDemoData(fakes(new Set(), { sites: 'forbidden' }).services, principal, [], context).catch(
      (e: unknown) => e as Error,
    );
    expect((plain as Error).message).toBe('demo data: site refused (forbidden /phone:invalid_format)');
  });

  it('EVM-077 AC7: an unexpected error is reported without its message, and a failing transition names its target', async () => {
    const services: SeedServices = {
      ...fakes().services,
      parties: { create: () => Promise.reject(new Error('connection to 10.0.0.1 with secret-pass failed')) },
    };
    const unexpected = await seedDemoData(services, principal, [], context).catch((e: unknown) => e as Error);
    expect((unexpected as Error).message).toBe('demo data: party failed');
    const refusing: SeedServices = {
      ...fakes().services,
      transitions: { transition: () => Promise.reject(new ProblemException('invalid_state_transition')) },
    };
    const failed = await seedDemoData(refusing, principal, [], context).catch((e: unknown) => e as Error);
    expect((failed as Error).message).toBe('demo data: transition to accepted refused (invalid_state_transition)');
  });
});
