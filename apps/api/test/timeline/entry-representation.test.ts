import { describe, expect, it } from 'vitest';
import {
  toTimelineEntry,
  toTimelineEntryList,
  type RepresentationBatch,
} from '../../src/modules/timeline/application/entry-representation.ts';
import type { EntryRow } from '../../src/modules/timeline/infrastructure/timeline-store.ts';

const ID = '0198b0a0-0000-7000-8000-000000000001';
const OTHER = '0198b0a0-0000-7000-8000-000000000002';
const AUTHOR = '0198b0a0-0000-7000-8000-000000000003';
const STAGE = '0198b0a0-0000-7000-8000-000000000004';
const PARTY = '0198b0a0-0000-7000-8000-000000000005';
const CREATED = new Date('2026-10-11T08:00:00.000Z');

const row = (overrides: Partial<EntryRow> = {}): EntryRow => ({
  id: ID,
  kind: 'note',
  note_category: 'phone_call',
  body: 'Treść syntetyczna.',
  procedure_stage_id: null,
  supersedes_entry_id: null,
  origin: 'web',
  captured_at: null,
  created_at: CREATED,
  created_by: AUTHOR,
  redacted_at: null,
  deleted_at: null,
  version: 1,
  event_code: null,
  event_payload: null,
  ...overrides,
});
const batch = (overrides: Partial<RepresentationBatch> = {}): RepresentationBatch => ({
  authors: new Map([[AUTHOR, 'Anna Testowa']]),
  stageNames: new Map([[STAGE, 'Złożenie wniosku']]),
  partyNames: new Map([[PARTY, 'Operator Testowy']]),
  partyKinds: new Map([[PARTY, 'osd']]),
  milestoneNames: new Map(),
  corrections: new Map(),
  ...overrides,
});

describe('the answer of an entry (EVM-037 AC1–AC3; SR-DATA-03, ASVS V15.3.1)', () => {
  it('EVM-037 AC1 a note has its category, the author as id and displayName only, the time of the server and no stage', () => {
    expect(toTimelineEntry(row(), batch())).toEqual({
      id: ID,
      kind: 'note',
      noteCategory: 'phone_call',
      body: 'Treść syntetyczna.',
      procedureStageId: null,
      procedureStageName: null,
      author: { id: AUTHOR, displayName: 'Anna Testowa' },
      createdAt: '2026-10-11T08:00:00.000Z',
      origin: 'web',
      capturedAt: null,
      supersedesEntryId: null,
      supersededByEntryId: null,
      redactedAt: null,
      event: null,
    });
  });

  it('EVM-037 AC1 the stage comes with its name; a stage whose name is not known (another order) has none', () => {
    expect(toTimelineEntry(row({ procedure_stage_id: STAGE }), batch())).toMatchObject({
      procedureStageId: STAGE,
      procedureStageName: 'Złożenie wniosku',
    });
    expect(toTimelineEntry(row({ procedure_stage_id: STAGE }), batch({ stageNames: new Map() }))).toMatchObject({
      procedureStageId: STAGE,
      procedureStageName: null,
    });
  });

  it('EVM-037 AC3 a corrected entry names its correction and a correction names its predecessor', () => {
    expect(toTimelineEntry(row(), batch({ corrections: new Map([[ID, OTHER]]) }))).toMatchObject({
      supersededByEntryId: OTHER,
      supersedesEntryId: null,
    });
    expect(toTimelineEntry(row({ id: OTHER, supersedes_entry_id: ID }), batch())).toMatchObject({
      id: OTHER,
      supersedesEntryId: ID,
      supersededByEntryId: null,
    });
  });

  it('EVM-037 AC6 an event of the system has no author and no text; the time of the device and of a redaction are metadata', () => {
    const captured = new Date('2026-10-11T07:59:00.000Z');
    const event = toTimelineEntry(
      row({
        kind: 'event',
        note_category: null,
        body: null,
        origin: 'system',
        created_by: null,
        captured_at: captured,
        event_code: 'work_order_created',
        event_payload: { objectType: 'work_order', objectId: ID },
      }),
      batch(),
    );
    expect(event).toMatchObject({ kind: 'event', body: null, author: null, origin: 'system', capturedAt: '2026-10-11T07:59:00.000Z' });
    expect(toTimelineEntry(row({ redacted_at: CREATED }), batch())).toMatchObject({ redactedAt: '2026-10-11T08:00:00.000Z' });
    // EVM-040: the time of the deletion is shown as `deletedAt`, and `null` for an entry that is not deleted
    expect(toTimelineEntry(row({ deleted_at: CREATED }), batch())).toMatchObject({ deletedAt: '2026-10-11T08:00:00.000Z' });
    expect(toTimelineEntry(row(), batch())).toMatchObject({ deletedAt: null });
  });

  const stageEvent = (payload: Record<string, unknown>, code = 'stage_status_changed') =>
    row({
      kind: 'event',
      note_category: null,
      body: null,
      origin: 'system',
      procedure_stage_id: STAGE,
      event_code: code,
      event_payload: payload,
    });
  const waiting = {
    objectType: 'procedure_stage',
    objectId: STAGE,
    fromStatus: 'in_progress',
    toStatus: 'waiting',
    waitingOn: 'party',
    waitingOnPartyId: PARTY,
  };

  it('EVM-038 AC3 an event names the party waited for with the CURRENT name and kind, the author is the actor, the stage has its name', () => {
    expect(toTimelineEntry(stageEvent(waiting), batch())).toMatchObject({
      kind: 'event',
      author: { id: AUTHOR, displayName: 'Anna Testowa' },
      procedureStageName: 'Złożenie wniosku',
      event: {
        code: 'stage_status_changed',
        objectType: 'procedure_stage',
        fromStatus: 'in_progress',
        toStatus: 'waiting',
        waitingOn: 'party',
        waitingOnParty: { id: PARTY, name: 'Operator Testowy', kind: 'osd' },
        changedFields: [],
      },
    });
  });

  it('EVM-038 AC2 a party the caller may not see, or a deleted one, has an identifier and no name or kind', () => {
    const hidden = batch({ partyNames: new Map(), partyKinds: new Map() });
    expect(toTimelineEntry(stageEvent(waiting), hidden).event?.waitingOnParty).toEqual({ id: PARTY, name: null, kind: null });
  });

  it('EVM-038 AC3 an event of the customer has no party; a change of fields names the fields only', () => {
    const customer = { ...waiting, waitingOn: 'customer', waitingOnPartyId: null };
    expect(toTimelineEntry(stageEvent(customer), batch()).event).toMatchObject({ waitingOn: 'customer', waitingOnParty: null });
    const fields = { objectType: 'procedure_stage', objectId: STAGE, changedFields: ['dueDate'] };
    expect(toTimelineEntry(stageEvent(fields, 'stage_updated'), batch()).event).toMatchObject({
      code: 'stage_updated',
      changedFields: ['dueDate'],
      toStatus: null,
    });
  });

  it('EVM-038 note (a) an event of a code this version does not know, or a payload that does not fit, is shown neutrally, not as a 500', () => {
    expect(toTimelineEntry(stageEvent({ objectType: 'work_order' }, 'media_added'), batch()).event).toMatchObject({
      code: 'media_added',
      objectType: 'work_order',
      waitingOnParty: null,
    });
    expect(toTimelineEntry(stageEvent({ toStatus: 'flying' }), batch()).event).toMatchObject({ code: 'unknown_event', objectType: null });
  });

  it('EVM-037 SR-DATA-03 an author without a name is a defect of the server (500), not an entry without an author', () => {
    expect(() => toTimelineEntry(row(), batch({ authors: new Map() }))).toThrow(expect.objectContaining({ code: 'internal_error' }));
  });

  it('EVM-037 ASVS V15.3.1 an answer that does not match the contract never leaves: a text over the bound is a defect (500)', () => {
    expect(() => toTimelineEntry(row({ body: 'x'.repeat(20_001) }), batch())).toThrow(expect.objectContaining({ code: 'internal_error' }));
    expect(() => toTimelineEntryList([row({ kind: 'secret' as never })], batch(), null)).toThrow(
      expect.objectContaining({ code: 'internal_error' }),
    );
  });

  it('EVM-037 AC6 a page carries its entries and the cursor of the next one (or null)', () => {
    const page = toTimelineEntryList([row(), row({ id: OTHER })], batch(), 'abc_-');
    expect(page.items.map((item) => item.id)).toEqual([ID, OTHER]);
    expect(page.nextCursor).toBe('abc_-');
    expect(toTimelineEntryList([], batch(), null)).toEqual({ items: [], nextCursor: null });
  });
});

describe('the events of the scope in the answer (EVM-035 AC7; SR-LOG-03, SR-DATA-02)', () => {
  const eventRow = (code: string, payload: Record<string, unknown>) =>
    row({ kind: 'event', note_category: null, body: null, origin: 'system', event_code: code, event_payload: payload });

  it('EVM-035 AC7 the addition of an item carries the code of the item and the codes of the processes — the names are read from the catalogue by the panel', () => {
    const entry = toTimelineEntry(
      eventRow('scope_item_added', {
        objectType: 'scope_item',
        objectId: OTHER,
        itemCode: 'supply_installation',
        procedureCodes: ['electrical_installation'],
      }),
      batch(),
    );
    expect(entry.event).toEqual({
      code: 'scope_item_added',
      objectType: 'scope_item',
      fromStatus: null,
      toStatus: null,
      waitingOn: null,
      waitingOnParty: null,
      changedFields: [],
      itemCode: 'supply_installation',
      procedureCodes: ['electrical_installation'],
    });
  });

  it('EVM-035 AC7 an event that is not about the scope has neither key; the change of the data of an order has the names of the fields', () => {
    const entry = toTimelineEntry(
      eventRow('work_order_fields_changed', { objectType: 'work_order', objectId: OTHER, changedFields: ['title', 'coordinator'] }),
      batch(),
    );
    expect(entry.event).toMatchObject({ code: 'work_order_fields_changed', changedFields: ['title', 'coordinator'] });
    expect(Object.keys(entry.event ?? {})).not.toContain('itemCode');
    expect(Object.keys(entry.event ?? {})).not.toContain('procedureCodes');
    const removed = toTimelineEntry(
      eventRow('scope_item_removed', { objectType: 'scope_item', objectId: OTHER, itemCode: 'supply_installation' }),
      batch(),
    );
    expect(removed.event).toMatchObject({ itemCode: 'supply_installation' });
    expect(Object.keys(removed.event ?? {})).not.toContain('procedureCodes');
  });
});
