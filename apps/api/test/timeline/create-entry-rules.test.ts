import { describe, expect, it } from 'vitest';
import { resolveCreateEntry } from '../../src/modules/timeline/domain/create-entry-rules.ts';

const ID = '0198b0a0-0000-7000-8000-000000000001';
const STAGE = '0198b0a0-0000-7000-8000-000000000002';

describe('the rules of a new entry (EVM-037 AC1, AC2; SR-INPUT-01, SR-INPUT-05)', () => {
  it('EVM-037 AC1 a note with a category and a text is a command with the text normalised', () => {
    const result = resolveCreateEntry({
      id: ID,
      kind: 'note',
      noteCategory: 'phone_call',
      body: '  Rozmowa\r\nz klientem \u0000 ',
      procedureStageId: STAGE,
    });
    expect(result).toEqual({
      ok: true,
      command: {
        id: ID,
        kind: 'note',
        noteCategory: 'phone_call',
        body: 'Rozmowa\nz klientem',
        procedureStageId: STAGE,
        supersedesEntryId: null,
      },
    });
  });

  it('EVM-037 AC2 a comment has no category', () => {
    const result = resolveCreateEntry({ id: ID, kind: 'comment', body: 'Komentarz.' });
    expect(result).toMatchObject({ ok: true, command: { kind: 'comment', noteCategory: null, procedureStageId: undefined } });
    expect(resolveCreateEntry({ id: ID, kind: 'comment', noteCategory: 'other', body: 'Komentarz.' })).toEqual({
      ok: false,
      errors: [{ pointer: '/noteCategory', code: 'not_allowed' }],
    });
  });

  it('EVM-037 AC1 a note needs a category', () => {
    expect(resolveCreateEntry({ id: ID, kind: 'note', body: 'Tekst.' })).toEqual({
      ok: false,
      errors: [{ pointer: '/noteCategory', code: 'required' }],
    });
  });

  it('EVM-037 AC1 the errors of the category and of the text come together, as pointers and codes — never a value', () => {
    const result = resolveCreateEntry({ id: ID, kind: 'note', body: '   ' });
    expect(result).toEqual({
      ok: false,
      errors: [
        { pointer: '/noteCategory', code: 'required' },
        { pointer: '/body', code: 'required' },
      ],
    });
    expect(resolveCreateEntry({ id: ID, kind: 'comment', body: 'x'.repeat(10_001) })).toEqual({
      ok: false,
      errors: [{ pointer: '/body', code: 'too_long' }],
    });
  });

  it('EVM-037 AC3 a correction names the entry; the stage is "not said" (undefined) or "none" (null)', () => {
    const named = resolveCreateEntry({ id: ID, kind: 'comment', body: 'Poprawka.', supersedesEntryId: STAGE, procedureStageId: null });
    expect(named).toMatchObject({ ok: true, command: { supersedesEntryId: STAGE, procedureStageId: null } });
  });
});
