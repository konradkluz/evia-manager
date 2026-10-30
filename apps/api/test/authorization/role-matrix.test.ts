import {
  implementedManifest,
  MFA_ENROLLMENT_OPERATIONS,
  onlyImplemented,
  PUBLIC_OPERATIONS,
  type AuthzManifest,
} from '@evia/contracts/authz';
import { zCreateMediaAssetDownloadUrlBody } from '@evia/contracts/zod';
import { describe, expect, it } from 'vitest';
import { DOWNLOAD_VARIANTS, mayRequest } from '../../src/modules/media/domain/downloads.ts';
import { buildMatrix, expectationFor, type Caller, type MatrixLists } from './role-matrix.ts';

/** The operations that have a route: planned ones (`x-evia-planned`) join the matrix when their story removes the marker. */
const AUTHZ_MANIFEST = implementedManifest();
const IMPLEMENTED_PUBLIC = onlyImplemented(PUBLIC_OPERATIONS);

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
  removeThing: {
    method: 'delete',
    path: '/api/things/{thingId}/parts/{partId}',
    query: [],
    authz: { roles: ['administrator'], channels: ['web'], stepUp: true },
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
    expect(allowed.sort()).toEqual([...IMPLEMENTED_PUBLIC].sort());
    for (const cell of anonymous.filter((item) => item.expectation.outcome !== 'allowed')) {
      expect(cell.expectation, cell.operationId).toEqual({ outcome: 'denied', status: 401, code: 'unauthenticated' });
    }
  });

  it('EVM-094 AC8 a mobile session is allowed on the public operations and on the operations of the mobile channel for the Administrator and the Editor — never for the Read-only role (SR-AUTHZ-06), never on an operation of the panel', () => {
    for (const cell of cells.filter((item) => item.caller.kind === 'session' && item.caller.channel === 'mobile')) {
      const policy = AUTHZ_MANIFEST[cell.operationId]?.authz;
      const mobileOperation = policy?.public !== true && policy?.channels?.includes('mobile') === true;
      const role = cell.caller.kind === 'session' ? cell.caller.role : undefined;
      const expected = PUBLIC_OPERATIONS.includes(cell.operationId) || (mobileOperation && role !== 'read_only');
      expect(cell.expectation.outcome === 'allowed', `${cell.operationId} ${JSON.stringify(cell.caller)}`).toBe(expected);
    }
  });

  it('EVM-094 AC8 the cookie of the panel is ignored by an operation of the mobile channel (401 unauthenticated, whatever the session), and the operations of the mobile channel read a Bearer token', () => {
    const mobileOperations = Object.entries(AUTHZ_MANIFEST).filter(
      ([, item]) => item.authz.public !== true && item.authz.channels?.includes('web') !== true,
    );
    expect(mobileOperations.map(([id]) => id).sort()).toEqual(['getClientConfig', 'mobileLogout']);
    for (const [id] of mobileOperations) {
      for (const cell of cells.filter((item) => item.operationId === id && item.credential === 'bearer')) {
        const viaCookie = cell.caller.kind !== 'session' || cell.caller.channel !== 'mobile';
        if (viaCookie)
          expect(cell.expectation, `${id} ${JSON.stringify(cell.caller)}`).toEqual({
            outcome: 'denied',
            status: 401,
            code: 'unauthenticated',
          });
      }
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
    expect(unique).toEqual([...MFA_ENROLLMENT_OPERATIONS, ...IMPLEMENTED_PUBLIC].sort());
    // (an operation of the mobile channel alone reads a Bearer token: the cookie of an enrolling session is ignored there, 401 — see the test of the mobile channel)
    for (const cell of cells.filter(
      (item) => item.caller.kind === 'session' && item.caller.state === 'mfa_enrollment' && item.credential === 'cookie',
    )) {
      if (
        cell.expectation.outcome === 'denied' &&
        !PUBLIC_OPERATIONS.includes(cell.operationId) &&
        !MFA_ENROLLMENT_OPERATIONS.includes(cell.operationId)
      ) {
        expect(cell.expectation, cell.operationId).toMatchObject({ status: 403, code: 'mfa_enrollment_required' });
      }
    }
  });

  it('EVM-019 AC7 EVM-018 AC6 EVM-030 AC7 EVM-039 AC7 EVM-036 AC7 EVM-031 AC7 EVM-032 AC7 EVM-037 AC8 EVM-035 AC8 EVM-053 AC7 EVM-057 AC8 EVM-042 AC6 EVM-060 AC6 the operations of the real contract with an object parameter are getWorkOrderTemplate, the five reads of a work order, the status command, the deletion and the restoration of an order (Administrator only), the change of its data, the five operations on its scope, the processes of an order, the change of a stage, the journal of an order, the payment milestones of an order and the detail and edit of a customer, a site and a party: the IDOR cells of each are the roles entitled to it on the web channel — for the deletion of a milestone (a step-up), the Administrator with a fresh key; the same for the resend of an invitation (EVM-024)', () => {
    const idor = cells.filter((cell) => cell.idor);
    const operations = [
      'getWorkOrderTemplate',
      'getWorkOrder',
      'listWorkOrderScopeItems',
      'getWorkOrderCustomer',
      'getWorkOrderSite',
      'listWorkOrderSiteOrders',
      'listWorkOrderProcedures',
      'listTimelineEntries',
      'getTimelineEntry',
      'getWorkOrderScopeItem',
      'listPaymentMilestones',
      // EVM-044: the media of an order (the list is read by every role; the rest are the writers below)
      'listMediaAssets',
      // EVM-068: the signed address of a thumbnail or a preview (every role of the web)
      'createMediaAssetDownloadUrl',
    ];
    const writers = [
      'transitionWorkOrder',
      'updateWorkOrder',
      'createWorkOrderScopeItem',
      'updateWorkOrderScopeItem',
      'deleteWorkOrderScopeItem',
      'updateCustomer',
      'updateSite',
      'updateParty',
      'updateProcedureStage',
      'transitionProcedureStage',
      'createTimelineEntry',
      'createPaymentMilestone',
      'updatePaymentMilestone',
      // EVM-042: the processes and stages added and deleted by hand
      'createWorkOrderProcedure',
      'createProcedureStage',
      'deleteWorkOrderProcedure',
      'deleteProcedureStage',
      'transitionPaymentMilestone',
      // EVM-044: the batch of media and the six operations of an upload session
      'createMediaAssets',
      'createUploadSession',
      'listUploadParts',
      'getUploadPartUrl',
      'completeUploadSession',
      'abortUploadSession',
    ];
    // EVM-042: the restoration and the list of the deleted ones are the Administrator's alone; EVM-060: so are the deletion and the
    // restoration of an order (no step-up at the level of the operation: it depends on the milestones, so the cells are those of any role)
    const administratorOnly = [
      'restoreWorkOrderProcedure',
      'restoreProcedureStage',
      'listDeletedWorkOrderProcedures',
      'deleteWorkOrder',
      'restoreWorkOrder',
      // EVM-040: the deletion and the restoration of an entry of the journal (the redaction is below: it has a step-up)
      'deleteTimelineEntry',
      'restoreTimelineEntry',
      // EVM-041: the deletion and the restoration of a customer (the anonymization is below: it has a step-up)
      'deleteCustomer',
      'restoreCustomer',
    ];
    const rolesOf = (operationId: string): string[] => {
      if (administratorOnly.includes(operationId)) return ['administrator'];
      return writers.includes(operationId) ? ['administrator', 'editor'] : ['administrator', 'editor', 'read_only'];
    };
    // EVM-028: the key of somebody else — the removal of a key is for every role (no step-up of the guard: the mark of the re-authentication is the use case's)
    const all = [...operations, 'getCustomer', 'getSite', 'getParty', ...writers, ...administratorOnly, 'removePasskey'];
    // the operations with a step-up: the only caller they let through is the Administrator with a fresh key (EVM-057; EVM-024: the resend of an invitation)
    const stepUp = [
      'deletePaymentMilestone',
      'resendUserInvitation',
      'changeUserRole',
      'deactivateUser',
      'reactivateUser',
      'endUserSessions',
      'resetUserSecondStep',
      'endAccountSession', // EVM-028: the session of somebody else
      'rescanMediaAsset', // EVM-049: the new scan of a file in quarantine
      'redactTimelineEntry', // EVM-040: the redaction of the text of an entry
      'anonymizeCustomer', // EVM-041: the anonymization of a customer
    ];
    expect(new Set(idor.map((cell) => cell.operationId))).toEqual(new Set([...all, ...stepUp]));
    for (const operationId of stepUp) {
      expect(idor.filter((cell) => cell.operationId === operationId).map((cell) => cell.caller)).toEqual([
        { kind: 'session', role: 'administrator', channel: 'web', state: 'active', passkey: 'fresh' },
      ]);
    }
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
    expect(new Set(cells.filter((cell) => cell.idor).map((cell) => cell.operationId))).toEqual(new Set(['getThing', 'removeThing']));
    const idor = cells.filter((cell) => cell.idor && cell.operationId === 'getThing');
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

describe('the IDOR case of an operation with a step-up (EVM-057 AC8; uwaga security #1 z EVM-054; SR-AUTHZ-02, SR-AUTHZ-05, CWE-639)', () => {
  const fresh: Caller = { kind: 'session', role: 'administrator', channel: 'web', state: 'active', passkey: 'fresh' };

  it('EVM-057 AC8 an operation with a step-up that addresses an object gets one IDOR cell: the Administrator with a fresh key, expecting 404', () => {
    const idor = buildMatrix(synthetic, syntheticLists).filter((cell) => cell.idor && cell.operationId === 'removeThing');
    expect(idor.map((cell) => [cell.caller, cell.expectation])).toEqual([[fresh, { outcome: 'not_found' }]]);
  });

  it('EVM-057 AC8 an operation with a step-up and no object (no path parameter, no anchor) has no IDOR cell — by the rule, not by a list', () => {
    const cells = buildMatrix(synthetic, syntheticLists);
    expect(cells.filter((cell) => cell.idor && cell.operationId === 'stepThing')).toEqual([]);
    expect(buildMatrix(AUTHZ_MANIFEST, lists).filter((cell) => cell.idor && cell.operationId === 'listAuditEvents')).toEqual([]);
  });

  it('EVM-057 AC4 AC8 deletePaymentMilestone: the Administrator with a fresh key is let in; without one a step-up; Editor and Read-only forbidden; anonymous 401', () => {
    const cells = buildMatrix(AUTHZ_MANIFEST, lists).filter((cell) => cell.operationId === 'deletePaymentMilestone' && !cell.idor);
    expect(cells).toHaveLength(19);
    const at = (caller: Caller) => cells.find((cell) => JSON.stringify(cell.caller) === JSON.stringify(caller))?.expectation;
    const forbidden = { outcome: 'denied', status: 403, code: 'forbidden' };
    expect(cells.filter((cell) => cell.expectation.outcome === 'allowed').map((cell) => cell.caller)).toEqual([fresh]);
    expect(at(session('editor', 'web'))).toEqual(forbidden);
    expect(at(session('read_only', 'web'))).toEqual(forbidden);
    expect(at(session('administrator', 'web'))).toEqual({ outcome: 'denied', status: 403, code: 'step_up_required' });
    expect(at({ ...fresh, passkey: 'stale' })).toEqual({ outcome: 'denied', status: 403, code: 'step_up_required' });
    expect(at({ ...fresh, channel: 'mobile' })).toEqual(forbidden);
    expect(at({ kind: 'anonymous' })).toEqual({ outcome: 'denied', status: 401, code: 'unauthenticated' });
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

  it('EVM-029 AC7 EVM-023 AC7 the two operations of the step-up itself need no fresh key: every role on the web channel may call them from any active session', () => {
    for (const operationId of ['getStepUpPasskeyOptions', 'stepUp']) {
      for (const role of ['administrator', 'editor', 'read_only'] as const)
        expect(expectationFor(operationId, AUTHZ_MANIFEST, lists, session(role, 'web')), `${operationId} ${role}`).toEqual({
          outcome: 'allowed',
        });
      expect(expectationFor(operationId, AUTHZ_MANIFEST, lists, session('administrator', 'web', 'mfa_enrollment')), operationId).toEqual({
        outcome: 'denied',
        status: 403,
        code: 'mfa_enrollment_required',
      });
    }
  });
});

describe('the operation of the signed address of a file has variants (EVM-045 AC7; SR-AUTHZ-05, SR-AUTHZ-06)', () => {
  it('EVM-045 AC7 the variants of the contract are those of the code and the policy of the variant forces the case "Read-only + original" for every one of them', () => {
    expect([...zCreateMediaAssetDownloadUrlBody.shape.variant.options].sort()).toEqual([...DOWNLOAD_VARIANTS].sort());
    const table = Object.fromEntries(
      (['administrator', 'editor', 'read_only'] as const).map((role) => [
        role,
        Object.fromEntries(DOWNLOAD_VARIANTS.map((variant) => [variant, mayRequest(role, variant)])),
      ]),
    );
    expect(table).toEqual({
      administrator: { thumbnail: true, preview: true, original: true },
      editor: { thumbnail: true, preview: true, original: true },
      read_only: { thumbnail: true, preview: true, original: false },
    });
  });

  it('EVM-045 AC7 the guard admits Read-only to the operation (the variant is restricted in the service) and the web channel only', () => {
    const entry = AUTHZ_MANIFEST['createMediaAssetDownloadUrl'];
    expect(entry?.authz.roles).toEqual(['administrator', 'editor', 'read_only']);
    expect(entry?.authz.channels).toEqual(['web']);
  });
});
