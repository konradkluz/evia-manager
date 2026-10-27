import { AUTHZ_MANIFEST, MFA_ENROLLMENT_OPERATIONS, PUBLIC_OPERATIONS, type AuthzManifest } from '@evia/contracts/authz';
import { afterEach, describe, expect, it } from 'vitest';
import { CONTRACT_POLICIES, POLICY_SOURCE, RoutePolicyCheck, type PolicySource } from '../../src/modules/authorization/index.ts';
import { toRouteTemplate } from '../../src/modules/authorization/route-policies.ts';
import { buildMatrix, runMatrix, type MatrixLists } from '../authorization/role-matrix.ts';
import { matrixObjects } from '../support/matrix-objects.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { LeakyThingModule, THING_OBJECTS, THING_OPERATION, ThingModule } from '../support/test-routes.ts';

let current: IdentityApp | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

const lists: MatrixLists = { publicOperations: PUBLIC_OPERATIONS, mfaEnrollmentOperations: MFA_ENROLLMENT_OPERATIONS };

/** The contract plus the synthetic object operation: what the matrix is generated from in the IDOR tests. */
const withThing: AuthzManifest = { ...AUTHZ_MANIFEST, getTestThing: THING_OPERATION };
const operation = (operationId: string): AuthzManifest[string] => {
  const found = AUTHZ_MANIFEST[operationId];
  if (found === undefined) throw new Error(`${operationId} is not in the contract`);
  return found;
};
const policiesOf = (manifest: AuthzManifest): PolicySource => ({ ...CONTRACT_POLICIES, manifest });

describe('role and channel matrix against the real application (EVM-016 AC8; SR-AUTHZ-01, SR-AUTHZ-05, SR-AUTHZ-12)', () => {
  it('EVM-016 AC8 every cell of the matrix generated from the contract is answered as expected: roles x channels x enrolment state, anonymous, revoked and expired', async () => {
    current = await createIdentityApp();
    const cells = buildMatrix(AUTHZ_MANIFEST, lists);
    // 19 callers per operation, plus the IDOR cell of every entitled caller (the roles of the operation, web) of an operation with a path
    // parameter — for an operation with a step-up its only entitled caller, the Administrator with a fresh key (EVM-057)
    const idorCells = Object.values(AUTHZ_MANIFEST)
      .filter((operation) => /{[^}]+}/.test(operation.path))
      .reduce((total, operation) => total + (operation.authz.stepUp === true ? 1 : (operation.authz.roles?.length ?? 0)), 0);
    expect(cells.length).toBe(Object.keys(AUTHZ_MANIFEST).length * 19 + idorCells);
    expect(await runMatrix(current, cells, await matrixObjects(current))).toEqual([]);
  });

  it('EVM-016 AC8 completeness: the operations of the matrix, of the contract and of the router are the same set (100%)', async () => {
    current = await createIdentityApp();
    const fromMatrix = [...new Set(buildMatrix(AUTHZ_MANIFEST, lists).map((cell) => cell.operationId))].sort();
    const fromRouter = current.app
      .get(RoutePolicyCheck)
      .routes()
      .map((route) => route.operationId ?? '')
      .sort();
    expect(fromMatrix).toEqual(Object.keys(AUTHZ_MANIFEST).sort());
    expect(fromRouter).toEqual(fromMatrix);
    for (const route of current.app.get(RoutePolicyCheck).routes()) {
      const operation = AUTHZ_MANIFEST[route.operationId ?? ''];
      expect(`${route.method} ${route.path}`).toBe(`${operation?.method} ${toRouteTemplate(operation?.path ?? '')}`);
    }
  });

  it('EVM-016 AC8 the operations the matrix treats as public are exactly the allow-list, and an unauthenticated caller gets 401 on every other one', async () => {
    current = await createIdentityApp();
    const anonymous = buildMatrix(AUTHZ_MANIFEST, lists).filter((cell) => cell.caller.kind === 'anonymous');
    const open = anonymous.filter((cell) => cell.expectation.outcome === 'allowed').map((cell) => cell.operationId);
    expect(open.sort()).toEqual([...PUBLIC_OPERATIONS].sort());
    expect(await runMatrix(current, anonymous, await matrixObjects(current))).toEqual([]);
  });

  it('EVM-018 AC6 the four reads of a work order are in the matrix: A, E and R on the web channel are let in, mobile and anonymous callers are not, and the soft-deleted order of somebody else is 404', async () => {
    current = await createIdentityApp();
    const reads = ['getWorkOrder', 'listWorkOrderScopeItems', 'getWorkOrderCustomer', 'getWorkOrderSite'];
    const cells = buildMatrix(AUTHZ_MANIFEST, lists).filter((cell) => reads.includes(cell.operationId));
    expect(new Set(cells.map((cell) => cell.operationId))).toEqual(new Set(reads));
    expect(cells.filter((cell) => cell.idor)).toHaveLength(reads.length * 3);
    const allowed = cells.filter((cell) => !cell.idor && cell.expectation.outcome === 'allowed');
    expect(allowed.every((cell) => cell.caller.kind === 'session' && cell.caller.channel === 'web' && cell.caller.state === 'active')).toBe(
      true,
    );
    expect(await runMatrix(current, cells, await matrixObjects(current))).toEqual([]);
  });
});

describe('the status command in the matrix (EVM-030 AC7; SR-AUTHZ-01, SR-AUTHZ-05, SR-AUTHZ-12)', () => {
  it('EVM-030 AC7 transitionWorkOrder: Administrator and Editor on the web channel are let in, Tylko odczyt, the mobile channel, mfa_enrollment and anonymous callers are not, and the soft-deleted order of somebody else is 404 for both entitled roles', async () => {
    current = await createIdentityApp();
    const cells = buildMatrix(AUTHZ_MANIFEST, lists).filter((cell) => cell.operationId === 'transitionWorkOrder');
    const allowed = cells.filter((cell) => !cell.idor && cell.expectation.outcome === 'allowed');
    expect(allowed.every((cell) => cell.caller.kind === 'session' && cell.caller.channel === 'web' && cell.caller.state === 'active')).toBe(
      true,
    );
    expect(new Set(allowed.map((cell) => (cell.caller.kind === 'session' ? cell.caller.role : '')))).toEqual(
      new Set(['administrator', 'editor']),
    );
    expect(cells.filter((cell) => cell.idor)).toHaveLength(2);
    expect(await runMatrix(current, cells, await matrixObjects(current))).toEqual([]);
  });
});

describe('the processes and the change of a stage in the matrix (EVM-031 AC6, AC7; SR-AUTHZ-01, SR-AUTHZ-02, SR-AUTHZ-05, SR-AUTHZ-12)', () => {
  it('EVM-031 AC7 listWorkOrderProcedures: Administrator, Editor and Tylko odczyt on the web channel are let in; the mobile channel, mfa_enrollment and anonymous callers are not; the deleted order of somebody else is 404 for all three', async () => {
    current = await createIdentityApp();
    const cells = buildMatrix(AUTHZ_MANIFEST, lists).filter((cell) => cell.operationId === 'listWorkOrderProcedures');
    const allowed = cells.filter((cell) => !cell.idor && cell.expectation.outcome === 'allowed');
    expect(allowed.every((cell) => cell.caller.kind === 'session' && cell.caller.channel === 'web' && cell.caller.state === 'active')).toBe(
      true,
    );
    expect(new Set(allowed.map((cell) => (cell.caller.kind === 'session' ? cell.caller.role : '')))).toEqual(
      new Set(['administrator', 'editor', 'read_only']),
    );
    expect(cells.filter((cell) => cell.idor)).toHaveLength(3);
    expect(await runMatrix(current, cells, await matrixObjects(current))).toEqual([]);
  });

  it('EVM-031 AC6 AC7 updateProcedureStage: Administrator and Editor on the web channel are let in; Tylko odczyt gets 403 forbidden, the mobile channel, mfa_enrollment and anonymous callers are denied; the stage of ANOTHER order named in the path is 404 for both entitled roles', async () => {
    current = await createIdentityApp();
    const cells = buildMatrix(AUTHZ_MANIFEST, lists).filter((cell) => cell.operationId === 'updateProcedureStage');
    const allowed = cells.filter((cell) => !cell.idor && cell.expectation.outcome === 'allowed');
    expect(allowed.every((cell) => cell.caller.kind === 'session' && cell.caller.channel === 'web' && cell.caller.state === 'active')).toBe(
      true,
    );
    expect(new Set(allowed.map((cell) => (cell.caller.kind === 'session' ? cell.caller.role : '')))).toEqual(
      new Set(['administrator', 'editor']),
    );
    const readOnlyWeb = cells.find(
      (cell) =>
        cell.caller.kind === 'session' &&
        cell.caller.role === 'read_only' &&
        cell.caller.channel === 'web' &&
        cell.caller.state === 'active',
    );
    expect(readOnlyWeb?.expectation).toEqual({ outcome: 'denied', status: 403, code: 'forbidden' });
    const anonymous = cells.find((cell) => cell.caller.kind === 'anonymous');
    expect(anonymous?.expectation).toEqual({ outcome: 'denied', status: 401, code: 'unauthenticated' });
    expect(cells.filter((cell) => cell.idor)).toHaveLength(2);
    expect(await runMatrix(current, cells, await matrixObjects(current))).toEqual([]);
  });
});

describe('the status command of a stage in the matrix (EVM-032 AC6, AC7; SR-AUTHZ-01, SR-AUTHZ-02, SR-AUTHZ-05, SR-AUTHZ-12)', () => {
  it('EVM-032 AC7 transitionProcedureStage: Administrator and Editor on the web channel are let in; Tylko odczyt gets 403 forbidden, the mobile channel, mfa_enrollment and anonymous callers are denied; the stage of ANOTHER order named in the path is 404 for both entitled roles', async () => {
    current = await createIdentityApp();
    const cells = buildMatrix(AUTHZ_MANIFEST, lists).filter((cell) => cell.operationId === 'transitionProcedureStage');
    const allowed = cells.filter((cell) => !cell.idor && cell.expectation.outcome === 'allowed');
    expect(allowed.every((cell) => cell.caller.kind === 'session' && cell.caller.channel === 'web' && cell.caller.state === 'active')).toBe(
      true,
    );
    expect(new Set(allowed.map((cell) => (cell.caller.kind === 'session' ? cell.caller.role : '')))).toEqual(
      new Set(['administrator', 'editor']),
    );
    const readOnlyWeb = cells.find(
      (cell) =>
        cell.caller.kind === 'session' &&
        cell.caller.role === 'read_only' &&
        cell.caller.channel === 'web' &&
        cell.caller.state === 'active',
    );
    expect(readOnlyWeb?.expectation).toEqual({ outcome: 'denied', status: 403, code: 'forbidden' });
    const mobile = cells.find((cell) => cell.caller.kind === 'session' && cell.caller.channel === 'mobile');
    expect(mobile?.expectation).toMatchObject({ outcome: 'denied', status: 403 });
    const anonymous = cells.find((cell) => cell.caller.kind === 'anonymous');
    expect(anonymous?.expectation).toEqual({ outcome: 'denied', status: 401, code: 'unauthenticated' });
    expect(cells.filter((cell) => cell.idor)).toHaveLength(2);
    expect(await runMatrix(current, cells, await matrixObjects(current))).toEqual([]);
  });
});

describe('the data and the scope of an order in the matrix (EVM-035 AC8; SR-AUTHZ-01, SR-AUTHZ-02, SR-AUTHZ-05, SR-AUTHZ-12)', () => {
  const WRITERS = ['updateWorkOrder', 'createWorkOrderScopeItem', 'updateWorkOrderScopeItem', 'deleteWorkOrderScopeItem'];
  const OPERATIONS = [...WRITERS, 'getWorkOrderScopeItem'];

  it('EVM-035 AC8 completeness: the five operations are in the contract, in the router and in the matrix (100%), each with an IDOR case', async () => {
    current = await createIdentityApp();
    const fromRouter = current.app
      .get(RoutePolicyCheck)
      .routes()
      .map((route) => route.operationId ?? '');
    const cells = buildMatrix(AUTHZ_MANIFEST, lists);
    for (const operationId of OPERATIONS) {
      expect(AUTHZ_MANIFEST[operationId], operationId).toBeDefined();
      expect(fromRouter, operationId).toContain(operationId);
      expect(
        cells.some((cell) => cell.operationId === operationId && cell.idor),
        operationId,
      ).toBe(true);
    }
    const objects = await matrixObjects(current);
    for (const operationId of OPERATIONS) expect(Object.keys(objects), operationId).toContain(operationId);
  });

  it('EVM-035 AC8 every cell of the five operations is answered as expected: Administrator and Editor on the web channel are let in; Tylko odczyt is 403 forbidden for a change (and let in to read one item), the mobile channel and mfa_enrollment are denied, anonymous is 401; the item of ANOTHER order and the deleted order are 404 for both entitled roles', async () => {
    current = await createIdentityApp();
    const cells = buildMatrix(AUTHZ_MANIFEST, lists).filter((cell) => OPERATIONS.includes(cell.operationId));
    for (const operationId of WRITERS) {
      const own = cells.filter((cell) => cell.operationId === operationId && !cell.idor);
      const allowed = own.filter((cell) => cell.expectation.outcome === 'allowed');
      expect(
        allowed.every((cell) => cell.caller.kind === 'session' && cell.caller.channel === 'web' && cell.caller.state === 'active'),
        operationId,
      ).toBe(true);
      expect(new Set(allowed.map((cell) => (cell.caller.kind === 'session' ? cell.caller.role : ''))), operationId).toEqual(
        new Set(['administrator', 'editor']),
      );
      const readOnlyWeb = own.find(
        (cell) =>
          cell.caller.kind === 'session' &&
          cell.caller.role === 'read_only' &&
          cell.caller.channel === 'web' &&
          cell.caller.state === 'active',
      );
      expect(readOnlyWeb?.expectation, operationId).toEqual({ outcome: 'denied', status: 403, code: 'forbidden' });
      const mobile = own.find(
        (cell) => cell.caller.kind === 'session' && cell.caller.channel === 'mobile' && cell.caller.role === 'editor',
      );
      expect(mobile?.expectation, operationId).toMatchObject({ outcome: 'denied', status: 403 });
      const anonymous = own.find((cell) => cell.caller.kind === 'anonymous');
      expect(anonymous?.expectation, operationId).toEqual({ outcome: 'denied', status: 401, code: 'unauthenticated' });
      expect(
        cells.filter((cell) => cell.operationId === operationId && cell.idor),
        operationId,
      ).toHaveLength(2);
    }
    const read = cells.filter((cell) => cell.operationId === 'getWorkOrderScopeItem');
    expect(
      new Set(
        read
          .filter((cell) => !cell.idor && cell.expectation.outcome === 'allowed')
          .map((cell) => (cell.caller.kind === 'session' ? cell.caller.role : '')),
      ),
    ).toEqual(new Set(['administrator', 'editor', 'read_only']));
    expect(read.filter((cell) => cell.idor)).toHaveLength(3);
    expect(await runMatrix(current, cells, await matrixObjects(current))).toEqual([]);
  });
});

describe('IDOR in the matrix (EVM-016 AC8; SR-AUTHZ-05, CWE-639)', () => {
  it('EVM-016 AC8 an entitled caller gets the own object and 404 (not 403) for the object of somebody else', async () => {
    current = await createIdentityApp({
      imports: [ThingModule],
      configure: (builder) => builder.overrideProvider(POLICY_SOURCE).useValue(policiesOf(withThing)),
    });
    const cells = buildMatrix(withThing, lists);
    expect(cells.filter((cell) => cell.idor)).toHaveLength(99); // 3 of the deletion, the restoration and the redaction of an entry of the journal (EVM-040: the Administrator alone; the redaction with a fresh key), 3 of the removal of a key and 1 of the end of a session of the own account (EVM-028 AC8: the Administrator with a fresh key for the session), 5 of the administration of accounts (EVM-027: the Administrator with a fresh key), 1 of the resend of an invitation (EVM-024: the Administrator with a fresh key), 2 of the deletion and the restoration of an order (EVM-060: the Administrator alone), 1 of the deletion of a payment milestone (EVM-057: the Administrator with a fresh key), 2 of the transition of a payment milestone (EVM-054), 11 of the processes and stages added, deleted and restored by hand and of the list of the deleted ones (EVM-042), 7 of the payment milestones: the list, the addition and the change of an amount (EVM-053), 11 of the data of an order and of the five operations on its scope (EVM-035), 2 of the synthetic thing, 3 of the catalogue template, 15 of the five reads of a work order (EVM-018, EVM-036), 2 of the status command (EVM-030), 5 of the detail and the edit of a customer (EVM-039), 10 of the detail and the edit of a site and of a party (EVM-036), 5 of the processes of an order and the change of a stage (EVM-031), 2 of its transition (EVM-032), 8 of the journal: the list, one entry and the creation (EVM-037)
    expect(await runMatrix(current, cells, { ...(await matrixObjects(current)), getTestThing: THING_OBJECTS })).toEqual([]);
  });

  it('EVM-016 AC8 an operation with a path parameter and no IDOR case is an error of the matrix', async () => {
    current = await createIdentityApp({
      imports: [ThingModule],
      configure: (builder) => builder.overrideProvider(POLICY_SOURCE).useValue(policiesOf(withThing)),
    });
    const mismatches = await runMatrix(
      current,
      buildMatrix(withThing, lists).filter((cell) => cell.operationId === 'getTestThing'),
    );
    expect(mismatches.length).toBeGreaterThan(0);
    expect(mismatches.every((mismatch) => mismatch.actual === 'none defined')).toBe(true);
  });
});

describe('the matrix catches holes (EVM-016 AC8 — a test of the test)', () => {
  it('EVM-016 AC8 a guard that lets one role too many in is reported, with the operation and the caller', async () => {
    const holey: AuthzManifest = {
      ...withThing,
      getTestThing: { ...THING_OPERATION, authz: { ...THING_OPERATION.authz, roles: ['administrator', 'editor', 'read_only'] } },
    };
    current = await createIdentityApp({
      imports: [ThingModule],
      configure: (builder) => builder.overrideProvider(POLICY_SOURCE).useValue(policiesOf(holey)),
    });
    const mismatches = await runMatrix(current, buildMatrix(withThing, lists), {
      ...(await matrixObjects(current)),
      getTestThing: THING_OBJECTS,
    });
    expect(mismatches).toEqual([
      { operationId: 'getTestThing', caller: 'read_only/web/active', expected: '403 forbidden', actual: '200 ' },
    ]);
  });

  it('EVM-016 AC8 a guard that opens the mobile channel where the contract does not is reported', async () => {
    const holey: AuthzManifest = {
      ...withThing,
      logout: { ...operation('logout'), authz: { ...operation('logout').authz, channels: ['web', 'mobile'] } },
    };
    current = await createIdentityApp({
      imports: [ThingModule],
      configure: (builder) => builder.overrideProvider(POLICY_SOURCE).useValue(policiesOf(holey)),
    });
    const mismatches = await runMatrix(current, buildMatrix(withThing, lists), {
      ...(await matrixObjects(current)),
      getTestThing: THING_OBJECTS,
    });
    expect(mismatches.map((mismatch) => `${mismatch.operationId} ${mismatch.caller}`)).toEqual(
      expect.arrayContaining(['logout administrator/mobile/active', 'logout editor/mobile/active']),
    );
  });

  it('EVM-016 AC8 a handler that forgot the object policy is reported: the foreign object is served (IDOR)', async () => {
    current = await createIdentityApp({
      imports: [LeakyThingModule],
      configure: (builder) => builder.overrideProvider(POLICY_SOURCE).useValue(policiesOf(withThing)),
    });
    const mismatches = await runMatrix(current, buildMatrix(withThing, lists), {
      ...(await matrixObjects(current)),
      getTestThing: THING_OBJECTS,
    });
    expect(mismatches).toHaveLength(2);
    expect(
      mismatches.every(
        (mismatch) =>
          mismatch.caller.endsWith('(foreign object)') && mismatch.expected === '404 not_found' && mismatch.actual.startsWith('200'),
      ),
    ).toBe(true);
  });
});
