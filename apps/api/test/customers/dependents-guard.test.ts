import type { Kysely } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import { assertNoOpenDependents, customerEvent } from '../../src/modules/customers/application/customer-command-support.ts';
import {
  CustomerDependentsRegistry,
  WORK_ORDERS_GUARD,
  type CustomerDependentsGuard,
} from '../../src/modules/customers/dependents-guard.ts';
import { ProblemException } from '../../src/platform/http/problem.ts';
import type { Database } from '../../src/platform/database/database.ts';

const TX = { tx: true } as unknown as Kysely<Database>;
const CUSTOMER = '0199aaaa-0000-7000-8000-000000000001';

const guard = (name: string, answer: () => unknown, order = 100): CustomerDependentsGuard => ({
  name,
  order,
  countOpen: vi.fn(() => Promise.resolve(answer() as number)),
});

const problemOf = async (action: Promise<unknown>): Promise<ProblemException> => {
  const error: unknown = await action.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ProblemException);
  return error as ProblemException;
};

describe('the port of the dependents of a customer (EVM-041 AC2; SR-AUTHZ-10, SR-ERR-01)', () => {
  it('EVM-041 AC2 the registry answers per implementation, in the order (ascending order, then name)', async () => {
    const registry = new CustomerDependentsRegistry();
    registry.register(guard('zeta', () => 1, 50));
    registry.register(guard('alpha', () => 0, 50));
    registry.register(guard(WORK_ORDERS_GUARD, () => 3, 10));
    expect(registry.names()).toEqual([WORK_ORDERS_GUARD, 'alpha', 'zeta']);
    expect(await registry.countAll(TX, CUSTOMER)).toEqual([
      { name: WORK_ORDERS_GUARD, open: 3 },
      { name: 'alpha', open: 0 },
      { name: 'zeta', open: 1 },
    ]);
  });

  it('EVM-041 AC2 two implementations cannot share a name', () => {
    const registry = new CustomerDependentsRegistry();
    registry.register(guard('a', () => 0));
    expect(() => {
      registry.register(guard('a', () => 0));
    }).toThrow(/already registered/);
  });

  it('EVM-041 AC2 fail closed: an empty registry is an error, never a permission', async () => {
    await expect(new CustomerDependentsRegistry().countAll(TX, CUSTOMER)).rejects.toThrow(/no customer dependents guard/);
    await expect(assertNoOpenDependents(new CustomerDependentsRegistry(), TX, CUSTOMER)).rejects.toThrow(Error);
  });

  it('EVM-041 AC2 fail closed: an implementation that throws makes the whole command an error', async () => {
    const registry = new CustomerDependentsRegistry();
    registry.register({ name: 'broken', order: 1, countOpen: () => Promise.reject(new Error('boom')) });
    await expect(assertNoOpenDependents(registry, TX, CUSTOMER)).rejects.toThrow('boom');
  });

  it.each([[undefined], [null], ['2'], [-1], [1.5], [Number.NaN], [Infinity]])(
    'EVM-041 AC2 fail closed: an answer that is not a non-negative integer (%s) is an error',
    async (answer) => {
      const registry = new CustomerDependentsRegistry();
      registry.register(guard('odd', () => answer));
      await expect(registry.countAll(TX, CUSTOMER)).rejects.toThrow(/invalid count/);
    },
  );

  it('EVM-041 AC2 no open dependent is a permission (nothing is thrown)', async () => {
    const registry = new CustomerDependentsRegistry();
    registry.register(guard(WORK_ORDERS_GUARD, () => 0));
    await expect(assertNoOpenDependents(registry, TX, CUSTOMER)).resolves.toBeUndefined();
  });

  it('EVM-041 AC2 an open order is 409 has_active_dependents with the NUMBER from the implementation of work-orders and nothing else', async () => {
    const registry = new CustomerDependentsRegistry();
    registry.register(guard(WORK_ORDERS_GUARD, () => 2, 10));
    registry.register(guard('investments', () => 7, 20));
    const problem = await problemOf(assertNoOpenDependents(registry, TX, CUSTOMER));
    expect(problem.code).toBe('has_active_dependents');
    expect(problem.extras).toEqual({ openWorkOrders: 2 });
  });

  it('EVM-041 AC2 a dependent of ANOTHER module blocks but never changes the meaning of openWorkOrders (no number is sent)', async () => {
    const registry = new CustomerDependentsRegistry();
    registry.register(guard(WORK_ORDERS_GUARD, () => 0, 10));
    registry.register(guard('investments', () => 4, 20));
    const problem = await problemOf(assertNoOpenDependents(registry, TX, CUSTOMER));
    expect(problem.code).toBe('has_active_dependents');
    expect(problem.extras).toEqual({});
  });

  it('EVM-041 AC6 the event of the audit trail carries the actor, the customer, the action and the outcome - nothing else', () => {
    expect(customerEvent('customer.anonymized', { userId: 'u1' } as never, CUSTOMER, 'failed')).toEqual({
      type: 'customer.anonymized',
      actor: { type: 'user', userId: 'u1' },
      outcome: 'failed',
      objectType: 'customer',
      objectId: CUSTOMER,
    });
  });
});
