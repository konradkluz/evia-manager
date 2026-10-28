import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { describe, expect, it } from 'vitest';
import { AnonymizeCustomerService } from '../../src/modules/customers/application/anonymize-customer.service.ts';
import { DeleteCustomerService } from '../../src/modules/customers/application/delete-customer.service.ts';
import { RestoreCustomerService } from '../../src/modules/customers/application/restore-customer.service.ts';
import { assertNoOpenDependents } from '../../src/modules/customers/application/customer-command-support.ts';
import { CustomerDependentsRegistry, WORK_ORDERS_GUARD } from '../../src/modules/customers/dependents-guard.ts';
import { resolveCustomerListQuery } from '../../src/modules/customers/domain/customer-list-query.ts';
import { deletedCustomers, readableCustomers, visibleCustomers } from '../../src/modules/customers/infrastructure/read-policy.ts';
import type { CustomerTables } from '../../src/modules/customers/infrastructure/tables.ts';
import { ProblemException } from '../../src/platform/http/problem.ts';
import { parseInput } from '../../src/platform/http/validation.ts';
import { principal } from '../support/principals.ts';

const CUSTOMER = '0199aaaa-0000-7000-8000-000000000001';
const PARAMS = { customerId: CUSTOMER };

const problemOf = async (action: Promise<unknown>): Promise<ProblemException> => {
  const error: unknown = await action.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ProblemException);
  return error as ProblemException;
};

describe('the second line of defence behind the guard (EVM-041 AC7; SR-AUTHZ-05)', () => {
  // the services take nothing from the dependencies before the role is checked: a role that is not the Administrator never reaches a lock
  const none = {} as never;
  const services = {
    delete: (role: 'editor' | 'read_only') =>
      new DeleteCustomerService(none, none, none, none, none).delete(principal({ role }), PARAMS, '"1"', undefined, {} as never),
    restore: (role: 'editor' | 'read_only') =>
      new RestoreCustomerService(none, none, none, none).restore(principal({ role }), PARAMS, '"1"', undefined, {} as never),
    anonymize: (role: 'editor' | 'read_only') =>
      new AnonymizeCustomerService(none, none, none, none, none, none).anonymize(principal({ role }), PARAMS, '"1"', {} as never),
  };

  it.each(['delete', 'restore', 'anonymize'] as const)(
    'EVM-041 AC7 %s: the Editor and Read-only are refused with 403 forbidden before any lock is taken',
    async (operation) => {
      for (const role of ['editor', 'read_only'] as const) {
        expect((await problemOf(services[operation](role))).code, `${operation} ${role}`).toBe('forbidden');
      }
    },
  );
});

describe('the read policies compile to different conditions (EVM-041 AC1; SR-AUTHZ-03)', () => {
  const dummy = new Kysely<CustomerTables>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  const sqlOf = (policy: ReturnType<typeof visibleCustomers>): string =>
    dummy.selectFrom('customers.customers').select('id').where(policy).compile().sql;

  it('EVM-041 AC1 visible: not deleted, for every role; readable: everything for the Administrator, not deleted for the others; deleted view: only deleted for the Administrator, nothing for the others', () => {
    for (const role of ['administrator', 'editor', 'read_only'] as const) {
      expect(sqlOf(visibleCustomers(principal({ role }))), `visible ${role}`).toMatch(/"deleted_at" is null/);
    }
    expect(sqlOf(readableCustomers(principal({ role: 'administrator' })))).toMatch(/where true$/);
    for (const role of ['editor', 'read_only'] as const) {
      expect(sqlOf(readableCustomers(principal({ role }))), `readable ${role}`).toMatch(/"deleted_at" is null/);
      expect(sqlOf(deletedCustomers(principal({ role }))), `deleted ${role}`).toMatch(/where false$/);
    }
    expect(sqlOf(deletedCustomers(principal({ role: 'administrator' })))).toMatch(/"deleted_at" is not null/);
  });
});

describe('the filter "deleted" of the list (EVM-041 AC3)', () => {
  it('EVM-041 AC3 true and false are read from the query string; absent is the live view; anything else is refused', () => {
    expect(parseInput(resolveCustomerListQuery, { deleted: 'true' }).deleted).toBe(true);
    expect(parseInput(resolveCustomerListQuery, { deleted: 'false' }).deleted).toBe(false);
    expect(parseInput(resolveCustomerListQuery, {}).deleted).toBe(false);
    expect(() => parseInput(resolveCustomerListQuery, { deleted: 'yes' })).toThrow(ProblemException);
  });
});

describe('the registry of the dependents (EVM-041 AC2)', () => {
  it('EVM-041 AC2 equal positions are told apart by the name (the order of the calls is fixed)', () => {
    const registry = new CustomerDependentsRegistry();
    registry.register({ name: 'b', order: 1, countOpen: () => Promise.resolve(0) });
    registry.register({ name: 'a', order: 1, countOpen: () => Promise.resolve(0) });
    registry.register({ name: 'c', order: 1, countOpen: () => Promise.resolve(0) });
    expect(registry.names()).toEqual(['a', 'b', 'c']);
  });

  it('EVM-041 AC2 a blocking dependent of a module other than work-orders, with no implementation of work-orders at all, is 409 without a number', async () => {
    const registry = new CustomerDependentsRegistry();
    registry.register({ name: 'investments', order: 1, countOpen: () => Promise.resolve(3) });
    expect(registry.names()).not.toContain(WORK_ORDERS_GUARD);
    const problem = await problemOf(assertNoOpenDependents(registry, {} as never, CUSTOMER));
    expect([problem.code, problem.extras]).toEqual(['has_active_dependents', {}]);
  });
});
