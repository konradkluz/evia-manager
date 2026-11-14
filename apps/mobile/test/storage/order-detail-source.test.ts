import type { ReplicaOp } from '@evia/sync-core';
import { SqlReplicaStore } from '../../src/storage/replica-store';
import { migratedDatabase } from './harness';
import { newDisk, removeDisk, type NodeSqliteEngine, type TestDisk } from './node-sqlite-engine';

// EVM-104 AC1-AC5 (security K1, K5, K10): the one read of the replica for the details of a work order.
let disk: TestDisk;
let engine: NodeSqliteEngine;
let store: SqlReplicaStore;
let generation: number;

const MARKER = 'SYNTHETIC-PRIVATE-MARKER';

const upsert = (type: string, id: string, fields: Record<string, unknown>): ReplicaOp =>
  ({ op: 'upsert', entity: { type, id, version: 1, fields } }) as ReplicaOp;

const order = (id: string, extra: Record<string, unknown> = {}): ReplicaOp =>
  upsert('work_order', id, {
    number: `ZL-${id}`,
    title: `Title ${id}`,
    status: 'in_progress',
    customerId: `c-${id}`,
    siteId: `s-${id}`,
    coordinatorUserId: 'u-coord',
    description: `${MARKER}-description`,
    plannedDate: '2026-12-01',
    createdAt: '2026-10-30T08:00:00.000Z',
    closedAt: null,
    ...extra,
  });

const aggregate = (id: string): ReplicaOp[] => [
  order(id),
  upsert('customer', `c-${id}`, {
    kind: 'person',
    displayName: `Customer ${id}`,
    phone: `+48 600 000 00${id.length}`,
    email: `${MARKER}-mail`,
    nip: `${MARKER}-nip`,
  }),
  upsert('site', `s-${id}`, {
    siteType: 'multi_family_garage',
    street: `ul. ${id}`,
    buildingNumber: '7',
    apartmentNumber: `${MARKER}-apartment`,
    postalCode: '00-001',
    city: 'Warszawa',
    parkingSpotNumber: '15',
    garageLevel: '-1',
    connectionPowerKw: 40,
    managerPartyId: `p-mgr-${id}`,
    distributionSystemOperatorPartyId: `p-dso-${id}`,
    notes: `${MARKER}-site-notes`,
    ppe: `${MARKER}-ppe`,
  }),
  upsert('party', `p-mgr-${id}`, {
    kind: 'housing_community',
    displayName: `Manager ${id}`,
    contactPersonName: `${MARKER}-contact`,
    phone: `${MARKER}-party-phone`,
  }),
  upsert('party', `p-dso-${id}`, {
    kind: 'dso',
    displayName: `Operator ${id}`,
    contactPersonName: `${MARKER}-contact`,
    phone: `${MARKER}-party-phone`,
  }),
  upsert('party', 'p-unrelated', { kind: 'other', displayName: 'SYNTHETIC-UNRELATED-PARTY' }),
  upsert('scope_item', `i-${id}-1`, {
    workOrderId: id,
    position: 1,
    code: 'X',
    name: `Scope ${id}`,
    parameters: { k: MARKER },
    quantity: 2,
    notes: `${MARKER}-scope-notes`,
  }),
  upsert('procedure_stage', `st-${id}-1`, {
    workOrderId: id,
    procedureId: `pr-${id}`,
    procedureName: `Process ${id}`,
    name: `Stage ${id}`,
    position: 1,
    status: 'waiting',
    waitingOn: 'party',
    waitingPartyId: `p-dso-${id}`,
    blockedReason: `${MARKER}-reason`,
  }),
  upsert('timeline_entry', `e-${id}-1`, {
    workOrderId: id,
    kind: 'note',
    noteCategory: 'phone_call',
    body: `Body ${id}`,
    authorUserId: 'u-a',
    createdAt: '2026-11-01T08:00:00.000Z',
    capturedAt: '2026-11-01T07:00:00.000Z',
    origin: 'mobile',
    redactedAt: null,
  }),
  upsert('user', 'u-a', { displayName: 'Anna Testowa', email: `${MARKER}-user-mail` }),
  upsert('user', 'u-unrelated', { displayName: 'SYNTHETIC-UNRELATED-USER' }),
];

async function apply(ops: ReplicaOp[]): Promise<void> {
  await store.applyPage({
    generation,
    ownerUserId: 'u1',
    ops,
    cursor: 'cursor-000000000001',
    phase: 'changes',
    complete: true,
    serverTime: Date.UTC(2026, 10, 2),
    hydrationAdd: [],
    hydrationRemove: [],
  });
}

beforeEach(async () => {
  disk = newDisk();
  const migrated = await migratedDatabase(disk);
  engine = migrated.engine;
  store = new SqlReplicaStore(migrated.db);
  generation = (await store.loadState()).active.generation;
  await apply([...aggregate('o1'), ...aggregate('o2')]);
  engine.statements.length = 0;
});
afterEach(() => {
  removeDisk(disk);
});

describe('readOrderDetailSource (EVM-104)', () => {
  it('EVM-104 AC1: one transaction gives the order with its customer, site, parties, scope, stages, entries and authors', async () => {
    const source = await store.readOrderDetailSource('o1');
    expect(source).not.toBeNull();
    expect(source?.order).toEqual({
      id: 'o1',
      number: 'ZL-o1',
      title: 'Title o1',
      status: 'in_progress',
      customerId: 'c-o1',
      siteId: 's-o1',
    });
    expect(source?.customer).toEqual({ id: 'c-o1', displayName: 'Customer o1', phone: '+48 600 000 002' });
    expect(source?.site).toEqual({
      id: 's-o1',
      street: 'ul. o1',
      buildingNumber: '7',
      postalCode: '00-001',
      city: 'Warszawa',
      parkingSpot: '15',
      garageLevel: '-1',
      connectionPowerKw: 40,
      managerPartyId: 'p-mgr-o1',
      operatorPartyId: 'p-dso-o1',
    });
    expect(source?.parties.map((p) => [p.id, p.kind, p.displayName]).sort()).toEqual([
      ['p-dso-o1', 'dso', 'Operator o1'],
      ['p-mgr-o1', 'housing_community', 'Manager o1'],
    ]);
    expect(source?.scopeItems).toEqual([{ id: 'i-o1-1', position: 1, name: 'Scope o1', quantity: 2 }]);
    expect(source?.stages).toEqual([
      {
        id: 'st-o1-1',
        procedureId: 'pr-o1',
        procedureName: 'Process o1',
        name: 'Stage o1',
        position: 1,
        status: 'waiting',
        waitingOn: 'party',
        waitingPartyId: 'p-dso-o1',
      },
    ]);
    expect(source?.entries).toEqual([
      {
        id: 'e-o1-1',
        kind: 'note',
        noteCategory: 'phone_call',
        body: 'Body o1',
        authorUserId: 'u-a',
        createdAt: Date.parse('2026-11-01T08:00:00.000Z'),
        capturedAt: Date.parse('2026-11-01T07:00:00.000Z'),
        redactedAt: null,
        supersedesEntryId: null,
        supersededByEntryId: null,
      },
    ]);
    expect(source?.users).toEqual([{ id: 'u-a', displayName: 'Anna Testowa' }]);
  });

  it('EVM-104 AC1 (security K10): the work order id is a bound parameter, never part of the SQL text; one read, no per-row queries', async () => {
    await store.readOrderDetailSource('o1');
    const selects = engine.statements.filter((sql) => /^SELECT/.test(sql));
    expect(selects.length).toBeLessThanOrEqual(8);
    expect(selects.join('\n')).not.toContain('o1');
    expect(selects.join('\n')).not.toMatch(/LIMIT/i);
    // the same number of statements for a work order with more rows (no N+1)
    const count = selects.length;
    await apply([
      upsert('timeline_entry', 'e-o1-2', {
        workOrderId: 'o1',
        kind: 'comment',
        body: 'x',
        authorUserId: 'u-unrelated',
        createdAt: '2026-11-02T08:00:00.000Z',
      }),
      upsert('scope_item', 'i-o1-2', { workOrderId: 'o1', position: 2, name: 'More' }),
    ]);
    engine.statements.length = 0;
    await store.readOrderDetailSource('o1');
    expect(engine.statements.filter((sql) => /^SELECT/.test(sql))).toHaveLength(count);
  });

  it('EVM-104 AC2 (security K1): the SQL never selects the raw `fields` column nor a key outside the allow-list (e-mail, tax id, PPE, notes, description, contact person, party phone)', async () => {
    await store.readOrderDetailSource('o1');
    const sql = engine.statements.filter((s) => s.startsWith('SELECT')).join('\n');
    expect(sql).not.toMatch(/(?<!json_extract\()\be\.fields\b/);
    for (const key of [
      'email',
      'nip',
      'ppe',
      'notes',
      'description',
      'apartmentNumber',
      'contactPersonName',
      'blockedReason',
      'parameters',
      'coordinatorUserId',
      'plannedDate',
      'origin',
    ]) {
      expect(sql).not.toContain(`'$.${key}'`);
    }
    expect([...sql.matchAll(/e\.fields/g)]).toHaveLength([...sql.matchAll(/json_extract\(e\.fields, '\$\.[A-Za-z]+'\)/g)].length);
    expect(sql).not.toMatch(/payment|media|document/i);
  });

  it('EVM-104 AC2 (security K1): the result holds only the allow-listed keys of each part', async () => {
    const source = await store.readOrderDetailSource('o1');
    expect(JSON.stringify(source)).not.toContain(MARKER);
    expect(JSON.stringify(source)).not.toContain('SYNTHETIC-UNRELATED');
    expect(Object.keys(source?.order ?? {}).sort()).toEqual(['customerId', 'id', 'number', 'siteId', 'status', 'title']);
    expect(Object.keys(source?.customer ?? {}).sort()).toEqual(['displayName', 'id', 'phone']);
    expect(Object.keys(source?.parties[0] ?? {}).sort()).toEqual(['displayName', 'id', 'kind']);
    expect(Object.keys(source?.users[0] ?? {}).sort()).toEqual(['displayName', 'id']);
    expect(Object.keys(source?.entries[0] ?? {}).sort()).toEqual([
      'authorUserId',
      'body',
      'capturedAt',
      'createdAt',
      'id',
      'kind',
      'noteCategory',
      'redactedAt',
      'supersededByEntryId',
      'supersedesEntryId',
    ]);
  });

  it('EVM-104 AC3 (security K5): children of another work order never leak (scope, stages, entries, their parties and authors)', async () => {
    const source = await store.readOrderDetailSource('o1');
    expect(JSON.stringify(source)).not.toMatch(/o2/);
  });

  it('EVM-104 AC5: a work order that is not in the active generation, or has a tombstone, gives null and no children are read', async () => {
    expect(await store.readOrderDetailSource('o-none')).toBeNull();
    await apply([{ op: 'delete', type: 'work_order', id: 'o1', version: 5 }]);
    engine.statements.length = 0;
    expect(await store.readOrderDetailSource('o1')).toBeNull();
    expect(engine.statements.filter((s) => s.startsWith('SELECT'))).toHaveLength(1);
    expect((await store.readOrderDetailSource('o2'))?.order.id).toBe('o2');
  });

  it('EVM-104 AC5: only the active generation is read; a shadow under construction is invisible until promoted', async () => {
    const shadow = await store.beginShadow();
    await store.applyPage({
      generation: shadow,
      ownerUserId: 'u1',
      ops: [order('o-shadow', { customerId: null, siteId: null })],
      cursor: 'cursor-000000000002',
      phase: 'changes',
      complete: true,
      serverTime: Date.UTC(2026, 10, 2),
      hydrationAdd: [],
      hydrationRemove: [],
    });
    expect(await store.readOrderDetailSource('o-shadow')).toBeNull();
    await store.promoteShadow(shadow);
    expect(await store.readOrderDetailSource('o1')).toBeNull();
    const promoted = await store.readOrderDetailSource('o-shadow');
    expect(promoted).toMatchObject({ customer: null, site: null, parties: [], scopeItems: [], stages: [], entries: [], users: [] });
  });

  it('EVM-104 AC2: odd values in the projection do not break the read (text numbers, missing times, a missing customer or site row)', async () => {
    await apply([
      upsert('work_order', 'o-odd', { number: 42, title: null, status: null, customerId: 'c-missing', siteId: 's-missing' }),
      upsert('scope_item', 'i-odd', { workOrderId: 'o-odd', position: 'x', name: null, quantity: 'many' }),
      upsert('procedure_stage', 'st-odd', {
        workOrderId: 'o-odd',
        procedureId: null,
        procedureName: null,
        name: null,
        position: 'x',
        status: null,
        waitingOn: 3,
        waitingPartyId: 4,
      }),
      upsert('timeline_entry', 'e-odd', {
        workOrderId: 'o-odd',
        kind: null,
        noteCategory: 5,
        body: 6,
        authorUserId: 7,
        createdAt: 'no date',
        capturedAt: 'no date',
        redactedAt: 'no date',
      }),
    ]);
    const source = await store.readOrderDetailSource('o-odd');
    expect(source?.order).toEqual({ id: 'o-odd', number: null, title: '', status: '', customerId: 'c-missing', siteId: 's-missing' });
    expect(source?.customer).toBeNull();
    expect(source?.site).toBeNull();
    expect(source?.scopeItems).toEqual([{ id: 'i-odd', position: 0, name: '', quantity: null }]);
    expect(source?.stages[0]).toEqual({
      id: 'st-odd',
      procedureId: 'st-odd',
      procedureName: '',
      name: '',
      position: 0,
      status: '',
      waitingOn: null,
      waitingPartyId: null,
    });
    expect(source?.entries[0]).toEqual({
      id: 'e-odd',
      kind: '',
      noteCategory: null,
      body: null,
      authorUserId: null,
      createdAt: 0,
      capturedAt: null,
      redactedAt: 0,
      supersedesEntryId: null,
      supersededByEntryId: null,
    });
  });

  it('EVM-104 AC4: the links between an entry and its correction arrive with the entry (for both directions)', async () => {
    await apply([
      upsert('timeline_entry', 'e-wrong', {
        workOrderId: 'o1',
        kind: 'note',
        body: 'x',
        createdAt: '2026-11-03T08:00:00.000Z',
        supersededByEntryId: 'e-fix',
      }),
      upsert('timeline_entry', 'e-fix', {
        workOrderId: 'o1',
        kind: 'note',
        body: 'y',
        createdAt: '2026-11-03T09:00:00.000Z',
        supersedesEntryId: 'e-wrong',
      }),
    ]);
    const entries = (await store.readOrderDetailSource('o1'))?.entries ?? [];
    expect(entries.find((e) => e.id === 'e-wrong')).toMatchObject({ supersededByEntryId: 'e-fix', supersedesEntryId: null });
    expect(entries.find((e) => e.id === 'e-fix')).toMatchObject({ supersedesEntryId: 'e-wrong', supersededByEntryId: null });
  });

  it('EVM-104 AC4: a redacted entry arrives with its time of redaction (the model drops the body)', async () => {
    await apply([
      upsert('timeline_entry', 'e-red', {
        workOrderId: 'o1',
        kind: 'note',
        body: 'x',
        createdAt: '2026-11-03T08:00:00.000Z',
        redactedAt: '2026-11-04T08:00:00.000Z',
      }),
    ]);
    const source = await store.readOrderDetailSource('o1');
    expect(source?.entries.find((e) => e.id === 'e-red')?.redactedAt).toBe(Date.parse('2026-11-04T08:00:00.000Z'));
  });

  it('EVM-104 AC1: a long list of authors and parties is read in chunks of bounded size', async () => {
    const ops: ReplicaOp[] = [];
    for (let n = 0; n < 620; n += 1) {
      ops.push(upsert('user', `u-${String(n)}`, { displayName: `User ${String(n)}` }));
      ops.push(
        upsert('timeline_entry', `e-many-${String(n)}`, {
          workOrderId: 'o1',
          kind: 'note',
          body: 'x',
          authorUserId: `u-${String(n)}`,
          createdAt: '2026-11-02T08:00:00.000Z',
        }),
      );
    }
    await apply(ops);
    engine.statements.length = 0;
    const source = await store.readOrderDetailSource('o1');
    expect(source?.users).toHaveLength(621);
    const selects = engine.statements.filter((s) => s.startsWith('SELECT'));
    expect(selects.length).toBeGreaterThan(8);
    expect(selects.length).toBeLessThanOrEqual(12);
  });
});
