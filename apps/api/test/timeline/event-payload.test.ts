import { describe, expect, it } from 'vitest';
import {
  JOURNAL_EVENT_CODES,
  readJournalEvent,
  toJournalEvent,
  UNKNOWN_EVENT_CODE,
  type JournalSourceEvent,
} from '../../src/modules/timeline/domain/event-payload.ts';

const ORDER = '0198b0a0-0000-7000-8000-000000000001';
const STAGE = '0198b0a0-0000-7000-8000-000000000002';
const PARTY = '0198b0a0-0000-7000-8000-000000000003';
const USER = '0198b0a0-0000-7000-8000-000000000004';
const actor = { type: 'user', userId: USER } as const;

const stageBase = { actor, outcome: 'success', objectType: 'procedure_stage', objectId: STAGE, workOrderId: ORDER } as const;

describe('journal event payloads (EVM-038 AC1, AC2; SR-LOG-03, SR-DATA-01)', () => {
  it('EVM-038 AC1 every source event becomes ONE entry with the code, the order, the stage and the actor', () => {
    const cases: Array<[JournalSourceEvent, string, string | null]> = [
      [{ type: 'work_order.created', actor, outcome: 'success', objectType: 'work_order', objectId: ORDER }, 'work_order_created', null],
      [
        {
          type: 'work_order.status_changed',
          actor,
          outcome: 'success',
          objectType: 'work_order',
          objectId: ORDER,
          fromStatus: 'new',
          toStatus: 'on_hold',
        },
        'work_order_status_changed',
        null,
      ],
      [
        {
          ...stageBase,
          type: 'procedure_stage.status_changed',
          fromStatus: 'todo',
          toStatus: 'in_progress',
          waitingOn: null,
          waitingOnPartyId: null,
        },
        'stage_status_changed',
        STAGE,
      ],
      [
        { ...stageBase, type: 'procedure_stage.waiting_on_changed', waitingOn: 'party', waitingOnPartyId: PARTY },
        'stage_waiting_on_changed',
        STAGE,
      ],
      [{ ...stageBase, type: 'procedure_stage.fields_changed', changedFields: ['dueDate'] }, 'stage_updated', STAGE],
    ];
    expect(cases.map(([, code]) => code).sort()).toEqual([...JOURNAL_EVENT_CODES].sort());
    for (const [event, code, stageId] of cases) {
      expect(toJournalEvent(event)).toMatchObject({ code, workOrderId: ORDER, procedureStageId: stageId, actorUserId: USER });
    }
  });

  it('EVM-038 AC2 the payload holds only codes, the object and the names of the fields — never a reason, a name, a date or a value', () => {
    // a publisher that put extra data into the event cannot get it into the payload: the parsed object is what is written
    const noisy = {
      ...stageBase,
      type: 'procedure_stage.fields_changed',
      changedFields: ['responsibleUserId', 'dueDate'],
      dueDate: '2026-12-01',
      responsibleDisplayName: 'Anna Testowa',
      blockedReason: 'Brak zgody sąsiada',
    } as unknown as JournalSourceEvent;
    const { payload } = toJournalEvent(noisy);
    expect(payload).toEqual({ objectType: 'procedure_stage', objectId: STAGE, changedFields: ['responsibleUserId', 'dueDate'] });
    expect(JSON.stringify(payload)).not.toMatch(/2026-12-01|Anna|Brak zgody/);

    const waiting = toJournalEvent({
      ...stageBase,
      type: 'procedure_stage.status_changed',
      fromStatus: 'in_progress',
      toStatus: 'waiting',
      waitingOn: 'party',
      waitingOnPartyId: PARTY,
    });
    expect(Object.keys(waiting.payload).sort()).toEqual(
      ['fromStatus', 'objectId', 'objectType', 'toStatus', 'waitingOn', 'waitingOnPartyId'].sort(),
    );
  });

  it('EVM-038 AC5 a payload that does not fit the schema of its code is refused (fail closed)', () => {
    const badStatus = {
      ...stageBase,
      type: 'procedure_stage.status_changed',
      fromStatus: 'todo',
      toStatus: 'Brak zgody sąsiada',
      waitingOn: null,
      waitingOnPartyId: null,
    } as unknown as JournalSourceEvent;
    expect(() => toJournalEvent(badStatus)).toThrow();
    const noFields = { ...stageBase, type: 'procedure_stage.fields_changed', changedFields: [] } as JournalSourceEvent;
    expect(() => toJournalEvent(noFields)).toThrow();
    const notAnId = {
      ...stageBase,
      objectId: 'x',
      type: 'procedure_stage.fields_changed',
      changedFields: ['dueDate'],
    } as JournalSourceEvent;
    expect(() => toJournalEvent(notAnId)).toThrow();
  });

  it('EVM-038 AC3 a stored event is read back into codes and identifiers', () => {
    const stored = toJournalEvent({
      ...stageBase,
      type: 'procedure_stage.status_changed',
      fromStatus: 'in_progress',
      toStatus: 'waiting',
      waitingOn: 'party',
      waitingOnPartyId: PARTY,
    });
    expect(readJournalEvent(stored.code, stored.payload)).toEqual({
      code: 'stage_status_changed',
      objectType: 'procedure_stage',
      fromStatus: 'in_progress',
      toStatus: 'waiting',
      waitingOn: 'party',
      waitingOnPartyId: PARTY,
      changedFields: [],
    });
    expect(readJournalEvent('stage_updated', { objectType: 'procedure_stage', objectId: STAGE, changedFields: ['dueDate'] })).toMatchObject(
      {
        code: 'stage_updated',
        changedFields: ['dueDate'],
        fromStatus: null,
        waitingOnPartyId: null,
      },
    );
  });

  it('EVM-038 note (a) reading is tolerant: a code of a later version and a payload that does not fit give a neutral view, not a failure', () => {
    expect(readJournalEvent('media_added', { objectType: 'work_order', anything: 1 })).toMatchObject({
      code: 'media_added',
      objectType: 'work_order',
      toStatus: null,
      changedFields: [],
    });
    expect(readJournalEvent('media_added', null)).toMatchObject({ code: 'media_added', objectType: null });
    expect(readJournalEvent('media_added', 'text')).toMatchObject({ code: 'media_added', objectType: null });
    expect(readJournalEvent('media_added', { objectType: 'invoice' })).toMatchObject({ objectType: null });
    expect(readJournalEvent('stage_status_changed', { objectType: 'procedure_stage', toStatus: 'flying' })).toMatchObject({
      code: UNKNOWN_EVENT_CODE,
      objectType: null,
      toStatus: null,
    });
    // a key of a later version on a known code is ignored, not a reason to hide the event
    const later = { objectType: 'work_order', objectId: ORDER, fromStatus: 'new', toStatus: 'accepted', note: 'x' };
    expect(readJournalEvent('work_order_status_changed', later)).toMatchObject({ code: 'work_order_status_changed', toStatus: 'accepted' });
  });
});
