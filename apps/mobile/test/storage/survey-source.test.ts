import type { ReplicaOp } from '@evia/sync-core';
import type { Database } from '../../src/storage/database';
import { SqlReplicaStore } from '../../src/storage/replica-store';
import { MAX_SURVEY_MARKS, SqlSurveyMarks } from '../../src/storage/survey-marks';
import { migratedDatabase } from './harness';
import { newDisk, removeDisk, type NodeSqliteEngine, type TestDisk } from './node-sqlite-engine';

// EVM-137 AC1, AC4, AC7, W10: what the replica gives the list and the details of a survey, the switch of the feature and the marks.
let disk: TestDisk;
let engine: NodeSqliteEngine;
let store: SqlReplicaStore;
let marks: SqlSurveyMarks;
let database: Database;
let generation: number;

const upsert = (type: string, id: string, fields: Record<string, unknown>, version = 1): ReplicaOp =>
  ({ op: 'upsert', entity: { type, id, version, fields } }) as ReplicaOp;
const order = (id: string, extra: Record<string, unknown> = {}, version = 1): ReplicaOp =>
  upsert(
    'work_order',
    id,
    {
      number: `ZL-${id}`,
      title: 'Wizja lokalna',
      status: 'quoting',
      customerId: null,
      siteId: 's1',
      coordinatorUserId: null,
      description: null,
      plannedDate: null,
      createdAt: '2026-11-10T08:00:00.000Z',
      closedAt: null,
      siteSurvey: null,
      ...extra,
    },
    version,
  );
const survey = { expiresAt: '2027-02-08T08:00:00.000Z', extensionCount: 1, requesterPhone: '+48 600 000 011' };
const ID = (n: number) => `3a000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function apply(ops: ReplicaOp[]): Promise<void> {
  await store.applyPage({
    generation,
    ownerUserId: 'u1',
    ops,
    cursor: 'cursor-000000000001',
    phase: 'changes',
    complete: true,
    serverTime: Date.UTC(2026, 10, 16),
    hydrationAdd: [],
    hydrationRemove: [],
  });
}

beforeEach(async () => {
  disk = newDisk();
  const migrated = await migratedDatabase(disk);
  engine = migrated.engine;
  store = new SqlReplicaStore(migrated.db);
  database = migrated.db;
  marks = new SqlSurveyMarks(migrated.db);
  generation = (await store.loadState()).active.generation;
  await apply([
    order('o1', { siteSurvey: survey }),
    order('o2', { customerId: 'c1', status: 'in_progress' }),
    upsert('customer', 'c1', { kind: 'person', displayName: 'Jan Przykładowy', phone: '+48 600 000 001' }),
    upsert('site', 's1', {
      siteType: 'other',
      street: 'ul. Fikcyjna',
      buildingNumber: '12',
      apartmentNumber: null,
      postalCode: '05-500',
      city: 'Piaseczno',
      parkingSpotNumber: null,
      garageLevel: null,
      connectionPowerKw: null,
      notes: null,
    }),
  ]);
});
afterEach(() => {
  removeDisk(disk);
});

describe('a survey in the sources of the list and the details (EVM-137 AC4, AC7)', () => {
  it('EVM-137 AC4: the list source carries the term of a survey (and only the term - not the phone); an ordinary order has no such key', async () => {
    const source = await store.readOrderListSource(true);
    const [first, second] = source.orders;
    expect(first?.survey).toEqual({ expiresAt: Date.parse(survey.expiresAt), extensionCount: 1 });
    expect(JSON.stringify(source)).not.toContain('600 000 011');
    expect(second).not.toHaveProperty('survey');
  });

  it('EVM-137 AC4 W9: in the hidden-data mode the survey is not read at all (no term, no key of it in the SQL)', async () => {
    engine.statements.length = 0;
    const source = await store.readOrderListSource(false);
    expect(source.orders.every((o) => !('survey' in o))).toBe(true);
    expect(engine.statements.join('\n')).not.toContain('siteSurvey');
  });

  it('EVM-137 AC4: the details source carries the term and the phone of the requester of a survey, nothing for an ordinary order', async () => {
    const detail = await store.readOrderDetailSource('o1');
    expect(detail?.order.survey).toEqual({ expiresAt: Date.parse(survey.expiresAt), extensionCount: 1, requesterPhone: '+48 600 000 011' });
    expect((await store.readOrderDetailSource('o2'))?.order).not.toHaveProperty('survey');
  });

  it('EVM-137 AC7: after the office assigned a client (an upsert with siteSurvey null) the survey is gone from both sources', async () => {
    await apply([order('o1', { customerId: 'c1', status: 'accepted', siteSurvey: null }, 2)]);
    expect((await store.readOrderListSource(true)).orders.find((o) => o.id === 'o1')).not.toHaveProperty('survey');
    expect((await store.readOrderDetailSource('o1'))?.order).not.toHaveProperty('survey');
  });

  it('EVM-137 W10: the ids of the open surveys of the replica (to be marked); a deleted survey is not listed any more', async () => {
    expect(await store.readSurveyOrderIds()).toEqual(['o1']);
    await store.applyPage({
      generation,
      ownerUserId: 'u1',
      ops: [{ op: 'delete', type: 'work_order', id: 'o1', version: 2 }],
      cursor: 'cursor-000000000003',
      phase: 'changes',
      complete: true,
      serverTime: Date.UTC(2026, 10, 18),
      hydrationAdd: [],
      hydrationRemove: [],
    });
    expect(await store.readSurveyOrderIds()).toEqual([]);
  });
});

describe('the switch of the feature (EVM-137 AC1)', () => {
  it('EVM-137 AC1: the stored config is read offline as it was saved; never downloaded = null', async () => {
    expect(await store.readClientConfig()).toBeNull();
    await store.saveConfig({ offlineContactWindowDays: 7, features: { siteSurveys: true }, fetchedAt: 1 });
    expect(await store.readClientConfig()).toMatchObject({ features: { siteSurveys: true } });
  });
});

describe('the marks of surveys (EVM-137 W10)', () => {
  it('EVM-137 W10: a mark is kept after the survey left the replica and is not duplicated', async () => {
    await marks.add([ID(1), ID(2)]);
    await marks.add([ID(2), ID(3)]);
    expect(await marks.read()).toEqual([ID(1), ID(2), ID(3)]);
  });

  it('EVM-137 W10: only UUIDs are marked (no free text goes into the document), nothing is written when nothing is new', async () => {
    await marks.add(['ul. Fikcyjna 12', '', ID(1)]);
    expect(await marks.read()).toEqual([ID(1)]);
    engine.statements.length = 0;
    await marks.add([ID(1)]);
    await marks.add(['not an id']);
    expect(engine.statements.filter((sql) => /^(INSERT|UPDATE)/.test(sql))).toHaveLength(0);
  });

  it('EVM-137 W10: the newest marks are kept up to the limit', async () => {
    const many = Array.from({ length: MAX_SURVEY_MARKS + 5 }, (_, i) => ID(i + 1));
    await marks.add(many);
    const kept = await marks.read();
    expect(kept).toHaveLength(MAX_SURVEY_MARKS);
    expect(kept[0]).toBe(ID(6));
    expect(kept.at(-1)).toBe(ID(MAX_SURVEY_MARKS + 5));
  });

  it('EVM-137 W10: a damaged document reads as empty and the next add repairs it', async () => {
    await database.transaction((tx) => tx.run("INSERT INTO meta (key, value) VALUES ('survey_orders', 'not json')"));
    expect(await marks.read()).toEqual([]);
    await marks.add([ID(1)]);
    expect(await marks.read()).toEqual([ID(1)]);
  });
});
