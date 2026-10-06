import { AUTHZ_MANIFEST, PUBLIC_OPERATIONS } from '@evia/contracts/authz';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTHENTICATION_OPERATIONS,
  CONTRACT_POLICIES,
  PASSIVE_OPERATIONS,
  POLICY_SOURCE,
  type PolicySource,
} from '../../src/modules/authorization/index.ts';
import { SESSION_RESOLVER, type Authentication } from '../../src/platform/http/principal.ts';
import { createTestApp, type TestApp } from '../support/app.ts';
import { principal } from '../support/principals.ts';
import { ProtectedRouteModule, TEST_POLICIES } from '../support/test-routes.ts';

let current: TestApp | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

const withSession = (authentication: Authentication, policies: PolicySource = TEST_POLICIES) =>
  createTestApp({
    imports: [ProtectedRouteModule],
    configure: (builder) =>
      builder
        .overrideProvider(POLICY_SOURCE)
        .useValue(policies)
        .overrideProvider(SESSION_RESOLVER)
        .useValue({ resolve: () => Promise.resolve(authentication) }),
  });

describe('activity of the session is recorded by the guard once a request is allowed (EVM-067 AC5; SR-SESS-03, SR-WEB-05)', () => {
  it('EVM-067 AC5 an allowed request of a session records the activity exactly once', async () => {
    const touch = vi.fn(() => Promise.resolve());
    current = await withSession({ principal: principal(), touch });
    await request(current.app.getHttpServer()).get('/api/v1/work-orders').expect(200);
    expect(touch).toHaveBeenCalledTimes(1);
  });

  it('EVM-067 AC5 a passive operation does not record activity: reading the session must not keep it alive', async () => {
    const touch = vi.fn(() => Promise.resolve());
    current = await withSession({ principal: principal(), touch }, { ...TEST_POLICIES, passiveOperations: ['listWorkOrders'] });
    await request(current.app.getHttpServer()).get('/api/v1/work-orders').expect(200);
    expect(touch).not.toHaveBeenCalled();
  });

  it('EVM-067 AC5 a denied request records nothing (wrong role, session in enrolment, failed query check)', async () => {
    for (const denied of [{ role: 'editor' }, { state: 'mfa_enrollment' }] as const) {
      const touch = vi.fn(() => Promise.resolve());
      current = await withSession({ principal: principal(denied), touch });
      await request(current.app.getHttpServer()).get('/api/v1/work-orders').expect(403);
      expect(touch).not.toHaveBeenCalled();
      await current.close();
    }
    const touch = vi.fn(() => Promise.resolve());
    current = await withSession({ principal: principal(), touch });
    await request(current.app.getHttpServer()).get('/api/v1/work-orders?limit=5').expect(400);
    expect(touch).not.toHaveBeenCalled();
  });

  it('EVM-067 AC5 a public operation called with an old cookie does not count as activity of that session', async () => {
    const touch = vi.fn(() => Promise.resolve());
    current = await withSession({ principal: principal(), touch });
    await request(current.app.getHttpServer()).get('/api/health');
    expect(touch).not.toHaveBeenCalled();
  });

  it('EVM-067 AC5 a session resolver without an activity hook (a synthetic principal) is served without one', async () => {
    current = await withSession({ principal: principal() });
    await request(current.app.getHttpServer()).get('/api/v1/work-orders').expect(200);
  });
});

describe('policy lists of the sign-in (EVM-067 AC3, AC6; SR-API-02)', () => {
  it('EVM-067 AC3 both steps of the sign-in share the stricter per-address limit, and every listed operation exists in the contract', () => {
    for (const id of ['login', 'getLoginPasskeyOptions', 'verifyLoginPasskey']) {
      expect(AUTHENTICATION_OPERATIONS, id).toContain(id);
      expect(PUBLIC_OPERATIONS, id).toContain(id);
      expect(AUTHZ_MANIFEST[id]?.authz, id).toEqual({ public: true });
    }
    for (const id of [...AUTHENTICATION_OPERATIONS, ...PASSIVE_OPERATIONS]) expect(Object.hasOwn(AUTHZ_MANIFEST, id), id).toBe(true);
    expect(CONTRACT_POLICIES.authenticationOperations).toBe(AUTHENTICATION_OPERATIONS);
  });

  it('EVM-067 AC6 only reading the session and the extension itself are passive; the extension is allowed in the enrolment state and takes no body', () => {
    expect([...PASSIVE_OPERATIONS].sort()).toEqual(['extendSession', 'getCurrentSession']);
    expect(CONTRACT_POLICIES.passiveOperations).toBe(PASSIVE_OPERATIONS);
    expect(AUTHZ_MANIFEST['extendSession']).toMatchObject({
      method: 'post',
      path: '/api/v1/auth/session/extend',
      authz: { roles: ['administrator', 'editor', 'read_only'], channels: ['web'], allowDuringMfaEnrollment: true },
    });
  });
});
