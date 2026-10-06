import type { Page, Request, Route } from '@playwright/test';

/**
 * A synthetic API for the panel's browser tests (EVM-016 AC3–AC6). It plays the server side of the contract closely
 * enough that the browser does the real work: the origin check looks at the header the browser itself sends (`Origin`), the passkey is verified against the challenge and the origin the browser really put into
 * `clientDataJSON`. Everything is synthetic — no real accounts, tokens or addresses. The full stack (real API and
 * database) is covered by the API integration tests and the QA run; here the target is the tab.
 */
export type SessionKind = 'none' | 'active' | 'enrollment';

export const VALID_TOKEN = 'Vz3-_Aq9'.repeat(5) + 'xyz';
export const EMAIL = 'anna.testowa@example.com';
export const DISPLAY_NAME = 'Anna Testowa';
export const PASSWORD = 'zażółć gęślą jaźń!';
/** Relying party of the synthetic server: `localhost` is the only host that WebAuthn accepts besides domain names. */
export const RP_ID = 'localhost';

export interface Seen {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly postData: string | null;
}

export interface MockApi {
  readonly seen: Seen[];
  session: SessionKind;
  /** Decides the answer for `checkActivationLink` (default: valid only for VALID_TOKEN). */
  tokenValid: (token: string) => boolean;
  /** Answers of the next calls, to rehearse failures. */
  failNext: Map<string, { status: number; code: string; headers?: Record<string, string> }>;
  /** EVM-067: the account of the synthetic server has a passkey (`second_step`) or none (`mfa_enrollment`). */
  loginMode: 'second_step' | 'mfa_enrollment';
  /** EVM-067: id (base64url) of the passkey the test registered in the virtual authenticator; the login accepts only it. */
  credentialId: string | null;
  /** EVM-067: the server has ended the session (`GET /session` answers `401 session_expired`). */
  expired: boolean;
  /** EVM-067: minutes from the first read of a session to the end of inactivity and to the absolute end. */
  sessionMinutes: { idle: number; absolute: number };
  /** EVM-067: how far the clock of the tab was moved (`page.clock`), so that the server counts in the tab's time. */
  clockOffsetMs: number;
  /** EVM-067: the deadlines of the current session (fixed at its first read; moved only by the extension). */
  deadlines: { idle: number; absolute: number } | null;
  /** EVM-067: the first-step token that was issued, to check it never travels anywhere but the POST bodies. */
  loginToken: string | null;
}

const problem = (status: number, code: string, extra: object = {}, headers: Record<string, string> = {}) => ({
  status,
  headers: { 'Content-Type': 'application/problem+json', ...headers },
  body: JSON.stringify({ type: `/problems/${code}`, title: code, status, code, traceId: '0123456789abcdef0123456789abcdef', ...extra }),
});

const ok = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  status,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

const MINUTE = 60_000;
export const LOGIN_TOKEN = 'Lg7-_Qz2'.repeat(5) + 'abc';

function sessionBody(
  kind: Exclude<SessionKind, 'none'>,
  deadlines = { idle: Date.now() + 60 * MINUTE, absolute: Date.now() + 720 * MINUTE },
) {
  return {
    user: { id: '11111111-1111-4111-8111-111111111111', displayName: DISPLAY_NAME, role: 'administrator' },
    state: kind === 'active' ? 'active' : 'mfa_enrollment',
    channel: 'web',
    csrfToken: kind === 'active' ? 'csrf-active' : 'csrf-enrollment',
    idleExpiresAt: new Date(deadlines.idle).toISOString(),
    absoluteExpiresAt: new Date(deadlines.absolute).toISOString(),
  };
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

export async function installMockApi(page: Page, session: SessionKind, origin: string): Promise<MockApi> {
  const api: MockApi = {
    seen: [],
    session,
    tokenValid: (token) => token === VALID_TOKEN,
    failNext: new Map(),
    loginMode: 'second_step',
    credentialId: null,
    expired: false,
    sessionMinutes: { idle: 60, absolute: 720 },
    clockOffsetMs: 0,
    deadlines: null,
    loginToken: null,
  };
  let loginChallenge = '';
  let loginTokenUsed = false;
  let challenge = '';

  const answer = async (route: Route, request: Request) => {
    const url = new URL(request.url());
    const headers = await request.allHeaders();
    const key = `${request.method()} ${url.pathname}`;
    api.seen.push({ method: request.method(), url: request.url(), headers, postData: request.postData() });

    const failure = api.failNext.get(key);
    if (failure) {
      api.failNext.delete(key);
      return route.fulfill(problem(failure.status, failure.code, {}, failure.headers));
    }
    const mutation = request.method() !== 'GET';
    // `Sec-Fetch-Site` is added after Playwright's interception, so only `Origin` is visible here; the full pair is
    // checked by the API tests.
    if (mutation && headers['origin'] !== origin) return route.fulfill(problem(403, 'csrf_failed'));
    const csrfOk = headers['x-csrf-token'] === sessionBody(api.session === 'none' ? 'enrollment' : api.session).csrfToken;
    const body = (): unknown => JSON.parse(request.postData() ?? '{}');

    switch (key) {
      case 'GET /api/v1/auth/session':
        if (api.session !== 'none' && api.expired) {
          api.session = 'none';
          return route.fulfill(problem(401, 'session_expired'));
        }
        if (api.session === 'none') return route.fulfill(problem(401, 'unauthenticated'));
        api.deadlines ??= {
          idle: Date.now() + api.clockOffsetMs + api.sessionMinutes.idle * MINUTE,
          absolute: Date.now() + api.clockOffsetMs + api.sessionMinutes.absolute * MINUTE,
        };
        return route.fulfill(ok(200, sessionBody(api.session, api.deadlines)));
      case 'POST /api/v1/auth/login': {
        const { email, password } = body() as { email?: string; password?: string };
        if (email !== EMAIL || password !== PASSWORD) return route.fulfill(problem(401, 'invalid_credentials'));
        if (api.loginMode === 'mfa_enrollment') {
          api.session = 'enrollment';
          return route.fulfill(ok(200, { state: 'mfa_enrollment', csrfToken: 'csrf-enrollment' }));
        }
        api.loginToken = LOGIN_TOKEN;
        loginTokenUsed = false;
        return route.fulfill(ok(200, { state: 'second_step', loginToken: LOGIN_TOKEN, methods: ['passkey'] }));
      }
      case 'POST /api/v1/auth/login/passkey/options': {
        const { loginToken } = body() as { loginToken?: string };
        if (loginToken !== api.loginToken || loginTokenUsed || api.credentialId === null)
          return route.fulfill(problem(401, 'unauthenticated'));
        loginChallenge = Buffer.from(`login-challenge-${String(api.seen.length)}-0123456789abcdef`).toString('base64url');
        return route.fulfill(
          ok(200, {
            challenge: loginChallenge,
            rpId: RP_ID,
            timeout: 300_000,
            userVerification: 'required',
            allowCredentials: [{ id: api.credentialId, type: 'public-key' }],
          }),
        );
      }
      case 'POST /api/v1/auth/login/passkey': {
        const { loginToken, credential } = body() as {
          loginToken?: string;
          credential: { id: string; response: { clientDataJSON: string } };
        };
        if (loginToken !== api.loginToken || loginTokenUsed) return route.fulfill(problem(401, 'unauthenticated'));
        const client = JSON.parse(decodeBase64Url(credential.response.clientDataJSON)) as {
          type: string;
          challenge: string;
          origin: string;
        };
        const verified =
          client.type === 'webauthn.get' &&
          client.challenge === loginChallenge &&
          client.origin === origin &&
          credential.id === api.credentialId;
        if (!verified) return route.fulfill(problem(401, 'passkey_failed'));
        loginTokenUsed = true;
        api.session = 'active';
        api.deadlines = null;
        return route.fulfill(ok(200, { state: 'active', csrfToken: 'csrf-active' }));
      }
      case 'POST /api/v1/auth/session/extend': {
        if (api.session === 'none') return route.fulfill(problem(401, 'unauthenticated'));
        if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
        if (api.deadlines === null) return route.fulfill(problem(401, 'unauthenticated'));
        // Inactivity counts from now (in the time of the tab), never beyond the absolute end.
        api.deadlines = {
          idle: Math.min(Date.now() + api.clockOffsetMs + api.sessionMinutes.idle * MINUTE, api.deadlines.absolute),
          absolute: api.deadlines.absolute,
        };
        return route.fulfill(
          ok(200, {
            idleExpiresAt: new Date(api.deadlines.idle).toISOString(),
            absoluteExpiresAt: new Date(api.deadlines.absolute).toISOString(),
          }),
        );
      }
      case 'POST /api/v1/auth/activation/check': {
        const { token } = body() as { token?: string };
        return api.tokenValid(token ?? '')
          ? route.fulfill(ok(200, { email: EMAIL, role: 'administrator' }))
          : route.fulfill(problem(400, 'activation_link_invalid'));
      }
      case 'POST /api/v1/auth/activation/password': {
        const { token, password } = body() as { token?: string; password?: string };
        if (!api.tokenValid(token ?? '')) return route.fulfill(problem(400, 'activation_link_invalid'));
        const length = Array.from((password ?? '').normalize('NFC')).length;
        if (length < 15) return route.fulfill(problem(400, 'validation_failed', { errors: [{ pointer: '/password', code: 'too_short' }] }));
        if (/^password/i.test(password ?? '')) {
          return route.fulfill(problem(400, 'validation_failed', { errors: [{ pointer: '/password', code: 'too_weak' }] }));
        }
        api.session = 'enrollment';
        return route.fulfill(ok(200, { csrfToken: 'csrf-enrollment' }));
      }
      case 'POST /api/v1/account/passkeys/registration-options':
        if (api.session === 'none') return route.fulfill(problem(401, 'unauthenticated'));
        if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
        challenge = Buffer.from(`challenge-${String(api.seen.length)}-0123456789abcdef`).toString('base64url');
        return route.fulfill(
          ok(200, {
            rp: { id: RP_ID, name: 'EVia Manager' },
            user: { id: Buffer.from('user-handle-synthetic-0123456789').toString('base64url'), name: EMAIL, displayName: DISPLAY_NAME },
            challenge,
            pubKeyCredParams: [
              { type: 'public-key', alg: -7 },
              { type: 'public-key', alg: -257 },
            ],
            timeout: 300_000,
            authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
            attestation: 'none',
          }),
        );
      case 'POST /api/v1/account/passkeys': {
        if (api.session !== 'enrollment') return route.fulfill(problem(api.session === 'none' ? 401 : 403, 'forbidden'));
        if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
        const { credential } = body() as { credential: { response: { clientDataJSON: string; attestationObject: string } } };
        const client = JSON.parse(decodeBase64Url(credential.response.clientDataJSON)) as {
          type: string;
          challenge: string;
          origin: string;
        };
        const verified =
          client.type === 'webauthn.create' &&
          client.challenge === challenge &&
          client.origin === origin &&
          credential.response.attestationObject.length > 0;
        if (!verified) return route.fulfill(problem(400, 'passkey_verification_failed'));
        api.session = 'active';
        return route.fulfill(
          ok(201, {
            id: '22222222-2222-4222-8222-222222222222',
            createdAt: '2026-10-06T10:00:00Z',
            deviceType: 'multi_device',
            backedUp: true,
          }),
        );
      }
      case 'POST /api/v1/auth/logout':
        if (api.session === 'none') return route.fulfill(problem(401, 'session_revoked'));
        if (!csrfOk) return route.fulfill(problem(403, 'csrf_failed'));
        api.session = 'none';
        return route.fulfill({ status: 204, headers: { 'Clear-Site-Data': '"cache", "storage"' } });
      default:
        return route.fulfill(problem(404, 'not_found'));
    }
  };

  await page.route('**/api/**', answer);
  return api;
}
