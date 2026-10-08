import type { Kysely } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import type { TemplateDirectory } from '../../src/modules/catalog/index.ts';
import type { CustomerDirectory } from '../../src/modules/customers/index.ts';
import type { UserDirectory } from '../../src/modules/identity/index.ts';
import type { SiteDirectory } from '../../src/modules/sites/index.ts';
import { CreateWorkOrderService } from '../../src/modules/work-orders/application/create-work-order.service.ts';
import { WorkOrderCompositionRegistry } from '../../src/modules/work-orders/composition-contributor.ts';
import type { Database } from '../../src/platform/database/database.ts';
import type { EventBus } from '../../src/platform/events/event-bus.ts';
import { ProblemException } from '../../src/platform/http/problem.ts';
import type { Idempotency } from '../../src/platform/idempotency/idempotency.ts';
import { principal } from '../support/principals.ts';
import { uuidv7 } from '../support/uuid.ts';

// The service with FAKE directories: the checks of the use case come BEFORE the first write (the customer, the site, the template,
// the assignee), so the fake transaction has no query methods at all — a call to one would fail the test.
const TRANSACTION = { marker: 'the transaction of the insert' } as unknown as Kysely<Database>;
const CUSTOMER = { id: uuidv7(), displayName: 'Jan Przykładowy' };
const SITE = {
  id: uuidv7(),
  siteType: 'other' as const,
  street: 'ul. Testowa',
  buildingNumber: '7',
  apartmentNumber: null,
  postalCode: '00-001',
  city: 'Warszawa',
  parkingSpotNumber: null,
  garageLevel: null,
};

interface Answers {
  customer?: unknown;
  site?: unknown;
  template?: unknown;
  assignee?: unknown;
}

function setup(overrides: Answers = {}) {
  const answer = (key: keyof Answers, fallback: unknown) => (key in overrides ? overrides[key] : fallback);
  const findCustomer = vi.fn(() => Promise.resolve(answer('customer', CUSTOMER)));
  const findSite = vi.fn(() => Promise.resolve(answer('site', SITE)));
  const findTemplate = vi.fn(() => Promise.resolve(answer('template', undefined)));
  const findActive = vi.fn<UserDirectory['findActive']>(() => Promise.resolve(answer('assignee', undefined) as never));
  const publish = vi.fn();
  const run = vi.fn(async (_tx: unknown, _request: unknown, operation: () => Promise<{ value: unknown; result: unknown }>) => ({
    replayed: false,
    ...(await operation()),
  }));
  const db = {
    transaction: () => ({ execute: <T>(work: (tx: Kysely<Database>) => Promise<T>) => work(TRANSACTION) }),
  } as unknown as Kysely<Database>;
  const service = new CreateWorkOrderService(
    db,
    { now: () => new Date('2026-10-07T08:00:00Z') },
    { publish } as unknown as EventBus,
    { run } as unknown as Idempotency,
    { findVisible: findCustomer } as unknown as CustomerDirectory,
    { findVisible: findSite } as unknown as SiteDirectory,
    { findActiveForCopy: findTemplate } as unknown as TemplateDirectory,
    { findActive } as unknown as UserDirectory,
    new WorkOrderCompositionRegistry(),
  );
  return { service, findCustomer, findSite, findTemplate, findActive, publish, run };
}

const body = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  customerId: CUSTOMER.id,
  siteId: SITE.id,
  templateId: null,
  ...overrides,
});
const context = { origin: 'web' as const, traceId: 'a'.repeat(32) };
const problemOf = async (promise: Promise<unknown>) => {
  const error = (await promise.then(
    () => undefined,
    (e: unknown) => e,
  )) as ProblemException | undefined;
  expect(error).toBeInstanceOf(ProblemException);
  return error as ProblemException;
};

describe('creation of a work order checks its references before any write (EVM-022 AC3, AC6; SR-AUTHZ-02, SR-INPUT-02)', () => {
  it('EVM-022 AC3 a customer or a site that is not visible is 404 not_found and the template is not even looked at', async () => {
    for (const missing of [{ customer: undefined }, { site: undefined }]) {
      const { service, findTemplate, findActive, publish } = setup(missing);
      const error = await problemOf(
        service.create(principal({ role: 'administrator' }), body({ templateId: uuidv7() }), undefined, context),
      );
      expect(error.code).toBe('not_found');
      expect(findTemplate).not.toHaveBeenCalled();
      expect(findActive).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    }
  });

  it('EVM-022 AC3 both references are read in the SAME transaction as the insert, with the principal of the caller', async () => {
    const { service, findCustomer, findSite } = setup({ template: undefined });
    const caller = principal({ role: 'editor' });
    await problemOf(service.create(caller, body({ templateId: uuidv7() }), undefined, context));
    expect(findCustomer).toHaveBeenCalledWith(TRANSACTION, caller, CUSTOMER.id);
    expect(findSite).toHaveBeenCalledWith(TRANSACTION, caller, SITE.id);
  });

  it('EVM-022 AC3 a template that is not active is 422 template_unavailable before the assignee is looked at', async () => {
    const { service, findActive } = setup({ template: undefined });
    const error = await problemOf(service.create(principal(), body({ templateId: uuidv7() }), undefined, context));
    expect(error.code).toBe('template_unavailable');
    expect(findActive).not.toHaveBeenCalled();
  });

  it('EVM-022 AC3 an assignee who is not an active user is 400 assignee_unavailable on /assigneeUserId', async () => {
    const { service, findActive } = setup({ assignee: undefined });
    const named = uuidv7();
    const error = await problemOf(service.create(principal(), body({ assigneeUserId: named }), undefined, context));
    expect(error.code).toBe('validation_failed');
    expect(error.extras.errors).toEqual([{ pointer: '/assigneeUserId', code: 'assignee_unavailable' }]);
    expect(findActive).toHaveBeenCalledWith(named, TRANSACTION);
  });

  it('EVM-022 AC3 when the session user is no longer active (the account was switched off between the check of the session and the transaction) nothing is created: 403', async () => {
    const { service, findActive, publish } = setup({ assignee: undefined });
    const caller = principal();
    const error = await problemOf(service.create(caller, body(), undefined, context));
    expect(error.code).toBe('forbidden');
    expect(findActive).toHaveBeenCalledWith(caller.userId, TRANSACTION);
    expect(publish).not.toHaveBeenCalled();
  });

  it('EVM-022 AC4 a failed check is thrown inside the operation the idempotency port runs, so the transaction is rolled back and no record is left', async () => {
    const { service, run } = setup({ customer: undefined });
    await problemOf(service.create(principal(), body(), uuidv7(), context));
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(
      TRANSACTION,
      expect.objectContaining({ scope: 'POST /api/v1/work-orders', deviceId: null }),
      expect.any(Function),
    );
  });

  it('EVM-022 AC5 a body outside the schema never reaches a directory or the transaction (number is read_only_field, a stranger unknown_field)', async () => {
    const { service, findCustomer, run } = setup();
    const error = await problemOf(
      service.create(principal(), body({ number: 'ZL-2026-0001', status: 'settled', vip: true }), uuidv7(), context),
    );
    expect(error.code).toBe('validation_failed');
    expect(error.extras.errors).toEqual(
      expect.arrayContaining([
        { pointer: '/number', code: 'read_only_field' },
        { pointer: '/status', code: 'read_only_field' },
        { pointer: '/vip', code: 'unknown_field' },
      ]),
    );
    expect(findCustomer).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('EVM-022 AC3 a rule of the domain (a date out of range) stops the creation before the directories are asked', async () => {
    const { service, findCustomer } = setup();
    const error = await problemOf(service.create(principal(), body({ plannedDate: '1999-01-01' }), undefined, context));
    expect(error.extras.errors).toEqual([{ pointer: '/plannedDate', code: 'out_of_range' }]);
    expect(findCustomer).not.toHaveBeenCalled();
  });
});
