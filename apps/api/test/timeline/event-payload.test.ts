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
const ITEM = '0198b0a0-0000-7000-8000-000000000005';
const MILESTONE = '0198b0a0-0000-7000-8000-000000000006';
const itemBase = {
  actor,
  outcome: 'success',
  objectType: 'scope_item',
  objectId: ITEM,
  workOrderId: ORDER,
  itemCode: 'supply_installation',
} as const;

const PROCESS = '0198b0a0-0000-7000-8000-000000000006';
const processBase = {
  actor,
  outcome: 'success',
  objectType: 'procedure',
  objectId: PROCESS,
  workOrderId: ORDER,
  procedureCode: 'fire_opinion',
} as const;
const manualStageBase = { ...stageBase, procedureCode: 'fire_opinion' } as const;

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
      [
        {
          type: 'work_order.fields_changed',
          actor,
          outcome: 'success',
          objectType: 'work_order',
          objectId: ORDER,
          changedFields: ['title', 'coordinator'],
        },
        'work_order_fields_changed',
        null,
      ],
      [{ ...itemBase, type: 'work_order.scope_item_added', procedureCodes: ['electrical_installation'] }, 'scope_item_added', null],
      [{ ...itemBase, type: 'work_order.scope_item_updated', changedFields: ['parameters'] }, 'scope_item_updated', null],
      [{ ...itemBase, type: 'work_order.scope_item_removed' }, 'scope_item_removed', null],
      [{ ...processBase, type: 'procedure.added' }, 'procedure_added', null],
      [{ ...processBase, type: 'procedure.removed' }, 'procedure_removed', null],
      [{ ...processBase, type: 'procedure.reinstated' }, 'procedure_restored', null],
      [{ ...manualStageBase, type: 'procedure_stage.added' }, 'stage_added', STAGE],
      [{ ...manualStageBase, type: 'procedure_stage.removed' }, 'stage_removed', STAGE],
      [{ ...manualStageBase, type: 'procedure_stage.reinstated' }, 'stage_restored', STAGE],
      [
        {
          type: 'payment_milestone.status_changed',
          actor,
          outcome: 'success',
          objectType: 'payment_milestone',
          objectId: MILESTONE,
          workOrderId: ORDER,
          fromStatus: 'planned',
          toStatus: 'invoiced',
        },
        'payment_milestone_status_changed',
        null,
      ],
      [
        {
          type: 'payment_milestone.removed',
          actor,
          outcome: 'success',
          objectType: 'payment_milestone',
          objectId: MILESTONE,
          workOrderId: ORDER,
        },
        'payment_milestone_deleted',
        null,
      ],
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
      objectId: STAGE,
      fromStatus: 'in_progress',
      toStatus: 'waiting',
      waitingOn: 'party',
      waitingOnPartyId: PARTY,
      changedFields: [],
      itemCode: null,
      procedureCodes: null,
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

describe('the events of the data and the scope of an order (EVM-035 AC7; SR-LOG-03, SR-DATA-01, SR-DATA-02)', () => {
  it('EVM-035 AC7 the change of the data names the fields — never the title, the description, the date or the person', () => {
    const noisy = {
      type: 'work_order.fields_changed',
      actor,
      outcome: 'success',
      objectType: 'work_order',
      objectId: ORDER,
      changedFields: ['title', 'plannedDate'],
      title: 'Wallbox dla Jana Testowego',
      description: 'Klucz u sąsiadki',
      coordinatorDisplayName: 'Anna Testowa',
    } as unknown as JournalSourceEvent;
    const { payload, code } = toJournalEvent(noisy);
    expect(code).toBe('work_order_fields_changed');
    expect(payload).toEqual({ objectType: 'work_order', objectId: ORDER, changedFields: ['title', 'plannedDate'] });
    expect(JSON.stringify(payload)).not.toMatch(/Jan|sąsiad|Anna/);
  });

  it('EVM-035 AC7 the events of the scope hold the code of the item, the codes of the processes and the names of the fields — never the notes or a parameter', () => {
    const added = toJournalEvent({
      ...itemBase,
      type: 'work_order.scope_item_added',
      procedureCodes: ['electrical_installation', 'dso_connection'],
      notes: 'Kod do bramy 1234',
      parameters: { cableLengthM: 18 },
      name: 'Instalacja zasilająca',
    } as unknown as JournalSourceEvent);
    expect(added.payload).toEqual({
      objectType: 'scope_item',
      objectId: ITEM,
      itemCode: 'supply_installation',
      procedureCodes: ['electrical_installation', 'dso_connection'],
    });
    expect(JSON.stringify(added.payload)).not.toMatch(/1234|18|Instalacja zasilająca/);
    expect(added).toMatchObject({ code: 'scope_item_added', workOrderId: ORDER, procedureStageId: null, actorUserId: USER });

    const updated = toJournalEvent({ ...itemBase, type: 'work_order.scope_item_updated', changedFields: ['parameters', 'notes'] });
    expect(updated.payload).toEqual({
      objectType: 'scope_item',
      objectId: ITEM,
      itemCode: 'supply_installation',
      changedFields: ['parameters', 'notes'],
    });
    const removed = toJournalEvent({ ...itemBase, type: 'work_order.scope_item_removed' });
    expect(removed.payload).toEqual({ objectType: 'scope_item', objectId: ITEM, itemCode: 'supply_installation' });
  });

  it('EVM-035 AC7 a payload that does not fit the schema of its code is refused (fail closed): an unknown field name, an empty list, a name instead of a code, more than 30 processes', () => {
    const fields = (changedFields: string[]) =>
      ({
        type: 'work_order.fields_changed',
        actor,
        outcome: 'success',
        objectType: 'work_order',
        objectId: ORDER,
        changedFields,
      }) as JournalSourceEvent;
    expect(() => toJournalEvent(fields(['status']))).toThrow();
    expect(() => toJournalEvent(fields([]))).toThrow();
    expect(() => toJournalEvent({ ...itemBase, type: 'work_order.scope_item_updated', changedFields: ['quantity' as never] })).toThrow();
    expect(() => toJournalEvent({ ...itemBase, itemCode: 'Instalacja zasilająca', type: 'work_order.scope_item_removed' })).toThrow();
    const tooMany = Array.from({ length: 31 }, (_, index) => `process_${index}`);
    expect(() => toJournalEvent({ ...itemBase, type: 'work_order.scope_item_added', procedureCodes: tooMany })).toThrow();
    expect(toJournalEvent({ ...itemBase, type: 'work_order.scope_item_added', procedureCodes: [] }).payload).toMatchObject({
      procedureCodes: [],
    });
  });

  it('EVM-035 AC7 reading is tolerant: the codes come back, a key of a later version is ignored, a payload that does not fit is the neutral view', () => {
    expect(
      readJournalEvent('scope_item_added', {
        objectType: 'scope_item',
        objectId: ITEM,
        itemCode: 'supply_installation',
        procedureCodes: ['electrical_installation'],
        later: 1,
      }),
    ).toEqual({
      code: 'scope_item_added',
      objectType: 'scope_item',
      objectId: ITEM,
      fromStatus: null,
      toStatus: null,
      waitingOn: null,
      waitingOnPartyId: null,
      changedFields: [],
      itemCode: 'supply_installation',
      procedureCodes: ['electrical_installation'],
    });
    expect(
      readJournalEvent('work_order_fields_changed', { objectType: 'work_order', objectId: ORDER, changedFields: ['title'] }),
    ).toMatchObject({ code: 'work_order_fields_changed', changedFields: ['title'], itemCode: null, procedureCodes: null });
    expect(readJournalEvent('scope_item_removed', { objectType: 'scope_item', objectId: 'x' })).toMatchObject({
      code: UNKNOWN_EVENT_CODE,
      objectType: null,
      itemCode: null,
    });
  });
});

describe('journal events of the processes and stages added by hand (EVM-042 AC5; SR-LOG-03, SR-DATA-01)', () => {
  it('EVM-042 AC5 the payload of a process holds the object and the code of the process — nothing else', () => {
    expect(toJournalEvent({ ...processBase, type: 'procedure.added' }).payload).toEqual({
      objectType: 'procedure',
      objectId: PROCESS,
      procedureCode: 'fire_opinion',
    });
  });

  it('EVM-042 AC5 the payload of a stage holds the stage and the code of its process — never the name of the stage, a person or a day', () => {
    const noisy = {
      ...manualStageBase,
      type: 'procedure_stage.added',
      name: 'Uzgodnienie z Janem Kowalskim',
      responsibleUserId: USER,
      dueDate: '2026-10-30',
    } as unknown as JournalSourceEvent;
    const entry = toJournalEvent(noisy);
    expect(entry.payload).toEqual({ objectType: 'procedure_stage', objectId: STAGE, procedureCode: 'fire_opinion' });
    expect(JSON.stringify(entry.payload)).not.toMatch(/Kowalski|2026-10-30/);
    expect(entry.procedureStageId).toBe(STAGE);
  });

  it('EVM-042 AC5 a code that is not a stable code of the catalogue (a name, a capital letter) is refused: fail closed', () => {
    expect(() => toJournalEvent({ ...processBase, type: 'procedure.removed', procedureCode: 'Opinia ppoż' })).toThrow();
    expect(() => toJournalEvent({ ...manualStageBase, type: 'procedure_stage.removed', procedureCode: 'Fire' })).toThrow();
  });

  it('EVM-042 AC5 reading gives the one code of the process as a list; a payload that does not fit is the neutral view', () => {
    expect(
      readJournalEvent('stage_removed', { objectType: 'procedure_stage', objectId: STAGE, procedureCode: 'fire_opinion', later: 1 }),
    ).toMatchObject({ code: 'stage_removed', objectType: 'procedure_stage', procedureCodes: ['fire_opinion'], itemCode: null });
    expect(
      readJournalEvent('procedure_added', { objectType: 'procedure', objectId: PROCESS, procedureCode: 'fire_opinion' }),
    ).toMatchObject({
      code: 'procedure_added',
      objectType: 'procedure',
      procedureCodes: ['fire_opinion'],
    });
    expect(readJournalEvent('procedure_restored', { objectType: 'procedure', objectId: 'x' })).toMatchObject({
      code: UNKNOWN_EVENT_CODE,
      objectType: null,
      procedureCodes: null,
    });
  });
});
