import { describe, expect, it } from 'vitest';
import { describeAccountFailure } from '../src/account/account-failure.ts';
import { MAX_DISPLAY_NAME, MAX_PASSKEY_NAME, nameProblem, normaliseName, serverNameProblem } from '../src/account/account-input.ts';
import { pluralOf } from '../src/account/plural.ts';
import { lastMethodRule } from '../src/account/second-step-card.tsx';
import { ReauthenticationCancelled } from '../src/account/use-reauth-call.ts';
import { ApiError } from '../src/api/client.ts';

const problem = (status: number, code: string, extra: Record<string, unknown> = {}, retryAfter?: number) =>
  new ApiError(status, { code, traceId: 'abcdef0123456789', ...extra }, retryAfter);

describe('names of the account (EVM-028 AC1, AC3)', () => {
  it('EVM-028 AC1 the name is normalised to NFC and trimmed', () => {
    expect(normaliseName('  Zófia ')).toBe('Zófia');
  });

  it('EVM-028 AC1 an empty name is required unless the name is optional (the key); the limit counts code points, not UTF-16 units', () => {
    expect(nameProblem('   ', MAX_DISPLAY_NAME)).toBe('required');
    expect(nameProblem('   ', MAX_PASSKEY_NAME, { optional: true })).toBeNull();
    expect(nameProblem('😀'.repeat(200), MAX_DISPLAY_NAME)).toBeNull();
    expect(nameProblem('😀'.repeat(201), MAX_DISPLAY_NAME)).toBe('too_long');
    expect(nameProblem('a'.repeat(60), MAX_PASSKEY_NAME)).toBeNull();
    expect(nameProblem('a'.repeat(61), MAX_PASSKEY_NAME)).toBe('too_long');
  });

  it.each([['line\nbreak'], ['bidi‮mark'], ['zero​width'], ['sep arator'], ['tab\tcharacter']])(
    'EVM-028 AC1 control, format and separator characters are refused (%j)',
    (name) => {
      expect(nameProblem(name, MAX_DISPLAY_NAME)).toBe('invalid_characters');
    },
  );

  it('EVM-028 AC1 the problem named by the server is read for the pointer of the field only', () => {
    const errors = [
      { pointer: '/displayName', code: 'too_long' },
      { pointer: '/name', code: 'unknown_code' },
    ];
    expect(serverNameProblem(errors, '/displayName')).toBe('too_long');
    expect(serverNameProblem(errors, '/name')).toBeNull();
    expect(serverNameProblem(errors, '/other')).toBeNull();
  });
});

describe('the rule of the last method (EVM-028 AC4)', () => {
  it('EVM-028 AC4 an Administrator keeps one passkey; the code of the app never counts and is always removable', () => {
    expect(lastMethodRule('administrator', 1, true)).toEqual({ passkey: true, totp: false });
    expect(lastMethodRule('administrator', 2, false)).toEqual({ passkey: false, totp: false });
  });

  it.each(['editor', 'read_only'] as const)('EVM-028 AC4 %s keeps one method of any kind', (role) => {
    expect(lastMethodRule(role, 1, false)).toEqual({ passkey: true, totp: true });
    expect(lastMethodRule(role, 0, true)).toEqual({ passkey: true, totp: true });
    expect(lastMethodRule(role, 1, true)).toEqual({ passkey: false, totp: false });
    expect(lastMethodRule(role, 2, false)).toEqual({ passkey: false, totp: false });
  });
});

describe('the failures of the operations of the account (EVM-028 AC3, AC4, AC8)', () => {
  it('EVM-028 AC4 the last method says what to add first (passkey for an Administrator, any method for the rest)', () => {
    expect(
      describeAccountFailure(problem(409, 'last_second_step_method', { errors: [{ pointer: '/passkeyId', code: 'passkey_required' }] })),
    ).toEqual({
      kind: 'lastMethod',
      required: 'passkey',
    });
    expect(
      describeAccountFailure(problem(409, 'last_second_step_method', { errors: [{ pointer: '/passkeyId', code: 'method_required' }] })),
    ).toEqual({
      kind: 'lastMethod',
      required: 'method',
    });
    expect(describeAccountFailure(problem(409, 'last_second_step_method'))).toEqual({ kind: 'lastMethod', required: 'method' });
  });

  it("EVM-028 AC8 404 is one thing for a stranger's and a missing object; the others have their kinds", () => {
    expect(describeAccountFailure(problem(404, 'not_found'))).toEqual({ kind: 'notFound' });
    expect(describeAccountFailure(problem(409, 'current_session'))).toEqual({ kind: 'currentSession' });
    expect(describeAccountFailure(problem(409, 'mfa_already_configured'))).toEqual({ kind: 'configured' });
    expect(describeAccountFailure(problem(503, 'service_unavailable'))).toEqual({ kind: 'unavailable' });
    expect(describeAccountFailure(problem(401, 'session_revoked'))).toEqual({ kind: 'ended' });
    expect(describeAccountFailure(problem(403, 'reauthentication_required'))).toEqual({ kind: 'reauthenticationExpired' });
    expect(describeAccountFailure(problem(403, 'forbidden'))).toEqual({ kind: 'forbidden' });
    expect(describeAccountFailure(problem(429, 'rate_limited', {}, 125))).toEqual({ kind: 'rate', minutes: 3 });
  });

  it('EVM-028 AC8 an unknown answer shows only the trace code; no answer is a failure of the network; a cancelled W-04 is "cancelled"', () => {
    expect(describeAccountFailure(problem(500, 'internal_error'))).toEqual({ kind: 'server', code: 'abcdef01' });
    expect(describeAccountFailure(problem(409, 'something_new'))).toEqual({ kind: 'server', code: 'abcdef01' });
    expect(describeAccountFailure(new ApiError(418, undefined))).toEqual({ kind: 'server', code: 'unknown' });
    expect(describeAccountFailure(new ApiError(0, undefined))).toEqual({ kind: 'network' });
    expect(describeAccountFailure(new TypeError('Failed to fetch'))).toEqual({ kind: 'network' });
    expect(describeAccountFailure(new ReauthenticationCancelled())).toEqual({ kind: 'cancelled' });
  });
});

describe('Polish count words (styleguide § 6.3)', () => {
  it.each([
    [1, 'one'],
    [2, 'few'],
    [4, 'few'],
    [5, 'many'],
    [12, 'many'],
    [22, 'few'],
    [0, 'many'],
  ] as const)('EVM-028 AC6 %i → %s', (count, form) => {
    expect(pluralOf(count)).toBe(form);
  });
});
