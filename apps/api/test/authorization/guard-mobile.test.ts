import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { POLICY_SOURCE, type PolicySource } from '../../src/modules/authorization/index.ts';
import { ANONYMOUS, SESSION_RESOLVER, type Authentication } from '../../src/platform/http/principal.ts';
import { principal } from '../support/principals.ts';
import { createTestApp, type TestApp } from '../support/app.ts';
import { ProtectedRouteController, ProtectedRouteModule, TEST_POLICIES } from '../support/test-routes.ts';

let current: TestApp | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

const cookie = principal({ channel: 'web' });
const bearer = principal({ channel: 'mobile', csrfToken: '' });
const APP = { 'X-Client-Platform': 'android', 'X-Client-Version': '1.2.0' };

/** The two credentials the middleware resolves for a request; the guard picks by the channel of the operation (EVM-094). */
const resolver = (web: Authentication, phone: Authentication) => ({
  resolve: () => Promise.resolve(web),
  resolveBearer: () => Promise.resolve(phone),
});

type Policy = PolicySource['manifest'][string]['authz'];

const policies = (authz: Policy, extra: Partial<PolicySource> = {}): PolicySource => ({
  ...TEST_POLICIES,
  manifest: { ...TEST_POLICIES.manifest, listTestWidgets: { method: 'get', path: '/api/v1/test-widgets', query: [], authz } },
  ...extra,
});

const start = (source: PolicySource, both: ReturnType<typeof resolver>) =>
  createTestApp({
    imports: [ProtectedRouteModule],
    configure: (builder) => builder.overrideProvider(POLICY_SOURCE).useValue(source).overrideProvider(SESSION_RESOLVER).useValue(both),
  });

const reached = (app: TestApp): number => app.app.get(ProtectedRouteController).helper();

describe('the credential of the channel of the operation (EVM-094 AC3; SR-AUTHZ-12)', () => {
  it('EVM-094 AC3 an operation of the mobile channel alone reads the Bearer principal and ignores the cookie principal', async () => {
    current = await start(policies({ roles: ['administrator'], channels: ['mobile'] }), resolver({ principal: cookie }, ANONYMOUS));
    expect((await request(current.app.getHttpServer()).get('/api/v1/test-widgets')).status).toBe(401);
    expect(reached(current)).toBe(0);
    await current.close();
    current = await start(
      policies({ roles: ['administrator'], channels: ['mobile'] }),
      resolver({ principal: cookie }, { principal: bearer }),
    );
    expect((await request(current.app.getHttpServer()).get('/api/v1/test-widgets')).status).toBe(200);
    expect(reached(current)).toBe(1);
  });

  it('EVM-094 AC3 an operation of the panel alone reads the cookie principal and ignores a Bearer one', async () => {
    current = await start(policies({ roles: ['administrator'], channels: ['web'] }), resolver(ANONYMOUS, { principal: bearer }));
    expect((await request(current.app.getHttpServer()).get('/api/v1/test-widgets')).status).toBe(401);
  });

  it('EVM-094 AC3 an operation open to both channels takes the cookie first and the Bearer token when there is no cookie principal', async () => {
    const both = policies({ roles: ['administrator'], channels: ['web', 'mobile'] });
    current = await start(both, resolver({ principal: cookie }, { principal: null, reason: 'revoked' }));
    expect((await request(current.app.getHttpServer()).get('/api/v1/test-widgets')).status).toBe(200);
    await current.close();
    current = await start(both, resolver(ANONYMOUS, { principal: bearer }));
    expect((await request(current.app.getHttpServer()).get('/api/v1/test-widgets')).status).toBe(200);
    await current.close();
    current = await start(both, resolver(ANONYMOUS, { principal: null, reason: 'wipe_required' }));
    const wipe = await request(current.app.getHttpServer()).get('/api/v1/test-widgets');
    expect(wipe.status).toBe(401);
    expect(wipe.body).toMatchObject({ code: 'device_wipe_required' });
  });

  it('EVM-094 AC3 a mutation of the phone passes without Origin and CSRF token; the same mutation with a cookie is refused (csrf_failed)', async () => {
    const edit = (channel: 'web' | 'mobile'): PolicySource => ({
      ...TEST_POLICIES,
      manifest: {
        ...TEST_POLICIES.manifest,
        createTestWidget: {
          method: 'post',
          path: '/api/v1/test-widgets',
          query: [],
          authz: { roles: ['administrator'], channels: [channel] },
        },
      },
    });
    current = await start(edit('mobile'), resolver(ANONYMOUS, { principal: bearer }));
    expect((await request(current.app.getHttpServer()).post('/api/v1/test-widgets')).status).toBe(201);
    await current.close();
    current = await start(edit('web'), resolver({ principal: cookie }, ANONYMOUS));
    const refused = await request(current.app.getHttpServer()).post('/api/v1/test-widgets');
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: 'csrf_failed' });
  });
});

describe('the version of the app in the guard (EVM-094 AC6; SR-API-08)', () => {
  const versioned = (authz: Policy, publicOperations: string[] = []) =>
    policies(authz, { clientVersionOperations: ['listTestWidgets'], publicOperations });

  it('EVM-094 AC6 a public operation of the phone is refused with 426 and the minimum versions BEFORE anything else is asked', async () => {
    current = await start(versioned({ public: true, channels: ['mobile'] }, ['listTestWidgets']), resolver(ANONYMOUS, ANONYMOUS));
    const server = current.app.getHttpServer();
    const old: Array<Record<string, string>> = [
      {},
      { 'X-Client-Platform': 'android', 'X-Client-Version': '1.1.9' },
      { 'X-Client-Platform': 'ios', 'X-Client-Version': '1.0.0' },
    ];
    for (const headers of old) {
      const response = await request(server).get('/api/v1/test-widgets').set(headers);
      expect(response.status, JSON.stringify(headers)).toBe(426);
      expect(response.body).toMatchObject({ code: 'client_version_unsupported', minSupportedVersion: { android: '1.2.0', ios: '1.1.0' } });
    }
    expect(reached(current)).toBe(0);
    expect((await request(server).get('/api/v1/test-widgets').set(APP)).status).toBe(200);
  });

  it('EVM-094 AC6 an operation with a token learns the version only after authentication and authorization: an anonymous caller is 401, a forbidden role 403', async () => {
    const source = versioned({ roles: ['administrator'], channels: ['mobile'] });
    current = await start(source, resolver(ANONYMOUS, ANONYMOUS));
    expect((await request(current.app.getHttpServer()).get('/api/v1/test-widgets')).status).toBe(401);
    await current.close();
    current = await start(source, resolver(ANONYMOUS, { principal: principal({ channel: 'mobile', role: 'editor' }) }));
    expect((await request(current.app.getHttpServer()).get('/api/v1/test-widgets')).status).toBe(403);
    await current.close();
    current = await start(source, resolver(ANONYMOUS, { principal: bearer }));
    expect((await request(current.app.getHttpServer()).get('/api/v1/test-widgets')).status).toBe(426);
    expect((await request(current.app.getHttpServer()).get('/api/v1/test-widgets').set(APP)).status).toBe(200);
  });

  it('EVM-094 AC6 an operation outside the list is not asked for the version at all', async () => {
    current = await start(policies({ roles: ['administrator'], channels: ['mobile'] }), resolver(ANONYMOUS, { principal: bearer }));
    expect((await request(current.app.getHttpServer()).get('/api/v1/test-widgets')).status).toBe(200);
  });
});

describe('an operation open to both channels, the credential and the version (EVM-127 AC2; SR-AUTHZ-12, SR-API-08, SR-SESS-06)', () => {
  const both = (): PolicySource =>
    policies(
      { roles: ['administrator', 'editor', 'read_only'], channels: ['web', 'mobile'] },
      { clientVersionOperations: ['listTestWidgets'] },
    );
  const OLD = { 'X-Client-Platform': 'android', 'X-Client-Version': '1.0.0' };
  const code = async (web: Authentication, phone: Authentication, headers: Record<string, string> = {}) => {
    current = await start(both(), resolver(web, phone));
    const response = await request(current.app.getHttpServer()).get('/api/v1/test-widgets').set(headers);
    await current.close();
    current = undefined;
    return { status: response.status, code: (response.body as { code?: string }).code };
  };

  it('EVM-127 AC2 a revoked or an expired cookie without a Bearer token keeps its own 401 (session_revoked / session_expired), not unauthenticated', async () => {
    expect(await code({ principal: null, reason: 'revoked' }, ANONYMOUS)).toEqual({ status: 401, code: 'session_revoked' });
    expect(await code({ principal: null, reason: 'expired' }, ANONYMOUS)).toEqual({ status: 401, code: 'session_expired' });
    expect(await code(ANONYMOUS, ANONYMOUS)).toEqual({ status: 401, code: 'unauthenticated' });
  });

  it('EVM-127 AC2 a wipe of the device with a Bearer token is still 401 device_wipe_required, a revoked Bearer token is 401 session_revoked', async () => {
    expect(await code({ principal: null, reason: 'revoked' }, { principal: null, reason: 'wipe_required' })).toEqual({
      status: 401,
      code: 'device_wipe_required',
    });
    expect(await code(ANONYMOUS, { principal: null, reason: 'revoked' })).toEqual({ status: 401, code: 'session_revoked' });
  });

  it('EVM-127 AC2 the version of the app is asked only of a Bearer token: no headers or an old version is 426, an anonymous caller is 401 before 426', async () => {
    expect(await code(ANONYMOUS, { principal: bearer })).toEqual({ status: 426, code: 'client_version_unsupported' });
    expect(await code(ANONYMOUS, { principal: bearer }, OLD)).toEqual({ status: 426, code: 'client_version_unsupported' });
    expect(await code(ANONYMOUS, { principal: bearer }, APP)).toEqual({ status: 200, code: undefined });
    expect(await code(ANONYMOUS, ANONYMOUS, OLD)).toEqual({ status: 401, code: 'unauthenticated' });
  });

  it('EVM-127 AC2 a cookie of the panel is never asked for the version: old, forged or absent X-Client-* headers do not change the path', async () => {
    expect(await code({ principal: cookie }, ANONYMOUS)).toEqual({ status: 200, code: undefined });
    expect(await code({ principal: cookie }, ANONYMOUS, OLD)).toEqual({ status: 200, code: undefined });
    expect(await code({ principal: cookie }, { principal: bearer }, OLD)).toEqual({ status: 200, code: undefined });
  });

  it('EVM-127 AC2 a session of the phone in a cookie is no credential: 401, and a Bearer token next to it still wins', async () => {
    expect(await code({ principal: bearer }, ANONYMOUS, APP)).toEqual({ status: 401, code: 'unauthenticated' });
    expect(await code({ principal: bearer }, { principal: bearer }, APP)).toEqual({ status: 200, code: undefined });
  });

  it('EVM-127 AC2 a Bearer principal of the role Tylko odczyt is 403 channel_not_allowed (the sign-in of that role is refused with the same code, EVM-094)', async () => {
    const readOnly = principal({ channel: 'mobile', role: 'read_only', csrfToken: '' });
    expect(await code(ANONYMOUS, { principal: readOnly }, APP)).toEqual({ status: 403, code: 'channel_not_allowed' });
  });
});
