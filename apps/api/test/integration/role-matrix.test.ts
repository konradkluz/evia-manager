import { AUTHZ_MANIFEST, MFA_ENROLLMENT_OPERATIONS, PUBLIC_OPERATIONS, type AuthzManifest } from '@evia/contracts/authz';
import { afterEach, describe, expect, it } from 'vitest';
import { CONTRACT_POLICIES, POLICY_SOURCE, RoutePolicyCheck, type PolicySource } from '../../src/modules/authorization/index.ts';
import { toRouteTemplate } from '../../src/modules/authorization/route-policies.ts';
import { buildMatrix, runMatrix, type MatrixLists } from '../authorization/role-matrix.ts';
import { catalogObjects } from '../support/catalog-objects.ts';
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
    // 19 callers per operation, plus the IDOR cell of every entitled caller (3 roles, web) of an operation with a path parameter
    const addressing = Object.values(AUTHZ_MANIFEST).filter((operation) => /{[^}]+}/.test(operation.path)).length;
    expect(cells.length).toBe(Object.keys(AUTHZ_MANIFEST).length * 19 + addressing * 3);
    expect(await runMatrix(current, cells, await catalogObjects(current))).toEqual([]);
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
    expect(await runMatrix(current, anonymous, await catalogObjects(current))).toEqual([]);
  });
});

describe('IDOR in the matrix (EVM-016 AC8; SR-AUTHZ-05, CWE-639)', () => {
  it('EVM-016 AC8 an entitled caller gets the own object and 404 (not 403) for the object of somebody else', async () => {
    current = await createIdentityApp({
      imports: [ThingModule],
      configure: (builder) => builder.overrideProvider(POLICY_SOURCE).useValue(policiesOf(withThing)),
    });
    const cells = buildMatrix(withThing, lists);
    expect(cells.filter((cell) => cell.idor)).toHaveLength(5); // 2 of the synthetic thing, 3 of the catalogue template
    expect(await runMatrix(current, cells, { ...(await catalogObjects(current)), getTestThing: THING_OBJECTS })).toEqual([]);
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
      ...(await catalogObjects(current)),
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
      ...(await catalogObjects(current)),
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
      ...(await catalogObjects(current)),
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
