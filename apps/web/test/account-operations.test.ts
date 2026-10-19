import type { User } from '@evia/contracts';
import { describe, expect, it } from 'vitest';
import { describeAccountFailure } from '../src/administration/account-failure.ts';
import { alertsAdministrators, hasPasskey, ifMatchOf, operationsOf } from '../src/administration/account-operations.ts';
import { StepUpCancelled } from '../src/administration/use-guarded-call.ts';
import { ApiError } from '../src/api/client.ts';

const user = (patch: Partial<User> = {}): User => ({
  id: '22222222-2222-4222-8222-222222222222',
  email: 'jan.przykladowy@example.com',
  displayName: 'Jan Przykładowy',
  role: 'editor',
  status: 'active',
  invitation: null,
  version: 7,
  activatedAt: '2026-09-01T08:00:00.000Z',
  secondStepMethods: ['passkey'],
  ...patch,
});
const problem = (status: number, code: string, retryAfter?: number) =>
  new ApiError(status, { code, traceId: 'abcdef0123456789' }, retryAfter);

describe('the operations of the menu of a row (EVM-027 AC8)', () => {
  it('EVM-027 AC8 an active account offers role, sessions, reset and deactivation in that order', () => {
    expect(operationsOf(user())).toEqual(['role', 'sessions', 'reset', 'deactivate']);
  });

  it('EVM-027 AC8 an account that waits offers role and deactivation, a deactivated one only the reactivation, an unknown status nothing', () => {
    expect(operationsOf(user({ status: 'invited' }))).toEqual(['role', 'deactivate']);
    expect(operationsOf(user({ status: 'deactivated' }))).toEqual(['reactivate']);
    expect(operationsOf(user({ status: 'future' as User['status'] }))).toEqual([]);
  });

  it('EVM-027 AC8 If-Match is the strong ETag of the version of the account', () => {
    expect(ifMatchOf(user())).toBe('"7"');
  });
});

describe('the alert for the Administrators (EVM-027 AC7)', () => {
  const admin = user({ role: 'administrator' });

  it('EVM-027 AC7 granting and taking away the role Administrator alert, Edytor ↔ Tylko odczyt does not', () => {
    expect(alertsAdministrators('role', user(), 'administrator')).toBe(true);
    expect(alertsAdministrators('role', admin, 'editor')).toBe(true);
    expect(alertsAdministrators('role', user(), 'read_only')).toBe(false);
    expect(alertsAdministrators('role', user())).toBe(false);
  });

  it('EVM-027 AC7 the deactivation of an active Administrator, the reactivation and the reset alert; the end of sessions never', () => {
    expect(alertsAdministrators('deactivate', admin)).toBe(true);
    expect(alertsAdministrators('deactivate', { ...admin, status: 'invited' })).toBe(false);
    expect(alertsAdministrators('deactivate', user())).toBe(false);
    expect(alertsAdministrators('reactivate', { ...admin, status: 'deactivated' })).toBe(true);
    expect(alertsAdministrators('reactivate', user({ status: 'deactivated' }))).toBe(false);
    expect(alertsAdministrators('reset', admin)).toBe(true);
    expect(alertsAdministrators('reset', user())).toBe(false);
    expect(alertsAdministrators('sessions', admin)).toBe(false);
  });

  it('EVM-027 AC1 only a passkey counts as a method that may make an Administrator', () => {
    expect(hasPasskey(user())).toBe(true);
    expect(hasPasskey(user({ secondStepMethods: ['totp'] }))).toBe(false);
    expect(hasPasskey(user({ secondStepMethods: [] }))).toBe(false);
  });
});

describe('the failure of an operation (EVM-027 AC5, AC8)', () => {
  it('EVM-027 AC5 the codes of 409 each have their own kind', () => {
    expect(describeAccountFailure(problem(409, 'last_active_administrator'))).toEqual({ kind: 'lastAdministrator' });
    expect(describeAccountFailure(problem(409, 'own_account_not_allowed'))).toEqual({ kind: 'ownAccount' });
    expect(describeAccountFailure(problem(409, 'administrator_passkey_required'))).toEqual({ kind: 'passkeyRequired' });
    expect(describeAccountFailure(problem(409, 'invalid_state_transition'))).toEqual({ kind: 'stateChanged' });
    expect(describeAccountFailure(problem(409, 'something_new'))).toEqual({ kind: 'server', code: 'abcdef01' });
  });

  it('EVM-027 AC8 412 and 428 say the version moved on, 404 that the account is gone, 401 that the session ended', () => {
    expect(describeAccountFailure(problem(412, 'version_conflict'))).toEqual({ kind: 'versionConflict' });
    expect(describeAccountFailure(problem(428, 'precondition_required'))).toEqual({ kind: 'versionConflict' });
    expect(describeAccountFailure(problem(404, 'not_found'))).toEqual({ kind: 'gone' });
    expect(describeAccountFailure(problem(401, 'session_revoked'))).toEqual({ kind: 'ended' });
    expect(describeAccountFailure(problem(403, 'forbidden'))).toEqual({ kind: 'forbidden' });
    expect(describeAccountFailure(problem(400, 'validation_failed'))).toEqual({ kind: 'fields' });
  });

  it('EVM-027 AC8 429 gives whole minutes, no answer or a 5xx is the network, a cancelled W-04 is "not confirmed"', () => {
    expect(describeAccountFailure(problem(429, 'rate_limited', 300))).toEqual({ kind: 'rate', minutes: 5 });
    expect(describeAccountFailure(new ApiError(0, undefined))).toEqual({ kind: 'network' });
    expect(describeAccountFailure(problem(503, 'unavailable'))).toEqual({ kind: 'network' });
    expect(describeAccountFailure(new Error('x'))).toEqual({ kind: 'network' });
    expect(describeAccountFailure(new StepUpCancelled())).toEqual({ kind: 'notConfirmed' });
    expect(describeAccountFailure(problem(418, 'teapot'))).toEqual({ kind: 'server', code: 'abcdef01' });
  });
});
