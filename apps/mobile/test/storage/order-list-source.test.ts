import type { ReplicaOp } from '@evia/sync-core';
import { SqlReplicaStore } from '../../src/storage/replica-store';
import { migratedDatabase } from './harness';
import { newDisk, removeDisk, type NodeSqliteEngine, type TestDisk } from './node-sqlite-engine';

// EVM-103 AC1, AC5, AC6 (security K1): the one read of the replica for "Moje zlecenia" selects allow-listed keys only.
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
    title: `${MARKER}-title`,
    status: 'in_progress',
    customerId: 'c1',
    siteId: 's1',
    coordinatorUserId: null,
    description: `${MARKER}-description`,
    plannedDate: null,
    createdAt: '2026-10-30T08:00:00.000Z',
    closedAt: null,
    ...extra,
  });

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
  await apply([
    order('o1'),
    order('o2', { createdAt: '2026-10-31T08:00:00.000Z', customerId: null, siteId: null, number: 'ZL-2' }),
    upsert('customer', 'c1', { kind: 'person', displayName: 'Jan Łódzki', phone: `${MARKER}-phone`, email: `${MARKER}-mail` }),
    upsert('site', 's1', {
      siteType: 'other',
      street: 'ul. Testowa',
      buildingNumber: '7',
      apartmentNumber: `${MARKER}-apartment`,
      postalCode: '00-000',
      city: 'Łódź',
      parkingSpotNumber: '15',
      garageLevel: '-1',
      connectionPowerKw: null,
      notes: `${MARKER}-notes`,
    }),
    upsert('procedure_stage', 'st1', { workOrderId: 'o1', name: 'Montaż', position: 2, status: 'todo', blockedReason: `${MARKER}-reason` }),
    upsert('procedure_stage', 'st2', { workOrderId: 'o1', name: 'Wizja', position: 1, status: 'done' }),
    upsert('note', 'n1', { workOrderId: 'o1', body: `${MARKER}-note` }),
  ]);
  engine.statements.length = 0;
});
afterEach(() => {
  removeDisk(disk);
});

describe('readOrderListSource (EVM-103)', () => {
  it('EVM-103 AC1: one read of the active generation gives the orders with their customers, sites and stages - no LIMIT, no per-order query', async () => {
    const source = await store.readOrderListSource(true);
    expect(source.orders).toEqual([
      {
        id: 'o1',
        number: 'ZL-o1',
        status: 'in_progress',
        createdAt: Date.parse('2026-10-30T08:00:00.000Z'),
        customerId: 'c1',
        siteId: 's1',
      },
      {
        id: 'o2',
        number: 'ZL-2',
        status: 'in_progress',
        createdAt: Date.parse('2026-10-31T08:00:00.000Z'),
        customerId: null,
        siteId: null,
      },
    ]);
    expect(source.customers).toEqual([{ id: 'c1', displayName: 'Jan Łódzki' }]);
    expect(source.sites).toEqual([{ id: 's1', street: 'ul. Testowa', buildingNumber: '7', city: 'Łódź', parkingSpot: '15' }]);
    expect(source.stages).toEqual([
      { workOrderId: 'o1', name: 'Montaż', position: 2, status: 'todo' },
      { workOrderId: 'o1', name: 'Wizja', position: 1, status: 'done' },
    ]);
    const selects = engine.statements.filter((sql) => /^SELECT/.test(sql));
    expect(selects).toHaveLength(4);
    expect(selects.join('\n')).not.toMatch(/LIMIT/i);
  });

  it('EVM-103 AC6: the SQL never selects the raw `fields` column and no free-text key (title, description, phone, notes, apartment)', async () => {
    await store.readOrderListSource(true);
    const sql = engine.statements.filter((s) => s.startsWith('SELECT')).join('\n');
    expect(sql).not.toMatch(/(?<!json_extract\()\be\.fields\b/);
    for (const key of ['title', 'description', 'phone', 'email', 'notes', 'apartmentNumber', 'blockedReason', 'body']) {
      expect(sql).not.toContain(`'$.${key}'`);
    }
    // every use of the column is inside json_extract with a fixed path
    expect([...sql.matchAll(/e\.fields/g)]).toHaveLength([...sql.matchAll(/json_extract\(e\.fields, '\$\.[A-Za-z]+'\)/g)].length);
  });

  it('EVM-103 AC6: nothing the projection holds besides the allow-listed keys reaches the result', async () => {
    const source = await store.readOrderListSource(true);
    expect(JSON.stringify(source)).not.toContain(MARKER);
    expect(Object.keys(source.orders[0] ?? {}).sort()).toEqual(['createdAt', 'customerId', 'id', 'number', 'siteId', 'status']);
    expect(Object.keys(source.customers[0] ?? {}).sort()).toEqual(['displayName', 'id']);
    expect(Object.keys(source.sites[0] ?? {}).sort()).toEqual(['buildingNumber', 'city', 'id', 'parkingSpot', 'street']);
    expect(Object.keys(source.stages[0] ?? {}).sort()).toEqual(['name', 'position', 'status', 'workOrderId']);
  });

  it('EVM-103 AC5: without data only id, number, status and time of the orders are read - no customer, place, stage or link to them', async () => {
    const source = await store.readOrderListSource(false);
    expect(source.customers).toEqual([]);
    expect(source.sites).toEqual([]);
    expect(source.stages).toEqual([]);
    expect(source.orders.map((o) => o.id)).toEqual(['o1', 'o2']);
    expect(source.orders.every((o) => o.customerId === null && o.siteId === null)).toBe(true);
    const selects = engine.statements.filter((s) => s.startsWith('SELECT'));
    expect(selects).toHaveLength(1);
    expect(selects[0]).not.toMatch(/displayName|street|city|parkingSpotNumber|customerId|siteId|\$\.name|(?<!json_extract\()\be\.fields\b/);
    expect(JSON.stringify(source)).not.toMatch(/Łódź|Jan|Testowa|Montaż/);
  });

  it('EVM-103 AC1: a work order removed from the scope (tombstone) is absent, with its stages', async () => {
    await apply([{ op: 'delete', type: 'work_order', id: 'o1', version: 5 }]);
    const source = await store.readOrderListSource(true);
    expect(source.orders.map((o) => o.id)).toEqual(['o2']);
    expect(source.stages).toEqual([]);
  });

  it('EVM-103 AC1: only the active generation is read; a shadow generation under construction stays invisible until it is promoted', async () => {
    const shadow = await store.beginShadow();
    await store.applyPage({
      generation: shadow,
      ownerUserId: 'u1',
      ops: [order('o-shadow')],
      cursor: 'cursor-000000000002',
      phase: 'changes',
      complete: true,
      serverTime: Date.UTC(2026, 10, 2),
      hydrationAdd: [],
      hydrationRemove: [],
    });
    expect((await store.readOrderListSource(true)).orders.map((o) => o.id)).toEqual(['o1', 'o2']);
    await store.promoteShadow(shadow);
    expect((await store.readOrderListSource(true)).orders.map((o) => o.id)).toEqual(['o-shadow']);
  });

  it('EVM-103 AC1: odd values in the projection do not break the read (a missing time, a non-text number, a non-numeric position)', async () => {
    await apply([
      upsert('work_order', 'o-odd', { number: 42, status: null, createdAt: 'not a date', customerId: 7 }),
      upsert('procedure_stage', 'st-odd', { workOrderId: 'o-odd', name: null, position: 'x', status: null }),
    ]);
    const source = await store.readOrderListSource(true);
    expect(source.orders.find((o) => o.id === 'o-odd')).toEqual({
      id: 'o-odd',
      number: null,
      status: '',
      createdAt: 0,
      customerId: null,
      siteId: null,
    });
    expect(source.stages.find((s) => s.workOrderId === 'o-odd')).toEqual({ workOrderId: 'o-odd', name: '', position: 0, status: '' });
  });

  it('EVM-103 AC1: an empty replica is an empty source', async () => {
    const fresh = await migratedDatabase(newDisk());
    const empty = new SqlReplicaStore(fresh.db);
    expect(await empty.readOrderListSource(true)).toEqual({ orders: [], customers: [], sites: [], stages: [] });
    expect(await empty.readOrderListSource(false)).toEqual({ orders: [], customers: [], sites: [], stages: [] });
    await fresh.db.close();
    removeDisk(fresh.engine.disk);
  });
});
