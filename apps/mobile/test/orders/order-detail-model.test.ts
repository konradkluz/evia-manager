import type { QueueRecord } from '@evia/sync-core';
import { buildOrderDetail, dialNumber, type OrderDetailSource } from '../../src/orders/order-detail-model';

// EVM-104 AC1-AC5 (security K2, K5, K7, K9): the pure model of the work order details. Synthetic data only.
const T0 = Date.UTC(2026, 10, 10, 10, 0);
const MIN = 60_000;
const DAY = 86_400_000;

const baseSource = (): OrderDetailSource => ({
  order: { id: 'o1', number: 'ZL-2026-0042', title: 'Garaż — pełny proces', status: 'in_progress', customerId: 'c1', siteId: 's1' },
  customer: { id: 'c1', displayName: 'Jan Przykładowy', phone: '+48 600 000 001' },
  site: {
    id: 's1',
    street: 'ul. Testowa',
    buildingNumber: '7',
    postalCode: '00-001',
    city: 'Warszawa',
    parkingSpot: '15',
    garageLevel: '-1',
    connectionPowerKw: 40,
    managerPartyId: 'p-mgr',
    operatorPartyId: 'p-dso',
  },
  parties: [
    { id: 'p-mgr', kind: 'housing_community', displayName: 'Wspólnota Testowa' },
    { id: 'p-dso', kind: 'dso', displayName: 'Operator Testowy' },
  ],
  scopeItems: [
    { id: 'i2', position: 2, name: 'Instalacja zasilająca', quantity: null },
    { id: 'i1', position: 1, name: 'Dostawa ładowarki', quantity: 2 },
  ],
  stages: [
    {
      id: 'st3',
      procedureId: 'pr1',
      procedureName: 'Uzgodnienia z OSD',
      name: 'Warunki przyłączenia',
      position: 2,
      status: 'waiting',
      waitingOn: 'party',
      waitingPartyId: 'p-dso',
    },
    {
      id: 'st1',
      procedureId: 'pr1',
      procedureName: 'Uzgodnienia z OSD',
      name: 'Pełnomocnictwo',
      position: 1,
      status: 'done',
      waitingOn: null,
      waitingPartyId: null,
    },
    {
      id: 'st4',
      procedureId: 'pr2',
      procedureName: 'Projekt',
      name: 'Szkic',
      position: 1,
      status: 'waiting',
      waitingOn: 'customer',
      waitingPartyId: null,
    },
  ],
  entries: [
    {
      id: 'e-old',
      kind: 'note',
      noteCategory: 'phone_call',
      body: 'starszy',
      authorUserId: 'u1',
      createdAt: T0 - 2 * DAY,
      capturedAt: null,
      redactedAt: null,
    },
    {
      id: 'e-new',
      kind: 'comment',
      noteCategory: null,
      body: 'nowszy',
      authorUserId: 'u2',
      createdAt: T0 - DAY,
      capturedAt: null,
      redactedAt: null,
    },
    {
      id: 'e-ev',
      kind: 'event',
      noteCategory: null,
      body: 'Zmiana danych zlecenia: tytuł',
      authorUserId: null,
      createdAt: T0 - 3 * DAY,
      capturedAt: null,
      redactedAt: null,
    },
    {
      id: 'e-red',
      kind: 'note',
      noteCategory: 'other',
      body: 'SYNTHETIC-SECRET-BODY',
      authorUserId: 'u1',
      createdAt: T0 - 4 * DAY,
      capturedAt: null,
      redactedAt: T0 - DAY,
    },
  ],
  users: [
    { id: 'u1', displayName: 'Anna Testowa' },
    { id: 'u2', displayName: 'Piotr Testowy' },
  ],
});

const record = (over: Partial<QueueRecord> & { mutationId: string }): QueueRecord => ({
  type: 'CreateNote',
  commandVersion: 1,
  payload: {
    id: over.objectId ?? 'q-1',
    workOrderId: 'o1',
    noteCategory: 'site_visit',
    body: 'z kolejki',
    capturedAt: '2026-11-10T09:00:00.000Z',
  },
  objectId: 'q-1',
  orderingKey: 'o1',
  createdAt: T0,
  ownerUserId: 'u1',
  state: 'pending',
  attempts: 0,
  ...over,
});

const must = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
};

describe('header, customer and location (EVM-104 AC1, AC2)', () => {
  it('EVM-104 AC1: number, title and status come from the replica source', () => {
    const detail = must(buildOrderDetail(baseSource(), [], 'u1'));
    expect(detail).toMatchObject({ id: 'o1', number: 'ZL-2026-0042', title: 'Garaż — pełny proces', status: 'in_progress' });
  });

  it('EVM-104 AC2: customer name and phone, address, spot, level, power, the operator and the manager', () => {
    const detail = must(buildOrderDetail(baseSource(), [], 'u1'));
    expect(detail.customer).toEqual({ name: 'Jan Przykładowy', phone: '+48 600 000 001', dial: '+48600000001' });
    expect(detail.location).toEqual({
      street: 'ul. Testowa 7',
      city: '00-001 Warszawa',
      spot: '15',
      level: '-1',
      powerKw: '40',
      operator: 'Operator Testowy',
      manager: 'Wspólnota Testowa',
    });
  });

  it('EVM-104 AC2: a missing field is null, never an empty label (no customer, no site, blank strings)', () => {
    const source: OrderDetailSource = {
      ...baseSource(),
      customer: { id: 'c1', displayName: '', phone: '' },
      site: {
        ...must(baseSource().site),
        street: '',
        buildingNumber: '',
        postalCode: '',
        city: '',
        parkingSpot: '',
        garageLevel: '',
        connectionPowerKw: null,
        managerPartyId: null,
        operatorPartyId: 'missing',
      },
    };
    const detail = must(buildOrderDetail(source, [], 'u1'));
    expect(detail.customer).toBeNull();
    expect(detail.location).toBeNull();
    expect(must(buildOrderDetail({ ...baseSource(), customer: null, site: null }, [], 'u1'))).toMatchObject({
      customer: null,
      location: null,
    });
  });

  it('EVM-104 AC2: a customer without a phone has no call action; the model carries no e-mail, tax id, PPE, payments, notes or description', () => {
    const detail = must(buildOrderDetail({ ...baseSource(), customer: { id: 'c1', displayName: 'Jan Przykładowy', phone: '' } }, [], 'u1'));
    expect(detail.customer).toEqual({ name: 'Jan Przykładowy', phone: null, dial: null });
    const keys = JSON.stringify(detail);
    expect(keys).not.toMatch(/email|nip|ppe|payment|notes|description|contactPerson/i);
  });

  it('EVM-104 AC2 (security K7): the number to dial is a leading "+" and digits only, at most 15 digits; MMI/USSD codes and pauses are refused', () => {
    expect(dialNumber('+48 600-000-001')).toBe('+48600000001');
    expect(dialNumber('(22) 600 00 01')).toBe('226000001');
    expect(dialNumber('600.000.001')).toBe('600000001');
    expect(dialNumber('0048600000001')).toBe('0048600000001');
    for (const bad of [
      '*21*600000001#',
      '#31#600000001',
      '600000001,1',
      '600000001;1',
      '600p000001',
      '600w000001',
      '600000001p',
      'tel:600000001',
      '600 000 001 ext',
      '+48+600000001',
      '48+600000001',
      '',
      '   ',
      '+',
      '12',
      '+1234567890123456',
      '1234567890123456',
      '600\n000001',
      '٦٠٠٠٠٠٠٠١',
    ]) {
      expect(dialNumber(bad)).toBeNull();
    }
    expect(dialNumber('+123456789012345')).toBe('+123456789012345');
  });
});

describe('scope, processes and stages (EVM-104 AC3)', () => {
  it('EVM-104 AC3: scope items by position; processes by their first stage, stages by position, with the party we wait for', () => {
    const detail = must(buildOrderDetail(baseSource(), [], 'u1'));
    expect(detail.scope.map((i) => [i.name, i.quantity])).toEqual([
      ['Dostawa ładowarki', 2],
      ['Instalacja zasilająca', null],
    ]);
    expect(detail.processes.map((p) => p.name)).toEqual(['Uzgodnienia z OSD', 'Projekt']);
    expect(detail.processes[0]?.stages.map((s) => [s.name, s.status, s.waitingFor])).toEqual([
      ['Pełnomocnictwo', 'done', null],
      ['Warunki przyłączenia', 'waiting', 'Operator Testowy'],
    ]);
    // waiting for the customer: the name of the customer
    expect(detail.processes[1]?.stages[0]).toMatchObject({ status: 'waiting', waitingFor: 'Jan Przykładowy' });
  });

  it('EVM-104 AC3: no scope and no processes are empty lists (the screen shows the messages of M-03)', () => {
    const detail = must(buildOrderDetail({ ...baseSource(), scopeItems: [], stages: [] }, [], 'u1'));
    expect(detail.scope).toEqual([]);
    expect(detail.processes).toEqual([]);
  });

  it('EVM-104 AC3: a stage that is not waiting carries no waiting party even when the data has one', () => {
    const source = baseSource();
    const detail = must(buildOrderDetail({ ...source, stages: source.stages.map((s) => ({ ...s, status: 'in_progress' })) }, [], 'u1'));
    for (const process of detail.processes) for (const stage of process.stages) expect(stage.waitingFor).toBeNull();
  });
});

describe('journal and pending items (EVM-104 AC4, AC5; security K5, K9)', () => {
  it('EVM-104 AC4: entries newest first with author, kind, category and body; a corrected (redacted) entry carries no body at all', () => {
    const detail = must(buildOrderDetail(baseSource(), [], 'u1'));
    expect(detail.journal.map((j) => j.id)).toEqual(['e-new', 'e-old', 'e-ev', 'e-red']);
    expect(detail.journal[0]).toMatchObject({ kind: 'comment', author: 'Piotr Testowy', body: 'nowszy', source: 'synced', category: null });
    expect(detail.journal[1]).toMatchObject({ kind: 'note', category: 'phone_call', author: 'Anna Testowa' });
    expect(detail.journal[2]).toMatchObject({ kind: 'event', author: null });
    expect(detail.journal[3]).toMatchObject({ redacted: true, body: null });
    expect(JSON.stringify(detail)).not.toContain('SYNTHETIC-SECRET-BODY');
  });

  it('EVM-104 AC4: the time of an entry from the phone is the captured time', () => {
    const source = baseSource();
    const first = must(source.entries[0]);
    const detail = must(buildOrderDetail({ ...source, entries: [{ ...first, createdAt: T0 - DAY, capturedAt: T0 - 5 * DAY }] }, [], 'u1'));
    expect(detail.journal[0]?.at).toBe(T0 - 5 * DAY);
  });

  it('EVM-104 AC4: queue items of this order are on top (newest first) as "pending"; rejected and blocked ones need attention', () => {
    const detail = must(
      buildOrderDetail(
        baseSource(),
        [
          record({ mutationId: 'm1', objectId: 'q-1', createdAt: T0 }),
          record({
            mutationId: 'm2',
            type: 'CreateComment',
            objectId: 'q-2',
            payload: { id: 'q-2', workOrderId: 'o1', body: 'komentarz z kolejki' },
            createdAt: T0 + MIN,
            state: 'retrying',
          }),
          record({ mutationId: 'm3', objectId: 'q-3', createdAt: T0 - MIN, state: 'needs_attention' }),
          record({ mutationId: 'm4', objectId: 'q-4', createdAt: T0 - 2 * MIN, state: 'blocked' }),
        ],
        'u1',
      ),
    );
    expect(detail.journal.slice(0, 4).map((j) => [j.id, j.source, j.kind])).toEqual([
      ['q-2', 'pending', 'comment'],
      ['q-1', 'pending', 'note'],
      ['q-3', 'attention', 'note'],
      ['q-4', 'attention', 'note'],
    ]);
    expect(detail.journal[1]).toMatchObject({ body: 'z kolejki', category: 'site_visit', author: 'Anna Testowa' });
    expect(detail.journal.slice(4).every((j) => j.source === 'synced')).toBe(true);
  });

  it('EVM-104 AC4: after the send the element becomes the plain entry - a queue item whose id is already in the replica is not shown twice', () => {
    const source = baseSource();
    const first = must(source.entries[0]);
    const detail = must(
      buildOrderDetail(
        { ...source, entries: [{ ...first, id: 'q-1', body: 'z kolejki' }, ...source.entries.slice(1)] },
        [record({ mutationId: 'm1', objectId: 'q-1' })],
        'u1',
      ),
    );
    expect(detail.journal.filter((j) => j.id === 'q-1')).toHaveLength(1);
    expect(detail.journal.find((j) => j.id === 'q-1')?.source).toBe('synced');
  });

  it('EVM-104 AC4: an empty journal is an empty list', () => {
    expect(must(buildOrderDetail({ ...baseSource(), entries: [] }, [], 'u1')).journal).toEqual([]);
  });

  it('EVM-104 AC4 (security K5): only notes and comments with orderingKey = this work order count; other orders and quick work orders are ignored', () => {
    const detail = must(
      buildOrderDetail(
        baseSource(),
        [
          record({
            mutationId: 'm1',
            objectId: 'q-other',
            orderingKey: 'o2',
            payload: { id: 'q-other', workOrderId: 'o2', body: 'SYNTHETIC-OTHER-ORDER' },
          }),
          record({
            mutationId: 'm2',
            type: 'CreateQuickWorkOrder',
            objectId: 'o1',
            orderingKey: 'o1',
            payload: {
              workOrderId: 'o1',
              title: 'SYNTHETIC-QUICK-TITLE',
              newCustomer: { displayName: 'SYNTHETIC-QUICK-CUSTOMER', phone: '+48000000000' },
            },
          }),
        ],
        'u1',
      ),
    );
    expect(detail.journal.every((j) => j.source === 'synced')).toBe(true);
    expect(JSON.stringify(detail)).not.toMatch(/SYNTHETIC-OTHER-ORDER|SYNTHETIC-QUICK/);
  });

  it('EVM-104 AC4: the author of a queue item without a user in the replica is unknown (the screen says "Ty"); a body that is not text stays empty', () => {
    const detail = must(
      buildOrderDetail(
        { ...baseSource(), users: [] },
        [record({ mutationId: 'm1', objectId: 'q-1', payload: { id: 'q-1', workOrderId: 'o1', body: 42, noteCategory: 'nonsense' } })],
        'u1',
      ),
    );
    expect(detail.journal[0]).toMatchObject({ source: 'pending', author: null, body: null, category: 'nonsense' });
  });

  it('EVM-104 AC4 (security K9): the entry flagged as redacted never carries a body, also when the data still has one', () => {
    const source = baseSource();
    const red = must(source.entries[3]);
    const detail = must(buildOrderDetail({ ...source, entries: [{ ...red, body: 'SYNTHETIC-LEFTOVER' }] }, [], 'u1'));
    expect(detail.journal[0]).toMatchObject({ redacted: true, body: null });
  });
});

describe('an order that is not available (EVM-104 AC5)', () => {
  it('EVM-104 AC5: no work order in the source (outside the scope or deleted) gives no model at all - no customer, no address', () => {
    expect(buildOrderDetail(null, [record({ mutationId: 'm1' })], 'u1')).toBeNull();
  });
});

describe('edges of the model (EVM-104 AC2, AC3, AC4)', () => {
  const stage = (id: string, over: Partial<OrderDetailSource['stages'][number]>): OrderDetailSource['stages'][number] => ({
    id,
    procedureId: 'pr9',
    procedureName: 'Proces',
    name: id,
    position: 1,
    status: 'waiting',
    waitingOn: null,
    waitingPartyId: null,
    ...over,
  });

  it('EVM-104 AC2: a party that is not in the replica (or has an empty name) is no label - the operator and the manager are simply absent', () => {
    const source = baseSource();
    const detail = must(buildOrderDetail({ ...source, parties: [{ id: 'p-mgr', kind: 'x', displayName: '  ' }] }, [], 'u1'));
    expect(detail.location).toMatchObject({ operator: null, manager: null });
  });

  it('EVM-104 AC3: "Czekamy na…" names the party only when the data say whom - an unknown party, a missing id or no target give no name', () => {
    const source = baseSource();
    const stages = [
      stage('s-unknown', { position: 1, waitingOn: 'party', waitingPartyId: 'p-missing' }),
      stage('s-noid', { position: 2, waitingOn: 'party', waitingPartyId: null }),
      stage('s-none', { position: 3, waitingOn: null }),
      stage('s-other', { position: 4, waitingOn: 'something-new', waitingPartyId: 'p-dso' }),
    ];
    const detail = must(buildOrderDetail({ ...source, stages }, [], 'u1'));
    expect(detail.processes[0]?.stages.map((s) => s.waitingFor)).toEqual([null, null, null, null]);
  });

  it('EVM-104 AC4: an unknown kind is read as an event, an entry without text has no body, and entries of the same time are ordered by id', () => {
    const source = baseSource();
    const first = must(source.entries[0]);
    const same = { ...first, createdAt: T0, capturedAt: null, redactedAt: null };
    const detail = must(
      buildOrderDetail(
        {
          ...source,
          entries: [
            { ...same, id: 'b', kind: 'brand-new', body: null },
            { ...same, id: 'a', kind: 'note', body: 'x' },
          ],
        },
        [],
        'u1',
      ),
    );
    expect(detail.journal.map((j) => [j.id, j.kind, j.body])).toEqual([
      ['a', 'note', 'x'],
      ['b', 'event', null],
    ]);
  });

  it('EVM-104 AC2 (security K7): the dial number keeps one leading "+" and 5 to 15 digits only', () => {
    expect(dialNumber('+48600000001')).toBe('+48600000001');
    expect(dialNumber('1234')).toBeNull();
    expect(dialNumber('1234567890123456')).toBeNull();
    expect(dialNumber('12+3456')).toBeNull();
    expect(dialNumber('++4860000')).toBeNull();
    expect(dialNumber('')).toBeNull();
  });
});
