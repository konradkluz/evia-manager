import { createUuidV7 } from '@evia/sync-core';
import { webcrypto } from 'node:crypto';
import { buildEntryInput } from '../../src/orders/entry-form-model';
import { buildSurveyInput, EMPTY_SURVEY_DRAFT } from '../../src/orders/site-survey-model';
import { CONFIG_BODY, must, NOW, Phone, ScriptedServer, aggregate, page, settle } from './harness';

// EVM-137 AC6, W10: the view of the queue - the commands of the files are not rows of it (the files are, with their own state), a group of a
// survey can be summed up for the dialog, and what a discarded group leaves behind is handed to the files. Synthetic data only.
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
const DRAFT = { ...EMPTY_SURVEY_DRAFT, city: 'Piaseczno', street: 'ul. Fikcyjna', buildingNumber: '12', postalCode: '05-500' };

async function offlineService(extra: Parameters<Phone['service']>[1] = {}) {
  const server = new ScriptedServer();
  server.config = { kind: 'ok', body: { ...CONFIG_BODY, features: { siteSurveys: true } } };
  server.changes.push(page([...aggregate(1)], { phase: 'snapshot', cursor: 1 }), page([], { cursor: 2 }));
  const service = phone.service(server, extra);
  await service.start();
  await settle();
  phone.online = false;
  phone.clockNow += 5_000;
  return { server, service };
}
const mediaInput = (workOrderId: string, mediaType: 'photo' | 'video', parent: string) => ({
  type: 'CreateMediaAsset' as const,
  commandVersion: 1,
  parentMutationId: parent,
  payload: { id: newId(), workOrderId, mediaType, category: 'site_survey' },
});
async function surveyWithItems(service: Awaited<ReturnType<typeof offlineService>>['service']) {
  const built = buildSurveyInput(DRAFT, newId);
  if (!built.ok) throw new Error('draft');
  const root = idOf(await service.enqueue(built.input));
  for (const type of ['photo', 'photo', 'video'] as const) await service.enqueue(mediaInput(built.workOrderId, type, root));
  const note = buildEntryInput(
    {
      kind: 'note',
      workOrderId: built.workOrderId,
      category: 'arrangement',
      stageId: null,
      stages: [],
      body: 'Wpis',
      parentMutationId: root,
    },
    phone.clockNow,
    newId,
  );
  if (!note.ok) throw new Error('note');
  await service.enqueue(note.input);
  return { built, root };
}
const idOf = (result: { ok: boolean; mutationId?: string }): string => {
  if (!result.ok || result.mutationId === undefined) throw new Error('not enqueued');
  return result.mutationId;
};
const rejectAll = (server: ScriptedServer, code: string) =>
  server.pushScript.push(() => {
    const request = server.pushes[server.pushes.length - 1];
    return {
      kind: 'ok',
      body: {
        serverTime: iso(NOW),
        results: (request?.mutations ?? []).map((m) => ({ mutationId: m.mutationId, outcome: 'rejected', code })),
      },
    };
  });

describe('the view of the queue without the commands of the files (EVM-137 AC6)', () => {
  it('EVM-137 AC6: a survey with two photos, a film and an entry is ONE row in the queue (3 files and 1 entry wait behind it); the commands of the files are not rows', async () => {
    const { service } = await offlineService();
    const { root } = await surveyWithItems(service);
    const view = await service.queueView(true);
    expect(view.items.map((item) => item.type).sort()).toEqual(['CreateSiteSurvey']);
    expect(view.items.some((item) => item.type === 'CreateMediaAsset')).toBe(false);
    const survey = must(view.items.find((item) => item.id === root));
    expect(survey.dependents).toBe(4);
  });

  it('EVM-137 AC6: the counts of the queue (the capsule "Offline · n") still count the commands of the files - nothing is hidden from the number', async () => {
    const { service } = await offlineService();
    await surveyWithItems(service);
    expect(service.getSnapshot().counts.unsent).toBe(5);
  });

  it('EVM-137 AC6: the summary of the group for the dialog: 2 photos, 1 film, 1 entry (4 elements)', async () => {
    const { service } = await offlineService();
    const { root } = await surveyWithItems(service);
    expect(await service.groupSummary(root)).toEqual({ photos: 2, videos: 1, entries: 1, total: 4 });
    expect(await service.groupSummary('0194c2a0-0000-7000-8000-0000000000ff')).toEqual({ photos: 0, videos: 0, entries: 0, total: 0 });
  });

  it('EVM-137 AC6 W10: "Usuń z telefonu" on the survey tells the files which commands were removed with it (so no file stays on the disk without a command)', async () => {
    const removed: string[][] = [];
    const { server, service } = await offlineService({
      onGroupDiscarded: (ids) => {
        removed.push([...ids]);
      },
    });
    const { root } = await surveyWithItems(service);
    phone.online = true;
    rejectAll(server, 'feature_disabled');
    service.setOnline(true);
    await settle();
    const media = (await phone.queue.readAll())
      .filter((r) => (r as { type: string }).type === 'CreateMediaAsset')
      .map((r) => (r as { mutationId: string }).mutationId);
    expect(media).toHaveLength(3);
    expect(await service.discard(root)).toMatchObject({ ok: true, dependents: 4 });
    expect(removed).toHaveLength(1);
    expect(removed[0]?.sort()).toEqual([...media].sort());
    expect(await phone.queue.readAll()).toEqual([]);
  });

  it('EVM-137 AC6: discarding a group without files reports no file commands', async () => {
    const removed: string[][] = [];
    const { server, service } = await offlineService({
      onGroupDiscarded: (ids) => {
        removed.push([...ids]);
      },
    });
    const built = buildSurveyInput(DRAFT, newId);
    if (!built.ok) throw new Error('draft');
    const root = idOf(await service.enqueue(built.input));
    phone.online = true;
    rejectAll(server, 'validation_failed');
    service.setOnline(true);
    await settle();
    await service.discard(root);
    expect(removed.flat()).toEqual([]);
  });
});

describe('a file of a survey that waits is its dependent (EVM-137 AC3, AC6)', () => {
  it('EVM-137 AC3: a file command saved without a parent while the survey still waits goes behind it - the group counts it and a rejected survey holds it back', async () => {
    const { server, service } = await offlineService();
    const built = buildSurveyInput(DRAFT, newId);
    if (!built.ok) throw new Error('draft');
    const root = idOf(await service.enqueue(built.input));
    // the camera does not know the survey command: it saves the file by the order id only
    await service.enqueue({
      type: 'CreateMediaAsset',
      commandVersion: 1,
      payload: { id: newId(), workOrderId: built.workOrderId, mediaType: 'photo', category: 'site_survey' },
    });
    expect(await service.groupSummary(root)).toEqual({ photos: 1, videos: 0, entries: 0, total: 1 });
    expect(must((await service.queueView(true)).items.find((i) => i.id === root)).dependents).toBe(1);
    phone.online = true;
    rejectAll(server, 'feature_disabled');
    service.setOnline(true);
    await settle();
    const [media] = (await phone.queue.readAll()).filter((r) => (r as { type: string }).type === 'CreateMediaAsset') as {
      state: string;
      lastCode?: string;
    }[];
    expect(media).toMatchObject({ state: 'blocked', lastCode: 'parent_unavailable' });
  });

  it('EVM-137 AC3: a file of an ordinary order (or of a survey that is already on the server) keeps no parent - nothing changes for it', async () => {
    const { service } = await offlineService();
    await service.enqueue({
      type: 'CreateMediaAsset',
      commandVersion: 1,
      payload: { id: newId(), workOrderId: '0194c2a0-0000-7000-8000-0000000000ee', mediaType: 'photo', category: 'other' },
    });
    const [media] = (await phone.queue.readAll()) as { parentMutationId?: string }[];
    expect(media?.parentMutationId).toBeUndefined();
  });
});
