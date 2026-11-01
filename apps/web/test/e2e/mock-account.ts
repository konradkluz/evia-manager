/**
 * The part of the synthetic API that serves W-15 "Konto" (EVM-028): the profile, the change of the password, the removal of a
 * method of the second step, "Moje sesje". The passkeys, the code of the app, the recovery codes and the one-time mark of the
 * full re-authentication are kept here; the policy of the real server (the counter of the guesses, the roles, the e-mails, the
 * audit, the limit of 5 sessions) is covered by the API integration tests. Synthetic data only.
 */
export interface Answer {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export interface MockPasskey {
  id: string;
  name: string;
  createdAt: string;
}

export interface MockSessionRow {
  id: string;
  current: boolean;
  browser: string;
  os: string;
  ipAddress: string | null;
  lastSeenAt: string;
}

/** A phone of the synthetic register (EVM-095): the own ones feed W-15, all of them W-17. Models are synthetic. */
export interface MockDevice {
  id: string;
  own: boolean;
  user: { userId: string; displayName: string };
  model: string;
  osVersion: string;
  appVersion: string;
  patchLevel: string;
  lastContactAt: string;
  createdAt: string;
  state: string;
  pendingItemsReported: number;
}

export type ReauthPurpose = 'second_step_change' | 'password_change';

export interface AccountServer {
  displayName: string;
  /** The current password of the synthetic account (the change of the password checks it). */
  password: string;
  passkeys: MockPasskey[];
  totp: { addedAt: string } | null;
  recovery: { remaining: number; generatedAt: string } | null;
  /** The one-time mark of the full re-authentication (spent by the operation it was made for). */
  mark: ReauthPurpose | null;
  sessions: MockSessionRow[];
  devices: MockDevice[];
}

export const LAPTOP_ID = '22222222-2222-4222-8222-222222222201';
export const PHONE_ID = '22222222-2222-4222-8222-222222222202';
export const OTHER_SESSION_ID = '44444444-4444-4444-8444-444444444402';
export const CHROME_SESSION_ID = '44444444-4444-4444-8444-444444444403';

export const SAMSUNG_ID = '55555555-5555-4555-8555-555555555501';
export const PIXEL_ID = '55555555-5555-4555-8555-555555555502';
export const MOTO_ID = '55555555-5555-4555-8555-555555555503';
const ANNA = { userId: '11111111-1111-4111-8111-111111111111', displayName: 'Anna Testowa' };
const PIOTR = { userId: '22222222-2222-4222-8222-222222222299', displayName: 'Piotr Testowy' };

export const newAccountServer = (password: string): AccountServer => {
  const now = Date.now();
  return {
    displayName: 'Anna Testowa',
    password,
    passkeys: [
      { id: LAPTOP_ID, name: 'Laptop w biurze', createdAt: '2026-10-03T10:00:00.000Z' },
      { id: PHONE_ID, name: 'Telefon', createdAt: '2026-10-04T10:00:00.000Z' },
    ],
    totp: null,
    recovery: { remaining: 7, generatedAt: '2026-10-03T12:00:00.000Z' },
    mark: null,
    sessions: [
      {
        id: '44444444-4444-4444-8444-444444444401',
        current: true,
        browser: 'Edge',
        os: 'Windows',
        ipAddress: '198.51.100.23',
        lastSeenAt: new Date(now).toISOString(),
      },
      {
        id: OTHER_SESSION_ID,
        current: false,
        browser: 'Firefox',
        os: 'Windows',
        ipAddress: '203.0.113.45',
        lastSeenAt: new Date(now - 3 * 3_600_000).toISOString(),
      },
      {
        id: CHROME_SESSION_ID,
        current: false,
        browser: 'Chrome',
        os: 'Android',
        ipAddress: '2001:db8:5::17',
        lastSeenAt: new Date(now - 20 * 3_600_000).toISOString(),
      },
    ],
    devices: [
      {
        id: SAMSUNG_ID,
        own: true,
        user: ANNA,
        model: 'Samsung SM-G781B',
        osVersion: '13',
        appVersion: '1.0.0',
        patchLevel: 'current',
        lastContactAt: new Date(now - 30 * 60_000).toISOString(),
        createdAt: '2026-10-01T08:00:00.000Z',
        state: 'active',
        pendingItemsReported: 0,
      },
      {
        id: PIXEL_ID,
        own: true,
        user: ANNA,
        model: 'Pixel 7',
        osVersion: '14',
        appVersion: '1.0.0',
        patchLevel: 'older_12m',
        lastContactAt: new Date(now - 9 * 86_400_000).toISOString(),
        createdAt: '2026-10-02T08:00:00.000Z',
        state: 'active',
        pendingItemsReported: 4,
      },
      {
        id: MOTO_ID,
        own: false,
        user: PIOTR,
        model: 'Moto G',
        osVersion: '12',
        appVersion: '0.9.2',
        patchLevel: 'unknown',
        lastContactAt: new Date(now - 20 * 86_400_000).toISOString(),
        createdAt: '2026-09-20T08:00:00.000Z',
        state: 'wipe_required',
        pendingItemsReported: 0,
      },
    ],
  };
};

const problem = (status: number, code: string, extra: object = {}, headers: Record<string, string> = {}): Answer => ({
  status,
  headers: { 'Content-Type': 'application/problem+json', ...headers },
  body: JSON.stringify({ type: `/problems/${code}`, title: code, status, code, traceId: '0123456789abcdef0123456789abcdef', ...extra }),
});

const ok = (status: number, body: unknown, headers: Record<string, string> = {}): Answer => ({
  status,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

const NO_CONTENT: Answer = { status: 204, headers: {}, body: '' };

/** The account as the API gives it (no secrets): the passkeys with their names, the code of the app, the recovery codes. */
export const accountBody = (server: AccountServer, role: string, email: string) => ({
  displayName: server.displayName,
  email,
  role,
  secondStep: {
    passkeys: server.passkeys.map((passkey) => ({ ...passkey, deviceType: 'multi_device', backedUp: true })),
    totp: server.totp,
    recoveryCodes: server.recovery,
  },
});

export interface AccountRequest {
  readonly method: string;
  readonly pathname: string;
  readonly query?: URLSearchParams;
  readonly body: () => unknown;
  readonly role: string;
  readonly email: string;
  /** The window of the step-up is open. */
  readonly stepUpFresh: boolean;
}

/** The rule of the last method (AC4): the server's decision, whatever the panel shows. */
const lastMethod = (server: AccountServer, role: string, removing: 'passkey' | 'totp'): Answer | null => {
  if (role === 'administrator') {
    return removing === 'passkey' && server.passkeys.length <= 1
      ? problem(409, 'last_second_step_method', { errors: [{ pointer: '/passkeyId', code: 'passkey_required' }] })
      : null;
  }
  const methods = server.passkeys.length + (server.totp === null ? 0 : 1);
  return methods <= 1 ? problem(409, 'last_second_step_method', { errors: [{ pointer: '/passkeyId', code: 'method_required' }] }) : null;
};

/** Spends the mark of the full re-authentication for the purpose; without it `403 reauthentication_required`. */
export const spendMark = (server: AccountServer, purpose: ReauthPurpose): Answer | null => {
  if (server.mark !== purpose) return problem(403, 'reauthentication_required');
  server.mark = null;
  return null;
};

/**
 * The routes of W-15 that need no ceremony: the reading and the change of the profile, the change of the password, the removal
 * of a passkey or of the code of the app, the list and the end of the sessions. `null` — not a route of this module.
 */
export function answerAccountRoute(server: AccountServer, request: AccountRequest): Answer | null {
  const { method, pathname } = request;
  if (pathname === '/api/v1/account' && method === 'GET') {
    return ok(200, accountBody(server, request.role, request.email), { 'Cache-Control': 'no-store' });
  }
  if (pathname === '/api/v1/account' && method === 'PATCH') {
    const { displayName } = request.body() as { displayName?: unknown };
    if (typeof displayName !== 'string' || displayName.trim() === '' || Array.from(displayName.trim()).length > 200) {
      return problem(400, 'validation_failed', {
        errors: [{ pointer: '/displayName', code: displayName === '' ? 'required' : 'too_long' }],
      });
    }
    server.displayName = displayName.trim();
    return ok(200, accountBody(server, request.role, request.email), { 'Cache-Control': 'no-store' });
  }
  if (pathname === '/api/v1/account/password' && method === 'POST') {
    const { currentPassword, newPassword } = request.body() as { currentPassword?: string; newPassword?: string };
    if (currentPassword !== server.password) return problem(401, 'invalid_credentials');
    if (typeof newPassword !== 'string' || Array.from(newPassword).length < 15) {
      return problem(400, 'validation_failed', { errors: [{ pointer: '/newPassword', code: 'too_short' }] });
    }
    if (newPassword === currentPassword) {
      return problem(400, 'validation_failed', { errors: [{ pointer: '/newPassword', code: 'same_as_current' }] });
    }
    const refused = spendMark(server, 'password_change');
    if (refused !== null) return refused;
    server.password = newPassword;
    return ok(200, { otherActiveSessions: server.sessions.filter((session) => !session.current).length });
  }
  const passkey = /^\/api\/v1\/account\/passkeys\/([^/]+)$/.exec(pathname);
  if (passkey !== null && method === 'DELETE') {
    const found = server.passkeys.find((entry) => entry.id === passkey[1]);
    if (found === undefined) return problem(404, 'not_found');
    const refused = spendMark(server, 'second_step_change') ?? lastMethod(server, request.role, 'passkey');
    if (refused !== null) return refused;
    server.passkeys = server.passkeys.filter((entry) => entry.id !== found.id);
    return NO_CONTENT;
  }
  if (pathname === '/api/v1/account/totp' && method === 'DELETE') {
    if (server.totp === null) return problem(404, 'not_found');
    const refused =
      spendMark(server, 'second_step_change') ?? (request.role === 'administrator' ? null : lastMethod(server, request.role, 'totp'));
    if (refused !== null) return refused;
    server.totp = null;
    return NO_CONTENT;
  }
  if (pathname === '/api/v1/account/sessions' && method === 'GET') {
    if (!request.stepUpFresh) return problem(403, 'step_up_required');
    return ok(200, { items: server.sessions }, { 'Cache-Control': 'no-store' });
  }
  if (pathname === '/api/v1/account/sessions' && method === 'DELETE') {
    if (!request.stepUpFresh) return problem(403, 'step_up_required');
    const ended = server.sessions.filter((session) => !session.current).length;
    server.sessions = server.sessions.filter((session) => session.current);
    return ok(200, { ended });
  }
  const devices = answerDevices(server, request);
  if (devices !== null) return devices;
  const session = /^\/api\/v1\/account\/sessions\/([^/]+)$/.exec(pathname);
  if (session !== null && method === 'DELETE') {
    if (!request.stepUpFresh) return problem(403, 'step_up_required');
    const found = server.sessions.find((entry) => entry.id === session[1]);
    if (found === undefined) return problem(404, 'not_found');
    if (found.current) return problem(409, 'current_session');
    server.sessions = server.sessions.filter((entry) => entry.id !== found.id);
    return NO_CONTENT;
  }
  return null;
}

/** The devices of EVM-095: the own phones (W-15), all of them for an Administrator (W-17), logout and wipe (the policy of the real server is covered by the API tests). */
function answerDevices(server: AccountServer, request: AccountRequest): Answer | null {
  const { method, pathname, role } = request;
  const nocache = { 'Cache-Control': 'no-store' };
  if (pathname === '/api/v1/account/devices' && method === 'GET') {
    if (role === 'read_only') return problem(403, 'forbidden');
    const items = server.devices
      .filter((device) => device.own)
      .map(({ id, model, osVersion, appVersion, lastContactAt, createdAt, state }) => ({
        id,
        model,
        osVersion,
        appVersion,
        lastContactAt,
        createdAt,
        state,
      }));
    return ok(200, { items }, nocache);
  }
  const own = /^\/api\/v1\/account\/devices\/([^/]+)\/logout$/.exec(pathname);
  if (own !== null && method === 'POST') {
    if (role === 'read_only') return problem(403, 'forbidden');
    const found = server.devices.find((device) => device.own && device.id === own[1]);
    if (found === undefined) return problem(404, 'not_found');
    if (!request.stepUpFresh) return problem(403, 'step_up_required');
    if (found.state === 'active') found.state = 'signed_out';
    return NO_CONTENT;
  }
  if (pathname === '/api/v1/devices' && method === 'GET') {
    if (role !== 'administrator') return problem(403, 'forbidden');
    if (!request.stepUpFresh) return problem(403, 'step_up_required');
    const state = request.query?.get('state');
    const items = server.devices
      .filter((device) => state === undefined || state === null || device.state === state)
      .map((device) => ({
        id: device.id,
        user: device.user,
        model: device.model,
        osVersion: device.osVersion,
        appVersion: device.appVersion,
        patchLevel: device.patchLevel,
        lastContactAt: device.lastContactAt,
        state: device.state,
        pendingItemsReported: device.pendingItemsReported,
      }));
    return ok(200, { items, nextCursor: null }, nocache);
  }
  const managed = /^\/api\/v1\/devices\/([^/]+)\/(logout|wipe)$/.exec(pathname);
  if (managed !== null && method === 'POST') {
    if (role !== 'administrator') return problem(403, 'forbidden');
    if (!request.stepUpFresh) return problem(403, 'step_up_required');
    const found = server.devices.find((device) => device.id === managed[1]);
    if (found === undefined) return problem(404, 'not_found');
    if (managed[2] === 'logout') {
      if (found.state === 'active') found.state = 'signed_out';
      return NO_CONTENT;
    }
    const body = request.body() as { confirmModel?: unknown };
    if (body.confirmModel !== found.model) return problem(400, 'device_model_mismatch');
    if (found.state === 'active' || found.state === 'signed_out') found.state = 'wipe_required';
    return NO_CONTENT;
  }
  return null;
}
