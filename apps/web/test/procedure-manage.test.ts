import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api/client.ts';
import { createI18n } from '../src/i18n/i18n.ts';
import { manageFailureText } from '../src/work-orders/procedure-failure-text.ts';
import { classifyManage, hasControlCharacters, normalizeStageName, type ManageFailure } from '../src/work-orders/procedure-manage.ts';

const fail = (status: number, code: string, errors: Array<{ pointer: string; code: string }> = [], retry?: number) =>
  new ApiError(status, { code, errors, traceId: 'abcdef0123456789' }, retry);

describe('answers of the operations on processes and stages (EVM-042 AC1, AC3, AC4, AC6, AC7)', () => {
  it('EVM-042 AC4 every answer has its own kind: active code, deleted parent, retired template, the two limits, 412, 404, closed, forbidden, rate, server', () => {
    const kind = (error: unknown) => classifyManage(error).kind;
    expect(kind(fail(409, 'procedure_already_active'))).toBe('active');
    expect(kind(fail(409, 'parent_deleted'))).toBe('parentDeleted');
    expect(kind(fail(422, 'template_unavailable'))).toBe('templateUnavailable');
    expect(kind(fail(422, 'limit_exceeded', [{ pointer: '', code: 'too_many_stages' }]))).toBe('tooManyStages');
    expect(kind(fail(422, 'limit_exceeded', [{ pointer: '', code: 'too_many_procedures' }]))).toBe('tooManyProcedures');
    expect(kind(fail(409, 'invalid_state_transition'))).toBe('conflict');
    expect(kind(fail(412, 'version_conflict'))).toBe('conflict');
    expect(kind(fail(404, 'not_found'))).toBe('gone');
    expect(kind(fail(409, 'work_order_closed'))).toBe('closed');
    expect(kind(fail(403, 'forbidden'))).toBe('forbidden');
    expect(kind(fail(400, 'validation_failed'))).toBe('invalid');
    expect(classifyManage(fail(429, 'rate_limited', [], 7))).toEqual({ kind: 'rate', seconds: 7 });
    expect(kind(fail(500, 'internal_error'))).toBe('network');
    expect(kind(new Error('offline'))).toBe('network');
    // a scope limit of another operation is not a limit of this one
    expect(kind(fail(422, 'limit_exceeded', [{ pointer: '', code: 'too_many_scope_items' }]))).toBe('tooManyProcedures');
  });

  it('EVM-042 AC4 AC7 every failure has a sentence that names no value; the Editor is told that an administrator restores the order', () => {
    const t = createI18n().t.bind(createI18n());
    const context = { object: 'stage', role: 'administrator', state: 'rozliczone' } as const;
    const kinds: ManageFailure[] = [
      { kind: 'conflict' },
      { kind: 'closed' },
      { kind: 'gone' },
      { kind: 'forbidden' },
      { kind: 'rate', seconds: 5 },
      { kind: 'server', code: 'abcdef01' },
      { kind: 'inProgress' },
      { kind: 'tooManyProcedures' },
      { kind: 'tooManyStages' },
      { kind: 'templateUnavailable' },
      { kind: 'parentDeleted' },
      { kind: 'active' },
      { kind: 'network' },
    ];
    const texts = kinds.map((failure) => manageFailureText(t, failure, context));
    expect(texts.every((text) => text !== '' && !text.includes('workOrder.'))).toBe(true);
    expect(manageFailureText(t, { kind: 'conflict' }, { ...context, object: 'procedure' })).toContain('proces');
    expect(manageFailureText(t, { kind: 'gone' }, { ...context, object: 'procedure' })).toContain('procesu');
    expect(manageFailureText(t, { kind: 'closed' }, { ...context, role: 'editor' })).toContain('przez administratora');
    expect(manageFailureText(t, { kind: 'closed' }, context)).not.toContain('przez administratora');
  });

  it('EVM-042 AC2 the name is normalised (NFC, trimmed) and control characters are found', () => {
    const decomposed = 'Zo' + String.fromCharCode(0x301) + 'ła';
    expect(normalizeStageName('  ' + decomposed + '  ')).toBe(decomposed.normalize('NFC'));
    expect(decomposed).not.toBe(decomposed.normalize('NFC'));
    expect(hasControlCharacters('a\u0007b')).toBe(true);
    expect(hasControlCharacters('a​b')).toBe(true);
    expect(hasControlCharacters('Zwykły tekst')).toBe(false);
  });
});
