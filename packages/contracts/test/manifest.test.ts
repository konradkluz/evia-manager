import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUTHZ_MANIFEST, MFA_ENROLLMENT_OPERATIONS, MOBILE_OPERATIONS, PUBLIC_OPERATIONS } from '../src/authz.ts';
import { buildAuthzManifest, renderAuthzModule } from '../src/manifest.ts';

const bundled: unknown = JSON.parse(readFileSync('dist/openapi.json', 'utf8'));

const spec = (authz: unknown, extra: Record<string, unknown> = {}) => ({
  paths: { '/api/v1/x': { get: { operationId: 'getX', 'x-evia-authz': authz, ...extra } } },
});

describe('authorization manifest (EVM-008 AC2, AC4; SR-AUTHZ-01)', () => {
  it('EVM-008 AC2 the manifest lists every operation of the bundled contract with method, path and x-evia-authz', () => {
    const manifest = buildAuthzManifest(bundled);
    expect(AUTHZ_MANIFEST).toEqual(manifest);
    expect(manifest['getHealth']).toEqual({ method: 'get', path: '/api/health', query: [], authz: { public: true } });
    expect(Object.keys(manifest).sort()).toEqual([
      'checkActivationLink',
      'createCustomer',
      'createParty',
      'createSite',
      'createWorkOrder',
      'extendSession',
      'getCurrentSession',
      'getHealth',
      'getLoginPasskeyOptions',
      'getPasskeyRegistrationOptions',
      'getStepUpPasskeyOptions',
      'getWorkOrder',
      'getWorkOrderCustomer',
      'getWorkOrderSite',
      'getWorkOrderTemplate',
      'listAssignableUsers',
      'listAuditEvents',
      'listDocumentKinds',
      'listProcedureTemplates',
      'listServiceItems',
      'listWorkOrderScopeItems',
      'listWorkOrderTemplates',
      'listWorkOrders',
      'login',
      'logout',
      'registerPasskey',
      'searchCustomers',
      'searchParties',
      'searchSites',
      'setActivationPassword',
      'stepUp',
      'transitionWorkOrder',
      'verifyLoginPasskey',
    ]);
  });

  it('EVM-016 AC8 public operations of the contract are exactly the allow-list and none declares channels', () => {
    const publicOperations = Object.entries(AUTHZ_MANIFEST)
      .filter(([, operation]) => operation.authz.public === true)
      .map(([id]) => id);
    expect(publicOperations.sort()).toEqual([...PUBLIC_OPERATIONS].sort());
    expect(MOBILE_OPERATIONS).toEqual([]);
  });

  it('EVM-016 AC4 only the listed operations may be used while the passkey is being enrolled', () => {
    const allowed = Object.entries(AUTHZ_MANIFEST)
      .filter(([, operation]) => operation.authz.allowDuringMfaEnrollment === true)
      .map(([id]) => id);
    expect(allowed.sort()).toEqual([...MFA_ENROLLMENT_OPERATIONS].sort());
  });

  it('EVM-029 AC7 every operation with stepUp: true lists exactly the web channel; the audit log is the one in M1', () => {
    const stepUp = Object.entries(AUTHZ_MANIFEST).filter(([, operation]) => operation.authz.stepUp === true);
    expect(stepUp.map(([id]) => id)).toEqual(['listAuditEvents']);
    for (const [id, operation] of stepUp) {
      expect(operation.authz.channels, id).toEqual(['web']);
      expect(operation.authz.roles, id).toEqual(['administrator']);
    }
  });

  it('EVM-016 AC8 no operation of the contract lists the mobile channel in M1', () => {
    for (const [id, operation] of Object.entries(AUTHZ_MANIFEST)) {
      expect(operation.authz.channels ?? [], id).not.toContain('mobile');
    }
  });

  it('EVM-008 AC4 an operation without operationId or x-evia-authz fails generation (no silent gaps)', () => {
    const operation = (value: Record<string, unknown>) => ({ paths: { '/api/v1/x': { get: value } } });
    expect(() => buildAuthzManifest(operation({ 'x-evia-authz': { public: true } }))).toThrow(/operationId/);
    expect(() => buildAuthzManifest(operation({ operationId: 'getX' }))).toThrow(/x-evia-authz/);
    expect(() =>
      buildAuthzManifest({
        paths: {
          '/a': { get: { operationId: 'same', 'x-evia-authz': { public: true } } },
          '/b': { post: { operationId: 'same', 'x-evia-authz': { public: true } } },
        },
      }),
    ).toThrow(/same/);
  });

  it('EVM-016 AC8 a policy that does not match the strict schema fails generation (a typo is never fail-open)', () => {
    const roles = ['administrator'];
    const channels = ['web'];
    const bad: Array<[string, unknown]> = [
      ['unknown key', { roles, channels, rols: roles }],
      ['empty roles', { roles: [], channels }],
      ['empty channels', { roles, channels: [] }],
      ['missing roles', { channels }],
      ['missing channels', { roles }],
      ['unknown role', { roles: ['admin'], channels }],
      ['unknown channel', { roles, channels: ['desktop'] }],
      ['public as a string', { public: 'true' }],
      ['public with roles', { public: true, roles }],
      ['empty policy', {}],
    ];
    for (const [label, authz] of bad) expect(() => buildAuthzManifest(spec(authz)), label).toThrow(/getX: nieprawidłowe x-evia-authz/);
    expect(buildAuthzManifest(spec({ roles, channels, audit: true, allowDuringMfaEnrollment: true })).getX?.authz.roles).toEqual(roles);
  });

  it('EVM-008 AC2 non-operation keys of a path item are ignored and a contract without paths has no operations', () => {
    expect(
      buildAuthzManifest({
        paths: { '/a': { summary: 'x', parameters: [], get: { operationId: 'getA', 'x-evia-authz': { public: true } } } },
      }),
    ).toEqual({ getA: { method: 'get', path: '/a', query: [], authz: { public: true } } });
    expect(buildAuthzManifest({ paths: { '/a': { get: null }, '/b': null } })).toEqual({});
    expect(buildAuthzManifest({})).toEqual({});
    expect(buildAuthzManifest(null)).toEqual({});
  });

  it('EVM-016 AC8 the manifest lists the declared query parameters of an operation, inline and by reference', () => {
    const document = {
      components: { parameters: { Cursor: { name: 'cursor', in: 'query' } } },
      paths: {
        '/a': {
          parameters: [{ name: 'limit', in: 'query' }],
          get: {
            operationId: 'getA',
            'x-evia-authz': { public: true },
            parameters: [{ $ref: '#/components/parameters/Cursor' }, { name: 'id', in: 'path' }, { name: 'x-trace', in: 'header' }, null],
          },
        },
      },
    };
    expect(buildAuthzManifest(document).getA?.query).toEqual(['limit', 'cursor']);
    const unresolved = {
      paths: {
        '/a': { get: { operationId: 'getA', 'x-evia-authz': { public: true }, parameters: [{ $ref: '#/components/parameters/Missing' }] } },
      },
    };
    expect(() => buildAuthzManifest(unresolved)).toThrow(/unresolved parameter/);
    const noRegistry = {
      paths: {
        '/a': { get: { operationId: 'getA', 'x-evia-authz': { public: true }, parameters: [{ $ref: '#/components/parameters/Missing' }] } },
      },
    };
    expect(() => buildAuthzManifest(noRegistry)).toThrow(/Missing/);
  });

  it('EVM-008 AC2 the rendered module is a frozen constant generated from the contract', () => {
    const source = renderAuthzModule({ getHealth: { method: 'get', path: '/api/health', query: [], authz: { public: true } } });
    expect(source).toContain('generated from dist/openapi.json');
    expect(source).toContain('export const AUTHZ_MANIFEST');
    expect(source).toContain('"getHealth"');
    expect(source).toContain('Object.freeze');
  });
});
