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
  stepThing: {
    method: 'get',
    path: '/api/protected',
    query: [],
    authz: { roles: ['administrator', 'editor'], channels: ['web'], stepUp: true },
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
      // anonymous, revoked, expired, 3 roles x 2 channels x 2 states, the Administrator with a fresh and a stale key on both channels
      expect(callers.size, operationId).toBe(19);
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

  it('EVM-019 AC7 EVM-018 AC6 EVM-030 AC7 EVM-039 AC7 the operations of the real contract with an object parameter are getWorkOrderTemplate, the four reads of a work order, the status command and the detail and edit of a customer: the IDOR cells of each are the roles entitled to it on the web channel', () => {
    const idor = cells.filter((cell) => cell.idor);
    const operations = ['getWorkOrderTemplate', 'getWorkOrder', 'listWorkOrderScopeItems', 'getWorkOrderCustomer', 'getWorkOrderSite'];
    const writers = ['transitionWorkOrder', 'updateCustomer'];
    const rolesOf = (operationId: string): string[] =>
      writers.includes(operationId) ? ['administrator', 'editor'] : ['administrator', 'editor', 'read_only'];
    const all = [...operations, 'getCustomer', ...writers];
    expect(new Set(idor.map((cell) => cell.operationId))).toEqual(new Set(all));
    for (const operationId of all) {
      expect(
        idor
          .filter((cell) => cell.operationId === operationId)
          .map((cell) => JSON.stringify(cell.caller))
          .sort(),
      ).toEqual(
        rolesOf(operationId)
          .map((role) => JSON.stringify({ kind: 'session', role, channel: 'web', state: 'active' }))
          .sort(),
      );
    }
    for (const cell of idor) expect(cell.expectation).toEqual({ outcome: 'not_found' });
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
    expect(expect_('readThing', { kind: 'expired', role: 'administrator', channel: 'web' })).toEqual({
      outcome: 'denied',
      status: 401,
      code: 'session_expired',
    });
    expect(expect_('openThing', { kind: 'expired', role: 'administrator', channel: 'web' })).toEqual(allowed);
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
    // the entitled callers also have a normal "own object" cell (the two Administrator variants with a key too, which have no IDOR cell of their own)
    expect(cells.filter((cell) => cell.operationId === 'getThing' && !cell.idor && cell.expectation.outcome === 'allowed')).toHaveLength(4);
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

describe('the step-up in the matrix (EVM-029 AC7; SR-AUTHZ-05, SR-AUTHZ-11, SR-SESS-08)', () => {
  const expect_ = (operationId: string, caller: Caller) => expectationFor(operationId, synthetic, syntheticLists, caller);
  const withKey = (role: 'administrator' | 'editor' | 'read_only', channel: 'web' | 'mobile', passkey: 'fresh' | 'stale'): Caller => ({
    kind: 'session',
    role,
    channel,
    state: 'active',
    passkey,
  });
  const stepUpRequired = { outcome: 'denied', status: 403, code: 'step_up_required' };
  const forbidden = { outcome: 'denied', status: 403, code: 'forbidden' };

  it('EVM-029 AC7 an operation with stepUp: a fresh key passes, a stale key and no key at all (recovery code, password) ask for a step-up', () => {
    expect(expect_('stepThing', withKey('administrator', 'web', 'fresh'))).toEqual({ outcome: 'allowed' });
    expect(expect_('stepThing', withKey('administrator', 'web', 'stale'))).toEqual(stepUpRequired);
    expect(expect_('stepThing', session('administrator', 'web'))).toEqual(stepUpRequired);
  });

  it('EVM-029 AC7 the role comes first: a role outside the policy is forbidden whatever its key, and so is a channel outside the policy', () => {
    expect(expect_('stepThing', withKey('read_only', 'web', 'stale'))).toEqual(forbidden);
    expect(expect_('stepThing', withKey('read_only', 'web', 'fresh'))).toEqual(forbidden);
    expect(expect_('stepThing', withKey('administrator', 'mobile', 'fresh'))).toEqual(forbidden);
    expect(expect_('stepThing', session('editor', 'web'))).toEqual(stepUpRequired);
  });

  it('EVM-029 AC7 an operation without stepUp ignores the key: a session without a key is allowed, a fresh key changes nothing', () => {
    expect(expect_('adminThing', session('administrator', 'web'))).toEqual({ outcome: 'allowed' });
    expect(expect_('adminThing', withKey('administrator', 'web', 'fresh'))).toEqual({ outcome: 'allowed' });
  });

  it('EVM-029 AC7 the audit log in the real contract: Administrator after a fresh key only, Editor and Read-only forbidden in every variant, never a step-up', () => {
    const cells = buildMatrix(AUTHZ_MANIFEST, lists).filter((cell) => cell.operationId === 'listAuditEvents');
    const allowed = cells.filter((cell) => cell.expectation.outcome === 'allowed');
    expect(allowed.map((cell) => JSON.stringify(cell.caller))).toEqual([JSON.stringify(withKey('administrator', 'web', 'fresh'))]);
    for (const cell of cells.filter((item) => item.caller.kind === 'session' && item.caller.role !== 'administrator')) {
      expect(cell.expectation, JSON.stringify(cell.caller)).not.toMatchObject({ code: 'step_up_required' });
    }
    const stepUp = cells.filter((cell) => JSON.stringify(cell.expectation) === JSON.stringify(stepUpRequired));
    expect(stepUp.map((cell) => JSON.stringify(cell.caller)).sort()).toEqual(
      [JSON.stringify(withKey('administrator', 'web', 'stale')), JSON.stringify(session('administrator', 'web'))].sort(),
    );
  });

  it('EVM-029 AC7 the two operations of the step-up itself need no fresh key (an Administrator on the web channel may call them from any session)', () => {
    for (const operationId of ['getStepUpPasskeyOptions', 'stepUp']) {
      expect(expectationFor(operationId, AUTHZ_MANIFEST, lists, session('administrator', 'web')), operationId).toEqual({
        outcome: 'allowed',
      });
      expect(expectationFor(operationId, AUTHZ_MANIFEST, lists, session('editor', 'web')), operationId).toEqual(forbidden);
      expect(expectationFor(operationId, AUTHZ_MANIFEST, lists, session('administrator', 'web', 'mfa_enrollment')), operationId).toEqual({
        outcome: 'denied',
        status: 403,
        code: 'mfa_enrollment_required',
      });
    }
  });
});
