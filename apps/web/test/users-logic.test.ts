import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api/client.ts';
import { roleLabel, statusLabel } from '../src/administration/labels.ts';
import { describeUserFailure } from '../src/administration/user-failure.ts';
import {
  buildInviteBody,
  checkInvite,
  EMPTY_INVITE,
  fieldOfPointer,
  firstInvalid,
  isAddressShaped,
} from '../src/administration/user-form.ts';
import { StepUpCancelled } from '../src/administration/use-guarded-call.ts';
import { createI18n } from '../src/i18n/i18n.ts';

const problem = (status: number, code: string, extra: object = {}, retryAfter?: number) =>
  new ApiError(status, { code, traceId: 'abcdef0123456789', ...extra }, retryAfter);

describe('the form of the invitation (EVM-024 AC1, AC2)', () => {
  it('EVM-024 AC2 an address is stopped when it has no @, two @, blanks, CR/LF, quotes or a list separator', () => {
    expect(isAddressShaped(' anna.nowak@example.com ')).toBe(true);
    for (const bad of [
      '',
      'anna',
      '@example.com',
      'anna@',
      'a@b@c.test',
      'a b@c.test',
      'a@b.test\r\nBcc:x@y.test',
      '"a@b"@example.com',
      'a@b.test,c@d.test',
      'a@b.test;c@d.test',
      '<a@b.test>',
    ]) {
      expect(isAddressShaped(bad), bad).toBe(false);
    }
  });

  it('EVM-024 AC1 the body has the identifier named by the panel, trimmed text and the chosen role; nothing else', () => {
    const body = buildInviteBody({ email: ' Anna@Example.com ', displayName: ' Anna ', role: 'read_only' }, 'id-1');
    expect(body).toEqual({ id: 'id-1', email: 'Anna@Example.com', displayName: 'Anna', role: 'read_only' });
    expect(EMPTY_INVITE.role).toBe('editor');
  });

  it('EVM-024 AC2 the check names the fields that cannot be sent, and a pointer of the server maps to a field of the form', () => {
    expect(checkInvite({ email: 'x', displayName: ' ', role: 'editor' })).toEqual([
      { field: 'email', code: 'invalid_email' },
      { field: 'displayName', code: 'required' },
    ]);
    expect(checkInvite({ email: 'a@b.test', displayName: 'A', role: 'editor' })).toEqual([]);
    expect(fieldOfPointer('/role')).toBe('role');
    expect(fieldOfPointer('/id')).toBeUndefined();
    expect(firstInvalid({ displayName: 'x', role: 'y' })).toBe('displayName');
    expect(firstInvalid({})).toBeUndefined();
  });
});

describe('failures of an operation on an account (EVM-024 AC1, AC4, AC5, AC7)', () => {
  it('EVM-024 AC7 maps every status to a kind the dialog has a sentence for', () => {
    expect(describeUserFailure(new StepUpCancelled(), false)).toEqual({ kind: 'notConfirmed' });
    expect(describeUserFailure(new Error('x'), false)).toEqual({ kind: 'network' });
    expect(describeUserFailure(new ApiError(0, undefined), false)).toEqual({ kind: 'network' });
    expect(describeUserFailure(problem(503, 'unavailable'), false)).toEqual({ kind: 'network' });
    expect(describeUserFailure(problem(400, 'validation_failed'), true)).toEqual({ kind: 'fields' });
    expect(describeUserFailure(problem(400, 'validation_failed'), false)).toEqual({ kind: 'server', code: 'abcdef01' });
    expect(describeUserFailure(problem(403, 'forbidden'), false)).toEqual({ kind: 'forbidden' });
    expect(describeUserFailure(problem(404, 'not_found'), false)).toEqual({ kind: 'gone' });
    expect(describeUserFailure(problem(409, 'email_conflict', { existingUserId: 'u1' }), false)).toEqual({
      kind: 'conflict',
      existingUserId: 'u1',
    });
    expect(describeUserFailure(problem(409, 'idempotency_in_progress'), false)).toEqual({ kind: 'inProgress' });
    expect(describeUserFailure(problem(409, 'invalid_state_transition'), false)).toEqual({ kind: 'notInvited' });
    expect(describeUserFailure(problem(409, 'id_conflict'), false)).toEqual({ kind: 'network' });
    expect(describeUserFailure(problem(409, 'idempotency_mismatch'), false)).toEqual({ kind: 'network' });
    expect(describeUserFailure(problem(409, 'other'), false)).toEqual({ kind: 'server', code: 'abcdef01' });
    expect(describeUserFailure(problem(429, 'rate_limited', {}, 90), false)).toEqual({ kind: 'rate', minutes: 2 });
  });

  it('EVM-024 AC5 a role or a status of a newer API is shown as a dash or "Nieznany status", never raw', () => {
    const t = createI18n().t.bind(createI18n());
    expect(roleLabel(t, 'superuser')).toBe('—');
    expect(statusLabel(t, 'archived')).toBe('Nieznany status');
    expect(roleLabel(t, 'read_only')).toBe('Tylko odczyt');
  });
});
