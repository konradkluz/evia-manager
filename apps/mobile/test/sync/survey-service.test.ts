import { createUuidV7 } from '@evia/sync-core';
import { webcrypto } from 'node:crypto';
import { buildEntryInput } from '../../src/orders/entry-form-model';
import { buildSurveyInput, EMPTY_SURVEY_DRAFT } from '../../src/orders/site-survey-model';
import { CONFIG_BODY, must, NOW, Phone, ScriptedServer, aggregate, page, settle, uid } from './harness';

// EVM-137 AC1, AC2, AC4, AC6 (+ security W5, W10): the session service with a site survey - on the real SQLCipher adapters and the stand-in
// server of EVM-107. Synthetic data only.
let phone: Phone;
beforeEach(async () => {
  phone = new Phone();
  await phone.open();
});
afterEach(() => {
  phone.close();
});

const iso = (ms: number): string => new Date(ms).toISOString();
const newId = createUuidV7(
  { now: () => NOW },
  { getRandomValues: (bytes) => (webcrypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>), bytes) },
);
const ADDRESS = /Fikcyjna|Piaseczno|05-500|600 000 011|600000011/;
const DRAFT = {
  ...EMPTY_SURVEY_DRAFT,
  city: 'Piaseczno',
  street: 'ul. Fikcyjna',
  buildingNumber: '12',
  postalCode: '05-500',
  requesterPhone: '600 000 011',
};

const withFeature = (on: boolean): ScriptedServer => {
  const server = new ScriptedServer();
  server.config = { kind: 'ok', body: { ...CONFIG_BODY, features: { siteSurveys: on } } };
  server.changes.push(page([...aggregate(1)], { phase: 'snapshot', cursor: 1 }), page([], { cursor: 2 }));
  return server;
};
async function started(server: ScriptedServer) {
  const service = phone.service(server);
  await service.start();
  await settle();
  phone.clockNow += 5_000;
  return service;
}
const surveyCommand = () => {
  const built = buildSurveyInput(DRAFT, newId);
  if (!built.ok) throw new Error('the draft must be valid');
  return built;
};
const rejectWith = (server: ScriptedServer, code: string) => {
  server.pushScript.push(() => {
    const request = server.pushes[server.pushes.length - 1];
    const results = (request?.mutations ?? []).map((m) => ({ mutationId: m.mutationId, outcome: 'rejected', code }));
    return { kind: 'ok', body: { serverTime: iso(NOW), results } };
  });
};
/** The server announces a survey of the technician (a work order without a client and with a term). */
const serverHasSurvey = (server: ScriptedServer, id: string, cursorAt: number, version = 1) =>
  server.changes.push(
    page(
      [
        {
          op: 'upsert',
          entity: {
            type: 'work_order',
            id,
            version,
            number: 'ZL-2026-0051',
            title: 'Wizja lokalna',
            status: 'quoting',
            customerId: null,
            siteId: null,
            coordinatorUserId: null,
            description: null,
            plannedDate: null,
            createdAt: iso(NOW - 86_400_000),
            closedAt: null,
            siteSurvey: { expiresAt: iso(NOW + 89 * 86_400_000), extensionCount: 0, requesterPhone: null },
          },
        },
      ],
      { cursor: cursorAt },
    ),
  );

describe('the switch of the feature (EVM-137 AC1)', () => {
  it('EVM-137 AC1: before the first download the action is off; after a download with the switch on it is on - and stays on offline and after a restart', async () => {
    const server = withFeature(true);
    const service = phone.service(server);
    expect(await service.features()).toEqual({ siteSurveys: false });
    await service.start();
    await settle();
    expect(await service.features()).toEqual({ siteSurveys: true });
    service.dispose();
    await phone.restart();
    phone.online = false;
    server.down = true;
    const again = phone.service(server);
    expect(await again.features()).toEqual({ siteSurveys: true });
  });

  it('EVM-137 AC1: a server that switched it off (or does not know it) leaves the action off', async () => {
    expect(await (await started(withFeature(false))).features()).toEqual({ siteSurveys: false });
    const old = new ScriptedServer();
    old.changes.push(page([...aggregate(1)], { phase: 'snapshot', cursor: 1 }), page([], { cursor: 2 }));
    expect(await (await started(old)).features()).toEqual({ siteSurveys: false });
  });
});

describe('a survey saved without the network (EVM-137 AC2, AC4, W5)', () => {
  it('EVM-137 AC2: the command is in the durable queue; the list shows "Oczekuje na numer"; the details open with the address; nothing goes out offline', async () => {
    phone.online = false;
    const server = withFeature(true);
    const service = await started(server);
    const built = surveyCommand();
    expect(await service.enqueue(built.input)).toMatchObject({ ok: true });
    const rows = await service.orderList(true);
    expect(rows.find((r) => r.id === built.workOrderId)).toMatchObject({
      number: null,
      awaitingNumber: true,
      unsent: true,
      street: '',
      survey: {},
    });
    const detail = must(await service.orderDetail(built.workOrderId));
    expect(detail).toMatchObject({ awaitingNumber: true, customer: null, survey: { requesterPhone: '600 000 011', dial: '600000011' } });
    expect(detail.location).toMatchObject({ street: 'ul. Fikcyjna 12' });
    expect(server.pushes).toHaveLength(0);
  });

  it('EVM-137 AC2: after a kill the survey is still there, and when the network returns the server gets it once and the number arrives with no second row', async () => {
    phone.online = false;
    const server = withFeature(true);
    const first = await started(server);
    const built = surveyCommand();
    await first.enqueue(built.input);
    first.dispose();
    await phone.restart();
    const second = phone.service(server);
    await second.start();
    await settle();
    expect((await second.orderList(true)).map((r) => r.id)).toContain(built.workOrderId);
    phone.online = true;
    serverHasSurvey(server, built.workOrderId, 3);
    second.setOnline(true);
    await settle();
    for (let i = 0; i < 4; i += 1) {
      phone.clockNow += 10 * 60_000;
      await phone.timers.fireAll();
      second.trigger();
      await settle();
    }
    expect([...server.applied.values()]).toEqual([1]);
    const rows = (await second.orderList(true)).filter((r) => r.id === built.workOrderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ number: 'ZL-2026-0051', awaitingNumber: false, unsent: false });
  });

  it('EVM-137 AC4 W5: the queue shows the survey without a label and without a copy action, and nothing of the address reaches the diagnostics or the log', async () => {
    phone.online = false;
    const logs: unknown[] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args);
      }),
    );
    try {
      const server = withFeature(true);
      const service = await started(server);
      const built = surveyCommand();
      await service.enqueue(built.input);
      phone.online = true;
      rejectWith(server, 'validation_failed');
      service.setOnline(true);
      await settle();
      const item = must((await service.queueView(true)).items.find((i) => i.type === 'CreateSiteSurvey'));
      expect(item).toMatchObject({
        label: null,
        targetId: null,
        state: 'attention',
        reason: 'validation_failed_survey',
        actions: ['discard'],
      });
      expect(await service.copyText(item.id)).toBeNull();
      expect(JSON.stringify(item)).not.toMatch(ADDRESS);
      expect(JSON.stringify(phone.diagnostics)).not.toMatch(ADDRESS);
      expect(JSON.stringify(logs)).not.toMatch(ADDRESS);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe('the server rejects the survey or deletes it (EVM-137 AC6, W10)', () => {
  it('EVM-137 AC6: feature_disabled -> "Wymaga uwagi" with only "Usuń z telefonu"; the entry behind it is one group; "Usuń" removes both; nothing is resent', async () => {
    phone.online = false;
    const server = withFeature(true);
    const service = await started(server);
    const built = surveyCommand();
    await service.enqueue(built.input);
    const detail = must(await service.orderDetail(built.workOrderId));
    const entry = buildEntryInput(
      {
        kind: 'note',
        workOrderId: built.workOrderId,
        category: 'arrangement',
        stageId: null,
        stages: [],
        body: 'Garaż od podwórza.',
        parentMutationId: detail.pendingMutationId ?? null,
      },
      phone.clockNow,
      newId,
    );
    if (!entry.ok) throw new Error('entry');
    await service.enqueue(entry.input);
    phone.online = true;
    rejectWith(server, 'feature_disabled');
    service.setOnline(true);
    await settle();
    const view = await service.queueView(true);
    const root = must(view.items.find((i) => i.type === 'CreateSiteSurvey'));
    expect(root).toMatchObject({ state: 'attention', reason: 'feature_disabled', actions: ['discard'], dependents: 1 });
    const sent = server.pushes.length;
    for (let i = 0; i < 3; i += 1) {
      phone.clockNow += 10 * 60_000;
      await phone.timers.fireAll();
      service.trigger();
      await settle();
    }
    expect(server.pushes).toHaveLength(sent);
    expect(await service.discard(root.id)).toMatchObject({ ok: true, dependents: 1 });
    expect((await service.queueView(true)).items).toHaveLength(0);
    expect((await service.orderList(true)).some((r) => r.id === built.workOrderId)).toBe(false);
  });

  it('EVM-137 AC6 W10: the survey was marked, then the server deleted it - a note for it is rejected and offers only "Usuń z telefonu" (no move to another order, no copy)', async () => {
    const server = withFeature(true);
    const surveyId = '3a000000-0000-4000-8000-0000000000e1';
    serverHasSurvey(server, surveyId, 3);
    const service = await started(server);
    service.trigger();
    await settle();
    // the survey of the replica is marked after the cycle ...
    expect(await phone.marks.read()).toContain(surveyId);
    // ... the server deletes it
    server.changes.push(page([{ op: 'delete', type: 'work_order', id: surveyId, version: 2 }], { cursor: 4 }));
    phone.clockNow += 5_000;
    service.trigger();
    await settle();
    expect((await service.orderList(true)).some((r) => r.id === surveyId)).toBe(false);
    // a note typed while the survey was still known reaches the server after it was deleted
    rejectWith(server, 'target_unavailable');
    const note = buildEntryInput(
      {
        kind: 'note',
        workOrderId: surveyId,
        category: 'arrangement',
        stageId: null,
        stages: [],
        body: 'Wpis do wizji.',
        parentMutationId: null,
      },
      phone.clockNow,
      newId,
    );
    if (!note.ok) throw new Error('entry');
    phone.clockNow += 5_000;
    await service.enqueue(note.input);
    await settle();
    await phone.timers.fireAll();
    const item = must((await service.queueView(true)).items.find((i) => i.type === 'CreateNote'));
    expect(item).toMatchObject({ state: 'attention', reason: 'survey_entry_unavailable', actions: ['discard'] });
    expect(await service.retarget(item.id, uid('work_order', 1))).toMatchObject({ ok: false });
    expect((await service.queueView(true)).items).toHaveLength(1);
    // an ordinary order is as before: the same rejection offers the three actions
    const ordinary = buildEntryInput(
      {
        kind: 'note',
        workOrderId: uid('work_order', 1),
        category: 'arrangement',
        stageId: null,
        stages: [],
        body: 'Zwykły wpis.',
        parentMutationId: null,
      },
      phone.clockNow,
      newId,
    );
    if (!ordinary.ok) throw new Error('entry');
    rejectWith(server, 'target_unavailable');
    phone.clockNow += 5_000;
    await service.enqueue(ordinary.input);
    await settle();
    await phone.timers.fireAll();
    const plain = must((await service.queueView(true)).items.find((i) => i.targetId === uid('work_order', 1)));
    expect(plain.actions).toEqual(['retarget', 'copy', 'discard']);
  });

  it('EVM-137 W10: the mark is written with the command of the phone itself, so a survey created on the phone is protected even if it never reached the replica', async () => {
    phone.online = false;
    const service = await started(withFeature(true));
    const built = surveyCommand();
    await service.enqueue(built.input);
    expect(await phone.marks.read()).toEqual([built.workOrderId]);
  });
});
