import type { AuthzManifest } from '@evia/contracts/authz';
import { describe, expect, it, vi } from 'vitest';
import { decideAccess, type AccessRequest } from '../../src/modules/authorization/access-decision.ts';
import { ANONYMOUS, type Authentication } from '../../src/platform/http/principal.ts';
import { principal } from '../support/principals.ts';

const PANEL = 'https://panel.evia.test';

const manifest: AuthzManifest = {
  phoneLogin: { method: 'post', path: '/api/v1/phone/login', query: [], authz: { public: true, channels: ['mobile'] } },
  panelLogin: { method: 'post', path: '/api/v1/panel/login', query: [], authz: { public: true } },
  phoneLogout: {
    method: 'post',
    path: '/api/v1/phone/logout',
    query: [],
    authz: { roles: ['administrator', 'editor'], channels: ['mobile'] },
  },
  panelEdit: { method: 'post', path: '/api/v1/panel/edit', query: [], authz: { roles: ['administrator', 'editor'], channels: ['web'] } },
};

const allow = () => ({ allowed: true, retryAfterSeconds: 1 });
const request = (overrides: Partial<AccessRequest> & { operationId: string }): AccessRequest => ({
  manifest,
  publicOperations: ['phoneLogin', 'panelLogin'],
  mfaEnrollmentOperations: [],
  authenticationOperations: [],
  mutating: true,
  origin: undefined,
  secFetchSite: undefined,
  panelOrigin: PANEL,
  authentication: () => ANONYMOUS,
  csrfMatches: () => false,
  rateLimit: allow,
  rateLimitUser: allow,
  channelAllowed: () => true,
  stepUpFresh: () => true,
  ...overrides,
});
const signedIn = (overrides = {}): Authentication => ({ principal: principal(overrides) });

describe('the mobile channel in the access decision (EVM-094 AC3; SR-AUTHZ-12, SR-SESS-10, ASVS V3.5)', () => {
  it('EVM-094 AC3 a public operation of the mobile channel alone needs no Origin; a public operation of the panel still does', () => {
    expect(decideAccess(request({ operationId: 'phoneLogin' }))).toEqual({ allowed: true });
    expect(decideAccess(request({ operationId: 'panelLogin' }))).toEqual({ allowed: false, code: 'csrf_failed' });
  });

  it('EVM-094 AC3 a principal that came from a Bearer token needs no Origin and no CSRF token on an operation of the mobile channel', () => {
    const decision = decideAccess(
      request({ operationId: 'phoneLogout', authentication: () => signedIn({ channel: 'mobile' }), viaBearer: true }),
    );
    expect(decision).toEqual({ allowed: true });
  });

  it('EVM-094 AC3 the exemption is the credential and the channel — nothing the client sends: a cookie principal is never exempt, even with a mobile channel', () => {
    for (const viaBearer of [false, undefined]) {
      expect(
        decideAccess(request({ operationId: 'phoneLogout', authentication: () => signedIn({ channel: 'mobile' }), viaBearer })),
      ).toEqual({
        allowed: false,
        code: 'csrf_failed',
      });
    }
    // a Bearer principal of the web channel (impossible, but the rule is stated) is not exempt either
    expect(
      decideAccess(request({ operationId: 'panelEdit', authentication: () => signedIn({ channel: 'web' }), viaBearer: true })),
    ).toEqual({
      allowed: false,
      code: 'csrf_failed',
    });
  });

  it('EVM-094 AC3 the role is still checked for the phone on every request: a read-only role is forbidden, and a principal of the other channel is forbidden too', () => {
    const channelAllowed = (role: string, channel: string) => !(role === 'read_only' && channel === 'mobile');
    expect(
      decideAccess(
        request({
          operationId: 'phoneLogout',
          authentication: () => signedIn({ channel: 'mobile', role: 'read_only' }),
          viaBearer: true,
          channelAllowed,
        }),
      ),
    ).toEqual({ allowed: false, code: 'forbidden' });
    expect(
      decideAccess(request({ operationId: 'panelEdit', authentication: () => signedIn({ channel: 'mobile' }), viaBearer: true })),
    ).toEqual({
      allowed: false,
      code: 'forbidden',
    });
  });

  it('EVM-094 AC7 a device ordered to wipe has its own answer, ahead of every other: device_wipe_required (401)', () => {
    const authentication = (): Authentication => ({ principal: null, reason: 'wipe_required' });
    expect(decideAccess(request({ operationId: 'phoneLogout', authentication, viaBearer: true }))).toEqual({
      allowed: false,
      code: 'device_wipe_required',
    });
  });

  it('EVM-094 AC3 the limit per user still counts the phone (300 a minute)', () => {
    const rateLimitUser = vi.fn(() => ({ allowed: false, retryAfterSeconds: 7 }));
    expect(
      decideAccess(
        request({ operationId: 'phoneLogout', authentication: () => signedIn({ channel: 'mobile' }), viaBearer: true, rateLimitUser }),
      ),
    ).toEqual({ allowed: false, code: 'rate_limited', retryAfterSeconds: 7 });
  });
});
