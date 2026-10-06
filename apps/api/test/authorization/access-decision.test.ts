import type { AuthzManifest } from '@evia/contracts/authz';
import { describe, expect, it, vi } from 'vitest';
import { decideAccess, type AccessRequest } from '../../src/modules/authorization/access-decision.ts';
import { ANONYMOUS, type Authentication } from '../../src/platform/http/principal.ts';
import { principal } from '../support/principals.ts';

const PANEL = 'https://panel.evia.test';

const manifest: AuthzManifest = {
  getHealth: { method: 'get', path: '/api/health', query: [], authz: { public: true } },
  getSecret: { method: 'get', path: '/api/v1/secret', query: [], authz: { public: true } },
  submitPublic: { method: 'post', path: '/api/v1/public-form', query: [], authz: { public: true } },
  listWorkOrders: {
    method: 'get',
    path: '/api/v1/work-orders',
    query: [],
    authz: { roles: ['administrator', 'editor'], channels: ['web'] },
  },
  createThing: { method: 'post', path: '/api/v1/things', query: [], authz: { roles: ['administrator'], channels: ['web', 'mobile'] } },
  enrol: {
    method: 'post',
    path: '/api/v1/enrol',
    query: [],
    authz: { roles: ['administrator'], channels: ['web'], allowDuringMfaEnrollment: true },
  },
  listedOnly: {
    method: 'post',
    path: '/api/v1/listed',
    query: [],
    authz: { roles: ['administrator'], channels: ['web'], allowDuringMfaEnrollment: true },
  },
  flaggedOnly: { method: 'post', path: '/api/v1/flagged', query: [], authz: { roles: ['administrator'], channels: ['web'] } },
  noChannels: { method: 'get', path: '/api/v1/no-channels', query: [], authz: { roles: ['administrator'] } },
  noRoles: { method: 'get', path: '/api/v1/no-roles', query: [], authz: { channels: ['web'] } },
};

const allow = () => ({ allowed: true, retryAfterSeconds: 1 });

function request(overrides: Partial<AccessRequest> & { operationId: string | undefined }): AccessRequest {
  return {
    manifest,
    publicOperations: ['getHealth', 'submitPublic'],
    mfaEnrollmentOperations: ['enrol', 'flaggedOnly'],
    authenticationOperations: ['submitPublic', 'enrol'],
    mutating: false,
    origin: undefined,
    secFetchSite: undefined,
    panelOrigin: PANEL,
    authentication: () => ANONYMOUS,
    csrfMatches: () => true,
    rateLimit: allow,
    channelAllowed: () => true,
    ...overrides,
  };
}

const decide = (overrides: Partial<AccessRequest> & { operationId: string | undefined }) => decideAccess(request(overrides));
const signedIn = (overrides = {}): Authentication => ({ principal: principal(overrides) });
const sameOrigin = { origin: PANEL, secFetchSite: 'same-origin' };

describe('access decision (EVM-008 AC4; SR-AUTHZ-01, SR-ERR-01)', () => {
  it('EVM-008 AC4 an operation without a policy in the manifest is forbidden (403)', () => {
    for (const operationId of [undefined, 'notInTheContract', 'constructor', 'toString']) {
      expect(decide({ operationId }), String(operationId)).toEqual({ allowed: false, code: 'forbidden' });
    }
  });

  it('EVM-008 AC4 public is honoured only for allow-listed operations, without asking for a principal', () => {
    const authentication = vi.fn(() => ANONYMOUS);
    expect(decide({ operationId: 'getHealth', authentication })).toEqual({ allowed: true });
    expect(authentication).not.toHaveBeenCalled();
    expect(decide({ operationId: 'getSecret' })).toEqual({ allowed: false, code: 'forbidden' });
  });

  it('EVM-008 AC4 a protected operation without a principal is 401', () => {
    expect(decide({ operationId: 'listWorkOrders' })).toEqual({ allowed: false, code: 'unauthenticated' });
  });

  it('EVM-008 AC4 a failing session lookup is never an allow (the error propagates to the error boundary)', () => {
    expect(() =>
      decide({
        operationId: 'listWorkOrders',
        authentication: () => {
          throw new Error('session store unavailable');
        },
      }),
    ).toThrow('session store unavailable');
  });
});

describe('access decision order (EVM-016 AC4, AC8; SR-AUTHZ-12, SR-SESS-10)', () => {
  it('EVM-016 AC8 an operation without roles or channels in its policy is forbidden for everybody (fail closed)', () => {
    expect(decide({ operationId: 'noChannels', authentication: () => signedIn() })).toEqual({ allowed: false, code: 'forbidden' });
    expect(decide({ operationId: 'noRoles', authentication: () => signedIn() })).toEqual({ allowed: false, code: 'forbidden' });
  });

  it('EVM-016 AC8 a revoked session is 401 session_revoked, an unknown one 401 unauthenticated', () => {
    expect(decide({ operationId: 'listWorkOrders', authentication: () => ({ principal: null, reason: 'revoked' }) })).toEqual({
      allowed: false,
      code: 'session_revoked',
    });
    expect(decide({ operationId: 'listWorkOrders' })).toEqual({ allowed: false, code: 'unauthenticated' });
  });

  it('EVM-016 AC8 role, then channel: a role outside the policy and a channel outside the policy are both 403 forbidden', () => {
    const editor = signedIn({ role: 'editor' });
    expect(decide({ operationId: 'listWorkOrders', authentication: () => editor })).toEqual({ allowed: true });
    expect(decide({ operationId: 'createThing', authentication: () => editor, ...sameOrigin, mutating: true })).toEqual({
      allowed: false,
      code: 'forbidden',
    });
    const mobile = signedIn({ channel: 'mobile' });
    expect(decide({ operationId: 'listWorkOrders', authentication: () => mobile })).toEqual({ allowed: false, code: 'forbidden' });
    expect(decide({ operationId: 'createThing', authentication: () => mobile, ...sameOrigin, mutating: true })).toEqual({ allowed: true });
  });

  it('EVM-016 AC8 the role x channel rule of identity can deny a channel the policy allows (read-only has no mobile)', () => {
    const channelAllowed = (role: string, channel: string) => !(role === 'read_only' && channel === 'mobile');
    const readOnly = signedIn({ role: 'read_only', channel: 'mobile' });
    expect(decide({ operationId: 'listWorkOrders', authentication: () => readOnly, channelAllowed })).toEqual({
      allowed: false,
      code: 'forbidden',
    });
  });

  it('EVM-016 AC4 a session in mfa_enrollment may call only operations on the list that declare the flag (403 mfa_enrollment_required)', () => {
    const enrolling = signedIn({ state: 'mfa_enrollment' });
    const post = { ...sameOrigin, mutating: true, authentication: () => enrolling };
    expect(decide({ operationId: 'enrol', ...post })).toEqual({ allowed: true });
    expect(decide({ operationId: 'listWorkOrders', authentication: () => enrolling })).toEqual({
      allowed: false,
      code: 'mfa_enrollment_required',
    });
    // on the list but not declared in the contract, declared in the contract but not on the list: both denied
    expect(decide({ operationId: 'flaggedOnly', ...post })).toEqual({ allowed: false, code: 'mfa_enrollment_required' });
    expect(decide({ operationId: 'listedOnly', ...post })).toEqual({ allowed: false, code: 'mfa_enrollment_required' });
  });

  it('EVM-016 AC4 the enrolment check comes before the role check', () => {
    const enrolling = signedIn({ state: 'mfa_enrollment', role: 'read_only' });
    expect(decide({ operationId: 'listWorkOrders', authentication: () => enrolling })).toEqual({
      allowed: false,
      code: 'mfa_enrollment_required',
    });
  });

  it('EVM-016 AC6 a mutation of a session needs Origin, Sec-Fetch-Site and the CSRF token (403 csrf_failed)', () => {
    const base = { operationId: 'createThing', mutating: true, authentication: () => signedIn() };
    expect(decide({ ...base, ...sameOrigin })).toEqual({ allowed: true });
    expect(decide({ ...base, origin: PANEL, secFetchSite: 'same-origin', csrfMatches: () => false })).toEqual({
      allowed: false,
      code: 'csrf_failed',
    });
    for (const [origin, secFetchSite] of [
      [undefined, 'same-origin'],
      ['https://attacker.invalid', 'same-origin'],
      [PANEL, undefined],
      [PANEL, 'same-site'],
      [PANEL, 'cross-site'],
      [PANEL, 'none'],
    ] as const) {
      expect(decide({ ...base, origin, secFetchSite }), `${origin} ${secFetchSite}`).toEqual({ allowed: false, code: 'csrf_failed' });
    }
  });

  it('EVM-016 AC6 a safe method needs no CSRF token, and CSRF is checked after authentication (401 first)', () => {
    expect(decide({ operationId: 'listWorkOrders', authentication: () => signedIn(), csrfMatches: () => false })).toEqual({
      allowed: true,
    });
    expect(decide({ operationId: 'createThing', mutating: true })).toEqual({ allowed: false, code: 'unauthenticated' });
  });

  it('EVM-016 AC6 CSRF comes before the enrolment, role and channel checks', () => {
    const enrolling = signedIn({ state: 'mfa_enrollment', role: 'read_only' });
    expect(decide({ operationId: 'createThing', mutating: true, authentication: () => enrolling })).toEqual({
      allowed: false,
      code: 'csrf_failed',
    });
  });

  it('EVM-016 AC5 a public mutation needs Origin and Sec-Fetch-Site of the panel, then the limiter (the 403 comes first)', () => {
    const rateLimit = vi.fn(allow);
    expect(decide({ operationId: 'submitPublic', mutating: true, rateLimit })).toEqual({ allowed: false, code: 'csrf_failed' });
    expect(decide({ operationId: 'submitPublic', mutating: true, origin: PANEL, secFetchSite: 'cross-site', rateLimit })).toEqual({
      allowed: false,
      code: 'csrf_failed',
    });
    expect(rateLimit).not.toHaveBeenCalled();
    expect(decide({ operationId: 'submitPublic', mutating: true, ...sameOrigin, rateLimit })).toEqual({ allowed: true });
    expect(rateLimit).toHaveBeenCalledWith('authentication');
  });

  it('EVM-016 AC5 public reads and other public operations are limited per IP in the anonymous bucket (429 with Retry-After)', () => {
    const rateLimit = vi.fn(() => ({ allowed: false, retryAfterSeconds: 17 }));
    expect(decide({ operationId: 'getHealth', rateLimit })).toEqual({ allowed: false, code: 'rate_limited', retryAfterSeconds: 17 });
    expect(rateLimit).toHaveBeenCalledWith('anonymous');
  });

  it('EVM-016 AC4 sign-in and MFA operations of a session use the stricter bucket (429)', () => {
    const rateLimit = vi.fn(() => ({ allowed: false, retryAfterSeconds: 5 }));
    const result = decide({ operationId: 'enrol', mutating: true, ...sameOrigin, authentication: () => signedIn(), rateLimit });
    expect(result).toEqual({ allowed: false, code: 'rate_limited', retryAfterSeconds: 5 });
    expect(rateLimit).toHaveBeenCalledWith('authentication');
    const other = vi.fn(allow);
    decide({ operationId: 'listWorkOrders', authentication: () => signedIn(), rateLimit: other });
    expect(other).not.toHaveBeenCalled();
  });
});
