import { AUTHZ_MANIFEST, MFA_ENROLLMENT_OPERATIONS, PUBLIC_OPERATIONS, type AuthzManifest } from '@evia/contracts/authz';
import { describe, expect, it } from 'vitest';
import { buildMatrix, expectationFor, type Caller, type MatrixLists } from './role-matrix.ts';

const lists: MatrixLists = { publicOperations: PUBLIC_OPERATIONS, mfaEnrollmentOperations: MFA_ENROLLMENT_OPERATIONS };

const synthetic: AuthzManifest = {
  openThing: { method: 'get', path: '/api/open', query: [], authz: { public: true } },
  readThing: {
    method: 'get',
    path: '/api/things',
    query: [],
    authz: { roles: ['administrator', 'editor', 'read_only'], channels: ['web', 'mobile'] },
  },
  editThing: { method: 'post', path: '/api/things', query: [], authz: { roles: ['administrator', 'editor'], channels: ['web'] } },
  adminThing: {
    method: 'post',
    path: '/api/admin',
    query: [],
    authz: { roles: ['administrator'], channels: ['web'], allowDuringMfaEnrollment: true },
  },
  getThing: {
    method: 'get',
    path: '/api/things/{thingId}',
    query: [],
    authz: { roles: ['administrator', 'editor'], channels: ['web'], policy: 'thing.read', anchor: 'path.thingId' },
  },
};
const syntheticLists: MatrixLists = { publicOperations: ['openThing'], mfaEnrollmentOperations: ['adminThing'] };

const session = (
  role: 'administrator' | 'editor' | 'read_only',
  channel: 'web' | 'mobile',
  state: 'active' | 'mfa_enrollment' = 'active',
): Caller => ({
  kind: 'session',
  role,
  channel,
  state,
});

describe('the role matrix generated from the contract (EVM-016 AC8; SR-AUTHZ-01, SR-AUTHZ-05)', () => {
  const cells = buildMatrix(AUTHZ_MANIFEST, lists);

  it('EVM-016 AC8 completeness: every operation of the contract has cells, and nothing but the contract does (100%)', () => {
    const covered = new Set(cells.map((cell) => cell.operationId));
    expect([...covered].sort()).toEqual(Object.keys(AUTHZ_MANIFEST).sort());
    for (const operationId of Object.keys(AUTHZ_MANIFEST)) {
      const own = cells.filter((cell) => cell.operationId === operationId);
      const callers = new Set(own.map((cell) => JSON.stringify(cell.caller)));
      // anonymous, revoked, 3 roles x 2 channels x 2 states
      expect(callers.size, operationId).toBe(14);
    }
  });

  it('EVM-016 AC8 an anonymous caller gets 401 for every operation except the public ones (health, activation check and password)', () => {
    const anonymous = cells.filter((cell) => cell.caller.kind === 'anonymous');
    const allowed = anonymous.filter((cell) => cell.expectation.outcome === 'allowed').map((cell) => cell.operationId);
    expect(allowed.sort()).toEqual([...PUBLIC_OPERATIONS].sort());
    for (const cell of anonymous.filter((item) => item.expectation.outcome !== 'allowed')) {
      expect(cell.expectation, cell.operationId).toEqual({ outcome: 'denied', status: 401, code: 'unauthenticated' });
    }
  });

  it('EVM-016 AC8 the contract has no operation on the mobile channel in M1, so every mobile session is denied everywhere that is not public', () => {
    for (const cell of cells.filter((item) => item.caller.kind === 'session' && item.caller.channel === 'mobile')) {
      const isPublic = PUBLIC_OPERATIONS.includes(cell.operationId);
      expect(cell.expectation.outcome === 'allowed', `${cell.operationId} ${JSON.stringify(cell.caller)}`).toBe(isPublic);
    }
  });

  it('EVM-016 AC4 a session in mfa_enrollment is denied everywhere except the enrolment operations, for every role', () => {
    const allowedWhileEnrolling = cells
      .filter(
        (cell) =>
          cell.caller.kind === 'session' &&
          cell.caller.state === 'mfa_enrollment' &&
          cell.caller.channel === 'web' &&
          cell.expectation.outcome === 'allowed',
      )
      .map((cell) => cell.operationId);
    const unique = [...new Set(allowedWhileEnrolling)].sort();
    expect(unique).toEqual([...MFA_ENROLLMENT_OPERATIONS, ...PUBLIC_OPERATIONS].sort());
    for (const cell of cells.filter((item) => item.caller.kind === 'session' && item.caller.state === 'mfa_enrollment')) {
      if (
        cell.expectation.outcome === 'denied' &&
        !PUBLIC_OPERATIONS.includes(cell.operationId) &&
        !MFA_ENROLLMENT_OPERATIONS.includes(cell.operationId)
      ) {
        expect(cell.expectation, cell.operationId).toMatchObject({ status: 403, code: 'mfa_enrollment_required' });
      }
    }
  });

  it('EVM-016 AC8 the real contract has no operation with an object parameter yet, so it has no IDOR cells (the synthetic contract below does)', () => {
    expect(cells.filter((cell) => cell.idor)).toEqual([]);
  });
});

describe('expectations of the matrix on a synthetic contract (EVM-016 AC8; SR-AUTHZ-12)', () => {
  const expect_ = (operationId: string, caller: Caller) => expectationFor(operationId, synthetic, syntheticLists, caller);
  const allowed = { outcome: 'allowed' };
  const forbidden = { outcome: 'denied', status: 403, code: 'forbidden' };

  it('EVM-016 AC8 roles: only the roles of the policy are entitled', () => {
    expect(expect_('editThing', session('administrator', 'web'))).toEqual(allowed);
    expect(expect_('editThing', session('editor', 'web'))).toEqual(allowed);
    expect(expect_('editThing', session('read_only', 'web'))).toEqual(forbidden);
    expect(expect_('readThing', session('read_only', 'web'))).toEqual(allowed);
  });

  it('EVM-016 AC8 channels: a channel outside the policy is forbidden, and the read-only role has no mobile even where the policy lists it', () => {
    expect(expect_('editThing', session('administrator', 'mobile'))).toEqual(forbidden);
    expect(expect_('readThing', session('editor', 'mobile'))).toEqual(allowed);
    expect(expect_('readThing', session('read_only', 'mobile'))).toEqual(forbidden);
  });

  it('EVM-016 AC8 public operations are open to everybody; anonymous and revoked callers are 401 elsewhere', () => {
    for (const caller of [{ kind: 'anonymous' }, session('read_only', 'web')] as Caller[])
      expect(expect_('openThing', caller)).toEqual(allowed);
    expect(expect_('readThing', { kind: 'anonymous' })).toEqual({ outcome: 'denied', status: 401, code: 'unauthenticated' });
    expect(expect_('readThing', { kind: 'revoked', role: 'administrator', channel: 'web' })).toEqual({
      outcome: 'denied',
      status: 401,
      code: 'session_revoked',
    });
  });

  it('EVM-016 AC4 enrolment: an operation must be on the list and declare the flag; the role is checked after the state', () => {
    expect(expect_('adminThing', session('administrator', 'web', 'mfa_enrollment'))).toEqual(allowed);
    expect(expect_('adminThing', session('editor', 'web', 'mfa_enrollment'))).toEqual(forbidden);
    expect(expect_('readThing', session('administrator', 'web', 'mfa_enrollment'))).toEqual({
      outcome: 'denied',
      status: 403,
      code: 'mfa_enrollment_required',
    });
    expect(() => expect_('missing', { kind: 'anonymous' })).toThrow('not in the manifest');
  });

  it('EVM-016 AC8 IDOR: an operation that addresses an object gets one extra cell per entitled caller, expecting 404', () => {
    const cells = buildMatrix(synthetic, syntheticLists);
    const idor = cells.filter((cell) => cell.idor);
    expect(new Set(idor.map((cell) => cell.operationId))).toEqual(new Set(['getThing']));
    expect(idor.every((cell) => JSON.stringify(cell.expectation) === JSON.stringify({ outcome: 'not_found' }))).toBe(true);
    // entitled: administrator and editor on web, active session
    expect(idor.map((cell) => JSON.stringify(cell.caller)).sort()).toEqual(
      [JSON.stringify(session('administrator', 'web')), JSON.stringify(session('editor', 'web'))].sort(),
    );
    // the entitled callers also have a normal "own object" cell
    expect(cells.filter((cell) => cell.operationId === 'getThing' && !cell.idor && cell.expectation.outcome === 'allowed')).toHaveLength(2);
    // an operation with an anchor but without a path parameter is an object operation too
    const anchored: AuthzManifest = {
      search: {
        method: 'post',
        path: '/api/search',
        query: [],
        authz: { roles: ['administrator'], channels: ['web'], anchor: 'body.workOrderId' },
      },
    };
    expect(buildMatrix(anchored, syntheticLists).filter((cell) => cell.idor)).toHaveLength(1);
  });
});
