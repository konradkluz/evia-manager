import { describe, expect, it } from 'vitest';
import { DUE_DATE_MAX, DUE_DATE_MIN, normalizeStagePatch } from '../../src/modules/procedures/domain/stage-patch.ts';

const USER = '0198b0a0-0000-7000-8000-000000000002';
const refused = (input: Parameters<typeof normalizeStagePatch>[0]) => {
  const result = normalizeStagePatch(input);
  if (result.ok) throw new Error('expected the patch to be refused');
  return result.errors;
};

describe('the change of a stage (EVM-031 AC3; SR-INPUT-01, SR-INPUT-02, SR-AUTHZ-04)', () => {
  it('EVM-031 AC3 the person and the date together, or each alone: the named fields are kept and the absent ones stay absent', () => {
    expect(normalizeStagePatch({ responsibleUserId: USER, dueDate: '2026-10-09' })).toEqual({
      ok: true,
      patch: { responsibleUserId: USER, dueDate: '2026-10-09' },
    });
    expect(normalizeStagePatch({ dueDate: '2026-10-09' })).toEqual({ ok: true, patch: { dueDate: '2026-10-09' } });
    expect(normalizeStagePatch({ responsibleUserId: USER })).toEqual({ ok: true, patch: { responsibleUserId: USER } });
  });

  it('EVM-031 AC3 null clears: it is a named field, not an absent one', () => {
    expect(normalizeStagePatch({ responsibleUserId: null, dueDate: null })).toEqual({
      ok: true,
      patch: { responsibleUserId: null, dueDate: null },
    });
  });

  it('EVM-031 SR-INPUT-01 a patch that names nothing is refused (the root, required)', () => {
    expect(refused({})).toEqual([{ pointer: '', code: 'required' }]);
    expect(refused({ responsibleUserId: undefined, dueDate: undefined })).toEqual([{ pointer: '', code: 'required' }]);
  });

  it('EVM-031 SR-INPUT-02 the due date is a business day: the bounds 2000-01-01 and 2100-12-31 pass, a day outside them does not (a pointer and a code, never the value)', () => {
    expect(DUE_DATE_MIN).toBe('2000-01-01');
    expect(DUE_DATE_MAX).toBe('2100-12-31');
    expect(normalizeStagePatch({ dueDate: DUE_DATE_MIN }).ok).toBe(true);
    expect(normalizeStagePatch({ dueDate: DUE_DATE_MAX }).ok).toBe(true);
    expect(refused({ dueDate: '1999-12-31' })).toEqual([{ pointer: '/dueDate', code: 'out_of_range' }]);
    expect(refused({ dueDate: '2101-01-01' })).toEqual([{ pointer: '/dueDate', code: 'out_of_range' }]);
    expect(JSON.stringify(refused({ dueDate: '2101-01-01' }))).not.toContain('2101');
  });
});
