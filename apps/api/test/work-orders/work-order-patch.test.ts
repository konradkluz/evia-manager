import { describe, expect, it } from 'vitest';
import {
  changedFieldsOf,
  normalizeWorkOrderPatch,
  type WorkOrderPatchInput,
} from '../../src/modules/work-orders/domain/work-order-patch.ts';

const ASSIGNEE = '0198b0a0-0000-7000-8000-000000000002';
const OTHER = '0198b0a0-0000-7000-8000-000000000009';
const refused = (input: WorkOrderPatchInput) => {
  const result = normalizeWorkOrderPatch(input);
  if (result.ok) throw new Error('expected the patch to be refused');
  return result.errors;
};

describe('the change of the data of a work order (EVM-035 AC1, AC4; SR-INPUT-01, SR-INPUT-02, SR-INPUT-05)', () => {
  it('EVM-035 AC1 a key that is absent stays absent; null clears the description and the date; the text is NFC, trimmed, a new line is "\\n"', () => {
    expect(
      normalizeWorkOrderPatch({ title: '  Garaż́  ', description: 'a\r\nb', plannedDate: '2026-11-15', assigneeUserId: ASSIGNEE }),
    ).toEqual({
      ok: true,
      patch: { title: 'Garaż́'.normalize('NFC'), description: 'a\nb', plannedDate: '2026-11-15', assigneeUserId: ASSIGNEE },
    });
    expect(normalizeWorkOrderPatch({ description: null, plannedDate: null })).toEqual({
      ok: true,
      patch: { description: null, plannedDate: null },
    });
    expect(normalizeWorkOrderPatch({ title: 'Nowy tytuł' })).toEqual({ ok: true, patch: { title: 'Nowy tytuł' } });
  });

  it('EVM-035 AC1 an empty description is "no description" (null), like the creation', () => {
    expect(normalizeWorkOrderPatch({ description: '   ' })).toEqual({ ok: true, patch: { description: null } });
  });

  it('EVM-035 AC4 an empty patch is refused (required); a title that is empty after trimming is refused — the title is never empty', () => {
    expect(refused({})).toEqual([{ pointer: '', code: 'required' }]);
    expect(refused({ title: '   ' })).toEqual([{ pointer: '/title', code: 'required' }]);
  });

  it('EVM-035 AC4 SR-INPUT-05 control characters, a title of 201 characters, a description of 2001 and a date outside 2000-01-01…2100-12-31 are refused with a pointer and a code — never the value', () => {
    expect(refused({ title: 'a\u0007b' })).toEqual([{ pointer: '/title', code: 'invalid_characters' }]);
    expect(refused({ title: 'a'.repeat(201) })).toEqual([{ pointer: '/title', code: 'too_long' }]);
    expect(refused({ description: 'a'.repeat(2001) })).toEqual([{ pointer: '/description', code: 'too_long' }]);
    expect(refused({ plannedDate: '1999-12-31' })).toEqual([{ pointer: '/plannedDate', code: 'out_of_range' }]);
    expect(refused({ plannedDate: '2101-01-01' })).toEqual([{ pointer: '/plannedDate', code: 'out_of_range' }]);
    expect(normalizeWorkOrderPatch({ plannedDate: '2000-01-01' })).toMatchObject({ ok: true });
    expect(normalizeWorkOrderPatch({ plannedDate: '2100-12-31' })).toMatchObject({ ok: true });
    expect(normalizeWorkOrderPatch({ description: 'wiersz 1\nwiersz 2' })).toMatchObject({ ok: true });
  });

  it('EVM-035 AC7 only the fields that REALLY change are named: the same value is no change, a new coordinator is "coordinator"', () => {
    const current = { title: 'Garaż', description: null, plannedDate: '2026-11-15', coordinatorUserId: ASSIGNEE };
    expect(changedFieldsOf({ title: 'Garaż', plannedDate: '2026-11-15', description: null, assigneeUserId: ASSIGNEE }, current)).toEqual(
      [],
    );
    expect(changedFieldsOf({ title: 'Dom', description: 'Opis', plannedDate: null, assigneeUserId: OTHER }, current)).toEqual([
      'title',
      'description',
      'plannedDate',
      'coordinator',
    ]);
    expect(changedFieldsOf({}, current)).toEqual([]);
    expect(changedFieldsOf({ assigneeUserId: ASSIGNEE }, { ...current, coordinatorUserId: null })).toEqual(['coordinator']);
  });
});
