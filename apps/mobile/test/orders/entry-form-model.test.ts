import { createUuidV7 } from '@evia/sync-core';
import {
  buildEntryInput,
  DEFAULT_CATEGORY,
  MAX_BODY_LENGTH,
  normalizeBody,
  NOTE_CATEGORIES,
  stageChoices,
  type EntryDraft,
} from '../../src/orders/entry-form-model';

// EVM-105 AC1-AC3 (security 2, 3, 7): the pure model of the entry form. Synthetic data only.
const NOW = Date.UTC(2026, 10, 14, 9, 30, 15, 123);
const STAGES = [
  { id: 'st1', name: 'Wniosek do OSD', process: 'Przyłączenie OSD' },
  { id: 'st2', name: 'Umowa', process: 'Przyłączenie OSD' },
];
const draft = (patch: Partial<EntryDraft> = {}): EntryDraft => ({
  kind: 'note',
  workOrderId: 'wo-1',
  category: 'site_visit',
  stageId: null,
  stages: STAGES,
  body: 'Trasa kabla przez szacht B.',
  ...patch,
});
const ids = () => {
  let n = 0;
  return () => `id-${String(++n)}`;
};

describe('body (EVM-105 AC3)', () => {
  it('EVM-105 AC3: empty and white-space-only text is "empty"', () => {
    for (const body of ['', '   ', '\n\t \r\n', ' ']) expect(normalizeBody(body)).toEqual({ ok: false, problem: 'empty' });
  });

  it('EVM-105 AC3: exactly 10 000 characters pass, 10 001 are too long; the limit counts code points, not UTF-16 units', () => {
    expect(normalizeBody('a'.repeat(MAX_BODY_LENGTH)).ok).toBe(true);
    expect(normalizeBody('a'.repeat(MAX_BODY_LENGTH + 1))).toEqual({ ok: false, problem: 'too_long' });
    expect(normalizeBody('😀'.repeat(MAX_BODY_LENGTH)).ok).toBe(true);
    expect(normalizeBody('😀'.repeat(MAX_BODY_LENGTH + 1))).toEqual({ ok: false, problem: 'too_long' });
  });

  it('EVM-105 AC3: the text is normalised like the server (NFC, LF, control and direction characters removed, trimmed)', () => {
    expect(normalizeBody('  a\r\nb\rc\u0000d\u202Ee\u2028f  ')).toEqual({ ok: true, value: 'a\nb\ncdef' });
    expect(normalizeBody('Zażółć'.normalize('NFD'))).toEqual({ ok: true, value: 'Zażółć' });
    expect(normalizeBody('á')).toEqual({ ok: true, value: 'á' });
  });

  it('EVM-105 AC3: a lone surrogate is "invalid" (the server would refuse it)', () => {
    expect(normalizeBody('a\ud800b')).toEqual({ ok: false, problem: 'invalid' });
    expect(normalizeBody('a\udc00')).toEqual({ ok: false, problem: 'invalid' });
    expect(normalizeBody('ok 😀')).toEqual({ ok: true, value: 'ok 😀' });
  });

  it('EVM-105 AC3: the error carries a code and never the text', () => {
    const result = normalizeBody('MARKER'.repeat(2000));
    expect(JSON.stringify(result)).not.toContain('MARKER');
  });
});

describe('command (EVM-105 AC1, AC2)', () => {
  it('EVM-105 AC1: the categories of the story, "Inne" is the default', () => {
    expect([...NOTE_CATEGORIES]).toEqual(['phone_call', 'meeting', 'arrangement', 'site_visit', 'other']);
    expect(DEFAULT_CATEGORY).toBe('other');
  });

  it('EVM-105 AC1: a note is CreateNote v1 with the category, the stage of the order, the text and the time on the phone', () => {
    const result = buildEntryInput(draft({ stageId: 'st2' }), NOW, ids());
    expect(result).toEqual({
      ok: true,
      input: {
        type: 'CreateNote',
        commandVersion: 1,
        payload: {
          id: 'id-1',
          workOrderId: 'wo-1',
          noteCategory: 'site_visit',
          body: 'Trasa kabla przez szacht B.',
          capturedAt: '2026-11-14T09:30:15.123Z',
          procedureStageId: 'st2',
        },
      },
    });
  });

  it('EVM-105 AC1: without a stage the field is absent', () => {
    const result = buildEntryInput(draft(), NOW, ids());
    expect(result.ok && Object.keys(result.input.payload as object)).not.toContain('procedureStageId');
  });

  it('EVM-105 AC1: a stage that is not a stage of this order never reaches the command (security 7)', () => {
    const result = buildEntryInput(draft({ stageId: 'st-of-another-order' }), NOW, ids());
    expect(result.ok && JSON.stringify(result.input.payload)).not.toContain('st-of-another-order');
    expect(result.ok && Object.keys(result.input.payload as object)).not.toContain('procedureStageId');
  });

  it('EVM-105 AC2: a comment is CreateComment v1 without a category and a stage, even when they were chosen before the switch', () => {
    const result = buildEntryInput(draft({ kind: 'comment', stageId: 'st1' }), NOW, ids());
    expect(result).toEqual({
      ok: true,
      input: {
        type: 'CreateComment',
        commandVersion: 1,
        payload: { id: 'id-1', workOrderId: 'wo-1', body: 'Trasa kabla przez szacht B.', capturedAt: '2026-11-14T09:30:15.123Z' },
      },
    });
  });

  it('EVM-105 AC1: the id is new for every command and is taken from the generator (UUIDv7 of the session)', () => {
    let tick = NOW;
    const newId = createUuidV7({ now: () => (tick += 1) }, { getRandomValues: (bytes) => bytes.fill(7) });
    const first = buildEntryInput(draft(), NOW, newId);
    const second = buildEntryInput(draft(), NOW, newId);
    const idOf = (r: typeof first) => (r.ok ? (r.input.payload as { id: string }).id : '');
    expect(idOf(first)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(idOf(first)).not.toBe(idOf(second));
  });

  it('EVM-105 AC3: a bad text gives no command and does not take an id', () => {
    const newId = jest.fn(() => 'x');
    expect(buildEntryInput(draft({ body: '  ' }), NOW, newId)).toEqual({ ok: false, problem: 'empty' });
    expect(buildEntryInput(draft({ body: 'a'.repeat(MAX_BODY_LENGTH + 1) }), NOW, newId)).toEqual({ ok: false, problem: 'too_long' });
    expect(newId).not.toHaveBeenCalled();
  });

  it('EVM-105 AC1: the sent text is the normalised one', () => {
    const result = buildEntryInput(draft({ body: '  Zażółć'.normalize('NFD') + '\r\n' }), NOW, ids());
    expect(result.ok && (result.input.payload as { body: string }).body).toBe('Zażółć');
  });
});

describe('stages (EVM-105 AC1)', () => {
  it('EVM-105 AC1: the choices are the stages of the processes of this order, with the process name', () => {
    expect(
      stageChoices({
        processes: [
          { id: 'p1', name: 'Przyłączenie OSD', stages: [{ id: 'st1', name: 'Wniosek', status: 'todo', waitingFor: null }] },
          { id: 'p2', name: 'Montaż', stages: [{ id: 'st9', name: 'Odbiór', status: 'todo', waitingFor: null }] },
        ],
      }),
    ).toEqual([
      { id: 'st1', name: 'Wniosek', process: 'Przyłączenie OSD' },
      { id: 'st9', name: 'Odbiór', process: 'Montaż' },
    ]);
    expect(stageChoices({ processes: [] })).toEqual([]);
  });
});

describe('entry for a quick order in the queue (EVM-106 AC2)', () => {
  const PARENT = '0194c2a0-0000-7000-8000-0000000000d1';
  it('EVM-106 AC2: a note and a comment carry the parent mutation (they wait behind the order); without a parent there is no such key', () => {
    for (const kind of ['note', 'comment'] as const) {
      const built = buildEntryInput(draft({ kind, parentMutationId: PARENT }), NOW, ids());
      expect(built.ok && built.input.parentMutationId).toBe(PARENT);
    }
    for (const parentMutationId of [undefined, null]) {
      const built = buildEntryInput(draft({ parentMutationId }), NOW, ids());
      expect(built.ok && 'parentMutationId' in built.input).toBe(false);
    }
  });
});
