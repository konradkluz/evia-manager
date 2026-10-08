import type { Kysely } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import { CreateSiteService } from '../../src/modules/sites/application/create-site.service.ts';
import type { PartyDirectory, PartyKind } from '../../src/modules/parties/index.ts';
import type { Database } from '../../src/platform/database/database.ts';
import type { EventBus } from '../../src/platform/events/event-bus.ts';
import type { Idempotency } from '../../src/platform/idempotency/idempotency.ts';
import { ProblemException } from '../../src/platform/http/problem.ts';
import { principal } from '../support/principals.ts';
import { uuidv7 } from '../support/uuid.ts';

// The service with a FAKE party directory (SR-INPUT-02: the kind of a party in a `…PartyId` field is checked by the use case, not
// only by the database). Nothing here touches PostgreSQL: the check must stop the creation BEFORE the insert, so the fake
// transaction has no query methods at all — a call to one would fail the test.
const OSD = uuidv7();
const MANAGER = uuidv7();
const TRANSACTION = { marker: 'the transaction of the insert' } as unknown as Kysely<Database>;

function setup(kinds: ReadonlyMap<string, PartyKind>) {
  const kindsOf = vi.fn<PartyDirectory['kindsOf']>(() => Promise.resolve(kinds));
  const directory: PartyDirectory = { kindsOf, namesOf: () => Promise.resolve(new Map()) };
  const publish = vi.fn();
  const run = vi.fn(async (_tx: unknown, _request: unknown, operation: () => Promise<{ value: unknown; result: unknown }>) => ({
    replayed: false,
    ...(await operation()),
  }));
  const db = {
    transaction: () => ({ execute: <T>(work: (tx: Kysely<Database>) => Promise<T>) => work(TRANSACTION) }),
  } as unknown as Kysely<Database>;
  const service = new CreateSiteService(
    db,
    { now: () => new Date('2026-10-07T08:00:00Z') },
    { publish } as unknown as EventBus,
    { run } as unknown as Idempotency,
    directory,
  );
  return { service, kindsOf, publish, run };
}

const body = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  siteType: 'single_family_house',
  street: 'ul. Testowa',
  buildingNumber: '7',
  postalCode: '00-001',
  city: 'Warszawa',
  distributionSystemOperatorPartyId: OSD,
  managerPartyId: MANAGER,
  ...overrides,
});
const context = { origin: 'web' as const, traceId: 'a'.repeat(32) };
const errorsOf = async (promise: Promise<unknown>) => {
  const error = (await promise.then(
    () => undefined,
    (e: unknown) => e,
  )) as ProblemException | undefined;
  expect(error).toBeInstanceOf(ProblemException);
  expect(error?.code).toBe('validation_failed');
  return error?.extras.errors;
};

describe('creation of a site checks the kind of the parties (EVM-021 AC3; SR-INPUT-02)', () => {
  it('EVM-021 AC3 a party of another kind in …PartyId is 400 validation_failed with wrong_party_kind — before any insert and without naming the kind found', async () => {
    const { service, kindsOf, publish } = setup(
      new Map<string, PartyKind>([
        [OSD, 'property_manager'],
        [MANAGER, 'distribution_system_operator'],
      ]),
    );
    const errors = await errorsOf(service.create(principal({ role: 'editor' }), body(), uuidv7(), context));
    expect(errors).toEqual([
      { pointer: '/distributionSystemOperatorPartyId', code: 'wrong_party_kind' },
      { pointer: '/managerPartyId', code: 'wrong_party_kind' },
    ]);
    expect(JSON.stringify(errors)).not.toMatch(/property_manager|distribution_system_operator/);
    expect(publish).not.toHaveBeenCalled();
    expect(kindsOf).toHaveBeenCalledTimes(1);
  });

  it('EVM-021 AC3 the kinds are read in the SAME transaction as the insert, for both parties at once', async () => {
    const { service, kindsOf } = setup(new Map());
    await errorsOf(service.create(principal({ role: 'administrator' }), body(), undefined, context));
    expect(kindsOf).toHaveBeenCalledWith(TRANSACTION, expect.objectContaining({ role: 'administrator' }), [OSD, MANAGER]);
  });

  it('EVM-021 AC3 a party that is not visible (it never existed or is deleted) is unknown_party, the same for both', async () => {
    const { service } = setup(new Map<string, PartyKind>([[MANAGER, 'building_administration']]));
    expect(await errorsOf(service.create(principal({ role: 'editor' }), body(), undefined, context))).toEqual([
      { pointer: '/distributionSystemOperatorPartyId', code: 'unknown_party' },
    ]);
  });

  it('EVM-021 AC3 a failed check leaves no idempotency record: the error is thrown inside the operation the port runs, so the transaction is rolled back', async () => {
    const { service, run } = setup(new Map());
    await errorsOf(service.create(principal(), body(), uuidv7(), context));
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(
      TRANSACTION,
      expect.objectContaining({ scope: 'POST /api/v1/sites', deviceId: null }),
      expect.any(Function),
    );
  });

  it('EVM-021 AC5 a body outside the schema never reaches the directory or the transaction (customerId is unknown_field, a field of the server read_only_field)', async () => {
    const { service, kindsOf, run } = setup(new Map());
    const rejected = await errorsOf(
      service.create(principal(), body({ customerId: uuidv7(), version: 3, searchText: 'x' }), uuidv7(), context),
    );
    expect(rejected).toEqual(
      expect.arrayContaining([
        { pointer: '/customerId', code: 'unknown_field' },
        { pointer: '/version', code: 'read_only_field' },
        { pointer: '/searchText', code: 'read_only_field' },
      ]),
    );
    expect(kindsOf).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('EVM-021 AC2 a rule of the domain (a spot outside a garage) stops the creation before the directory is asked', async () => {
    const { service, kindsOf } = setup(new Map());
    expect(await errorsOf(service.create(principal(), body({ parkingSpotNumber: '15' }), undefined, context))).toEqual([
      { pointer: '/parkingSpotNumber', code: 'not_allowed_for_site_type' },
    ]);
    expect(kindsOf).not.toHaveBeenCalled();
  });
});
