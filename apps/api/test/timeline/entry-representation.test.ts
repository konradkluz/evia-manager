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
  ...overrides,
});
const batch = (overrides: Partial<RepresentationBatch> = {}): RepresentationBatch => ({
  authors: new Map([[AUTHOR, 'Anna Testowa']]),
  stageNames: new Map([[STAGE, 'Złożenie wniosku']]),
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
      row({ kind: 'event', note_category: null, body: null, origin: 'system', created_by: null, captured_at: captured }),
      batch(),
    );
    expect(event).toMatchObject({ kind: 'event', body: null, author: null, origin: 'system', capturedAt: '2026-10-11T07:59:00.000Z' });
    expect(toTimelineEntry(row({ redacted_at: CREATED }), batch())).toMatchObject({ redactedAt: '2026-10-11T08:00:00.000Z' });
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
