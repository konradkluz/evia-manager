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
      'checkPasswordResetLink',
      'completePasswordReset',
      'confirmTotp',
      'createCustomer',
      'createParty',
      'createPaymentMilestone',
      'createProcedureStage',
      'createSite',
      'createTimelineEntry',
      'createWorkOrder',
      'createWorkOrderProcedure',
      'createWorkOrderScopeItem',
      'deletePaymentMilestone',
      'deleteProcedureStage',
      'deleteWorkOrder',
      'deleteWorkOrderProcedure',
      'deleteWorkOrderScopeItem',
      'extendSession',
      'generateRecoveryCodes',
      'getCurrentSession',
      'getCustomer',
      'getHealth',
      'getLoginPasskeyOptions',
      'getParty',
      'getPasskeyRegistrationOptions',
      'getSite',
      'getStepUpPasskeyOptions',
      'getTimelineEntry',
      'getWorkOrder',
      'getWorkOrderCustomer',
      'getWorkOrderScopeItem',
      'getWorkOrderSite',
      'getWorkOrderTemplate',
      'inviteUser',
      'listAssignableUsers',
      'listAuditEvents',
      'listCustomers',
      'listDeletedWorkOrderProcedures',
      'listDocumentKinds',
      'listPaymentMilestones',
      'listProcedureTemplates',
      'listServiceItems',
      'listTimelineEntries',
      'listUnpaidPaymentMilestones',
      'listUsers',
      'listWorkOrderProcedures',
      'listWorkOrderScopeItems',
      'listWorkOrderSiteOrders',
      'listWorkOrderTemplates',
      'listWorkOrders',
      'login',
      'loginRecoveryCode',
      'loginTotp',
      'logout',
      'registerPasskey',
      'requestPasswordReset',
      'resendUserInvitation',
      'restoreProcedureStage',
      'restoreWorkOrder',
      'restoreWorkOrderProcedure',
      'searchCustomers',
      'searchParties',
      'searchSites',
      'searchWorkOrders',
      'setActivationPassword',
      'startTotpEnrolment',
      'stepUp',
      'transitionPaymentMilestone',
      'transitionProcedureStage',
      'transitionWorkOrder',
      'updateCustomer',
      'updateParty',
      'updatePaymentMilestone',
      'updateProcedureStage',
      'updateSite',
      'updateWorkOrder',
      'updateWorkOrderScopeItem',
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

  it('EVM-029 AC7 EVM-054 AC5 EVM-023 AC4 every operation with stepUp: true lists exactly the web channel and the Administrator — except the recovery codes, which every role has (EVM-023); the audit log, the deletion of a payment milestone (EVM-057) and the invitation of a user and its resend (EVM-024) are the others in M1', () => {
    const stepUp = Object.entries(AUTHZ_MANIFEST).filter(([, operation]) => operation.authz.stepUp === true);
    expect(stepUp.map(([id]) => id).sort()).toEqual([
      'deletePaymentMilestone',
      'generateRecoveryCodes',
      'inviteUser',
      'listAuditEvents',
      'resendUserInvitation',
    ]);
    for (const [id, operation] of stepUp) {
      expect(operation.authz.channels, id).toEqual(['web']);
      expect(operation.authz.roles, id).toEqual(
        id === 'generateRecoveryCodes' ? ['administrator', 'editor', 'read_only'] : ['administrator'],
      );
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

  it('EVM-056 AC7 the list and the search declare the payment rule (W4): restricted values of `view` and `sort` and the hidden field `payment`', () => {
    const rule = {
      'paymentMilestone.read': { params: { view: ['overdue_payments', 'unpaid'], sort: ['urgency'] }, fields: ['payment'] },
    };
    expect(AUTHZ_MANIFEST['listWorkOrders']?.authz.restrictedParams).toEqual(rule);
    expect(AUTHZ_MANIFEST['searchWorkOrders']?.authz.restrictedParams).toEqual(rule);
    const declaring = Object.entries(AUTHZ_MANIFEST).filter(([, operation]) => operation.authz.restrictedParams !== undefined);
    expect(declaring.map(([id]) => id).sort()).toEqual(['listWorkOrders', 'searchWorkOrders']);
  });

  describe('EVM-056 AC7 `restrictedParams` is validated against the operation (a typo never becomes a silent gap)', () => {
    const components = {
      schemas: {
        View: { type: 'string', enum: ['all', 'paid'] },
        Item: { type: 'object', properties: { id: { type: 'string' }, payment: { type: 'object' } } },
        List: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Item' } } } },
        Body: { type: 'object', properties: { query: { type: 'string' }, view: { $ref: '#/components/schemas/View' } } },
      },
      parameters: { Sort: { name: 'sort', in: 'query', schema: { type: 'string', enum: ['a', 'b'] } } },
    };
    const ok = { content: { 'application/json': { schema: { $ref: '#/components/schemas/List' } } } };
    const document = (restrictedParams: unknown, operation: Record<string, unknown> = {}) => ({
      components,
      paths: {
        '/x': {
          get: {
            operationId: 'getX',
            'x-evia-authz': { roles: ['administrator'], channels: ['web'], restrictedParams },
            parameters: [
              { name: 'view', in: 'query', schema: { $ref: '#/components/schemas/View' } },
              { $ref: '#/components/parameters/Sort' },
            ],
            responses: { '200': ok },
            ...operation,
          },
        },
      },
    });
    const rule = (params: unknown, fields: unknown = ['payment']) => ({ 'paymentMilestone.read': { params, fields } });

    it('accepts query parameters (inline and by reference), a body property and a field of the item of the list', () => {
      const manifest = buildAuthzManifest(document(rule({ view: ['paid'], sort: ['b'] })));
      expect(manifest['getX']?.authz.restrictedParams).toEqual(rule({ view: ['paid'], sort: ['b'] }));
      const body = {
        parameters: [],
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Body' } } } },
      };
      expect(buildAuthzManifest(document(rule({ view: ['paid'] }), body))['getX']?.authz.restrictedParams).toBeDefined();
      const single = { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } } } } };
      expect(buildAuthzManifest(document(rule({ sort: ['a'] }), single))['getX']?.authz.restrictedParams).toBeDefined();
    });

    it('refuses an unknown policy, an unknown parameter, a value outside the enum, an unknown field and an empty rule', () => {
      const bad: Array<[string, unknown]> = [
        ['unknown policy', { 'payment.read': { params: { view: ['paid'] }, fields: [] } }],
        ['unknown key', { 'paymentMilestone.read': { params: { view: ['paid'] }, fields: [], extra: true } }],
        ['empty values', rule({ view: [] })],
      ];
      for (const [label, value] of bad)
        expect(() => buildAuthzManifest(document(value)), label).toThrow(/getX: nieprawidłowe x-evia-authz/);
      expect(() => buildAuthzManifest(document(rule({ status: ['paid'] })))).toThrow(/getX: restrictedParams.*status/);
      expect(() => buildAuthzManifest(document(rule({ view: ['open'] })))).toThrow(/getX: restrictedParams.*view.*open/);
      expect(() => buildAuthzManifest(document(rule({ sort: ['c'] })))).toThrow(/getX: restrictedParams.*sort.*c/);
      expect(() => buildAuthzManifest(document(rule({ view: ['paid'] }, ['amount'])))).toThrow(/getX: restrictedParams.*amount/);
      const noEnum = { parameters: [{ name: 'view', in: 'query', schema: { type: 'string' } }] };
      expect(() => buildAuthzManifest(document(rule({ view: ['paid'] }), noEnum))).toThrow(/getX: restrictedParams.*view/);
      const noResponse = { responses: {} };
      expect(() => buildAuthzManifest(document(rule({ view: ['paid'] }), noResponse))).toThrow(/getX: restrictedParams.*payment/);
      const missingRef = { parameters: [{ name: 'view', in: 'query', schema: { $ref: '#/components/schemas/Missing' } }] };
      expect(() => buildAuthzManifest(document(rule({ view: ['paid'] }), missingRef))).toThrow(/Missing/);
    });
  });

  it('EVM-008 AC2 the rendered module is a frozen constant generated from the contract', () => {
    const source = renderAuthzModule({ getHealth: { method: 'get', path: '/api/health', query: [], authz: { public: true } } });
    expect(source).toContain('generated from dist/openapi.json');
    expect(source).toContain('export const AUTHZ_MANIFEST');
    expect(source).toContain('"getHealth"');
    expect(source).toContain('Object.freeze');
  });
});
