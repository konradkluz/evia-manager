import { describe, expect, it } from 'vitest';
import { FakeServer, InMemoryQueueStore, WORK_ORDER, makeCore, noteInput } from './helpers.ts';

const survey = {
  type: 'CreateSiteSurvey',
  commandVersion: 1,
  payload: {
    workOrderId: WORK_ORDER,
    newSite: {
      id: '0194c2a0-0000-7000-8000-0000000000cc',
      siteType: 'other',
      street: 'ul. Fikcyjna',
      buildingNumber: '5',
      postalCode: '05-500',
      city: 'Piaseczno',
    },
  },
};

describe('queue and engine: a site survey (EVM-137 AC2, AC6, W10)', () => {
  it('EVM-137 AC2: the survey is the root of its work order - the key of the queue is workOrderId and a note waits behind it', async () => {
    const { core, store, server } = makeCore();
    const root = await core.queue.enqueue(survey);
    expect(root).toMatchObject({ type: 'CreateSiteSurvey', objectId: WORK_ORDER, orderingKey: WORK_ORDER, state: 'pending' });
    const note = await core.queue.enqueue({ ...noteInput(), parentMutationId: root.mutationId });
    await core.engine.flush();
    expect(server.appliedOrder).toEqual([root.mutationId, note.mutationId]);
    expect(store.records()).toHaveLength(0);
  });

  it('EVM-137 AC2: after a kill (a new core on the same store) the survey is still in the queue and goes out once', async () => {
    const store = new InMemoryQueueStore();
    const server = new FakeServer();
    const first = makeCore({ store, server });
    const root = await first.core.queue.enqueue(survey);
    const again = makeCore({ store, server });
    expect(store.records().map((r) => r.mutationId)).toEqual([root.mutationId]);
    await again.core.engine.flush();
    expect(server.appliedOrder).toEqual([root.mutationId]);
  });

  it('EVM-137 AC2: a lost answer (the server applied, the phone did not hear) ends in "duplicate", never in a second survey', async () => {
    const { core, store, server, clock } = makeCore();
    const root = await core.queue.enqueue(survey);
    server.loseNextResponse = true;
    await core.engine.flush();
    expect(store.records()).toHaveLength(1);
    clock.ms = (await core.engine.status()).nextAttemptAt ?? clock.ms;
    await core.engine.flush();
    expect(server.appliedOrder).toEqual([root.mutationId]);
    expect(store.settled.map((s) => s.info.outcome)).toEqual(['duplicate']);
    expect(store.records()).toHaveLength(0);
  });

  it('EVM-137 AC6: the server rejects the survey with feature_disabled: it needs attention, what waits behind it is blocked, nothing goes out again', async () => {
    const { core, store, server } = makeCore();
    const root = await core.queue.enqueue(survey);
    const note = await core.queue.enqueue({ ...noteInput(), parentMutationId: root.mutationId });
    server.rejectCodes.set(root.mutationId, 'feature_disabled');
    await core.engine.flush();
    expect(store.records().find((r) => r.mutationId === root.mutationId)).toMatchObject({
      state: 'needs_attention',
      lastCode: 'feature_disabled',
    });
    expect(store.records().find((r) => r.mutationId === note.mutationId)).toMatchObject({
      state: 'blocked',
      lastCode: 'parent_unavailable',
    });
    const sent = server.requests.length;
    for (let i = 0; i < 5; i += 1) await core.engine.flush();
    expect(server.requests).toHaveLength(sent);
    expect(await core.attention.discard(root.mutationId)).toEqual({ removed: 2, dependents: 1 });
    expect(store.records()).toHaveLength(0);
  });

  it('EVM-137 AC6 W10: an unknown code of the server (one a newer server may add) is kept as "unknown" and the survey stops, with no endless retry', async () => {
    const { core, store, server } = makeCore();
    const root = await core.queue.enqueue(survey);
    server.rejectCodes.set(root.mutationId, 'a_code_of_a_newer_server');
    await core.engine.flush();
    expect(store.records()[0]).toMatchObject({ state: 'needs_attention', lastCode: 'unknown' });
    const sent = server.requests.length;
    await core.engine.flush();
    expect(server.requests).toHaveLength(sent);
  });

  it('EVM-140 AC4: the limit of open site surveys is a known code - kept as it is, the survey stops and is not resent', async () => {
    const { core, store, server } = makeCore();
    const root = await core.queue.enqueue(survey);
    server.rejectCodes.set(root.mutationId, 'site_survey_limit_exceeded');
    await core.engine.flush();
    expect(store.records()[0]).toMatchObject({ state: 'needs_attention', lastCode: 'site_survey_limit_exceeded' });
    const sent = server.requests.length;
    for (let i = 0; i < 5; i += 1) await core.engine.flush();
    expect(server.requests).toHaveLength(sent);
  });

  it('EVM-137 AC6 W10: a note for a survey the server deleted (target_unavailable after the survey was applied) stops and is not resent', async () => {
    const { core, store, server } = makeCore();
    const note = await core.queue.enqueue(noteInput());
    server.rejectCodes.set(note.mutationId, 'target_unavailable');
    await core.engine.flush();
    expect(store.records()[0]).toMatchObject({ state: 'needs_attention', lastCode: 'target_unavailable' });
    const sent = server.requests.length;
    for (let i = 0; i < 5; i += 1) await core.engine.flush();
    expect(server.requests).toHaveLength(sent);
  });

  it('EVM-137 AC6 W10: "Dodaj do innego zlecenia" is refused for the survey and for the items of a survey order', async () => {
    const { core, server } = makeCore();
    const other = '0194c2a0-0000-7000-8000-0000000000dd';
    const root = await core.queue.enqueue(survey);
    server.rejectCodes.set(root.mutationId, 'feature_disabled');
    await core.engine.flush();
    await expect(core.attention.retarget(root.mutationId, { workOrderId: other, isVisibleWorkOrder: () => true })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    const note = await core.queue.enqueue(noteInput('0194c2a0-0000-7000-8000-0000000000ee'));
    server.rejectCodes.set(note.mutationId, 'target_unavailable');
    await core.engine.flush();
    const surveys = new Set(['0194c2a0-0000-7000-8000-0000000000ee']);
    await expect(
      core.attention.retarget(note.mutationId, {
        workOrderId: other,
        isVisibleWorkOrder: () => true,
        isSurveyOrder: (id) => surveys.has(id),
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    // without the mark the same note of an ordinary order can still be moved (no regression)
    const moved = await core.attention.retarget(note.mutationId, {
      workOrderId: other,
      isVisibleWorkOrder: () => true,
      isSurveyOrder: () => false,
    });
    expect(moved.orderingKey).toBe(other);
  });

  it('EVM-137 AC2: the diagnostics of a survey carry ids and codes only - no address, no phone number', async () => {
    const { core, server, events } = makeCore();
    const root = await core.queue.enqueue({ ...survey, payload: { ...survey.payload, requesterPhone: '+48600000011' } });
    server.rejectCodes.set(root.mutationId, 'validation_failed');
    await core.engine.flush();
    const text = JSON.stringify(events);
    for (const secret of ['Fikcyjna', 'Piaseczno', '05-500', '600000011']) expect(text).not.toContain(secret);
  });
});
