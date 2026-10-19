/**
 * The part of the synthetic API that serves W-16 (EVM-024): the list of users, the invitation and its resend. The accounts, the
 * states of the invitations and the idempotency of the invitation are kept here; the policy of the real server (roles, the outbox,
 * the worker, the unlinking of the previous link, the limits) is covered by the API integration tests. Synthetic data only.
 */
export interface Answer {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export interface MockUser {
  id: string;
  email: string;
  displayName: string;
  role: 'administrator' | 'editor' | 'read_only';
  status: 'invited' | 'active' | 'deactivated';
  invitation: { state: 'sending' | 'sent' | 'failed' | 'expired'; sentAt: string | null; expiresAt: string | null } | null;
  /** EVM-027: the version of the account (`If-Match`), the first activation and the kinds of the methods of the second step. */
  version: number;
  activatedAt: string | null;
  secondStepMethods: ('passkey' | 'totp')[];
}

export interface UsersServer {
  readonly users: MockUser[];
  /** Addresses of deleted accounts: `409 email_conflict` without `existingUserId`. */
  readonly deletedEmails: string[];
  /** `Idempotency-Key` → the answer of the first request (a retry gets the same account). */
  readonly keys: Map<string, MockUser>;
  /** How many invitations were accepted (a retry with the same key counts once). */
  accepted: number;
}

const HOUR = 3_600_000;
export const SELF_ID = '11111111-1111-4111-8111-111111111111';
export const BIURO_ID = '33333333-3333-4333-8333-333333333301';
export const KASIA_ID = '33333333-3333-4333-8333-333333333302';

export const newUsersServer = (): UsersServer => {
  const now = Date.now();
  return {
    users: [
      {
        id: BIURO_ID,
        email: 'biuro@example.com',
        displayName: 'Biuro Testowe',
        role: 'read_only',
        status: 'invited',
        invitation: { state: 'sent', sentAt: new Date(now - 24 * HOUR).toISOString(), expiresAt: new Date(now + 48 * HOUR).toISOString() },
        version: 1,
        activatedAt: null,
        secondStepMethods: [],
      },
      {
        id: '33333333-3333-4333-8333-333333333303',
        email: 'jan.przykladowy@example.com',
        displayName: 'Jan Przykładowy',
        role: 'editor',
        status: 'active',
        invitation: null,
        version: 3,
        activatedAt: new Date(now - 30 * 24 * HOUR).toISOString(),
        secondStepMethods: ['passkey'],
      },
      {
        id: KASIA_ID,
        email: 'kasia.testowa@example.com',
        displayName: 'Kasia Testowa',
        role: 'editor',
        status: 'invited',
        invitation: { state: 'failed', sentAt: null, expiresAt: null },
        version: 1,
        activatedAt: null,
        secondStepMethods: [],
      },
      {
        id: '33333333-3333-4333-8333-333333333304',
        email: 'marek.testowy@example.com',
        displayName: 'Marek Testowy',
        role: 'editor',
        status: 'deactivated',
        invitation: null,
        version: 5,
        activatedAt: new Date(now - 60 * 24 * HOUR).toISOString(),
        secondStepMethods: ['passkey'],
      },
      {
        id: SELF_ID,
        email: 'anna.testowa@example.com',
        displayName: 'Anna Testowa',
        role: 'administrator',
        status: 'active',
        invitation: null,
        version: 1,
        activatedAt: new Date(now - 90 * 24 * HOUR).toISOString(),
        secondStepMethods: ['passkey'],
      },
    ],
    deletedEmails: ['usuniety@example.com'],
    keys: new Map(),
    accepted: 0,
  };
};

const respond = (status: number, body: unknown, headers: Record<string, string> = {}): Answer => ({
  status,
  headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json', ...headers },
  body: JSON.stringify(body),
});

const problem = (status: number, code: string, extra: object = {}): Answer =>
  respond(status, { type: `/problems/${code}`, title: code, status, code, traceId: '0123456789abcdef0123456789abcdef', ...extra });

const collator = new Intl.Collator('pl');
const ADDRESS = /^[^\s@<>,;"]+@[^\s@<>,;"]+$/u;
const base64Url = (text: string): string => Buffer.from(text).toString('base64url');

/** The list in the Polish alphabet by name, with the cursor (an offset) and `limit`. */
export function answerUserList(server: UsersServer, query: URLSearchParams): Answer {
  const ordered = [...server.users].sort((a, b) => collator.compare(a.displayName, b.displayName) || a.id.localeCompare(b.id));
  const start = query.get('cursor') === null ? 0 : Number(Buffer.from(query.get('cursor') ?? '', 'base64url').toString());
  const limit = Number(query.get('limit') ?? '25');
  const nextCursor = start + limit < ordered.length ? base64Url(String(start + limit)) : null;
  return respond(200, { items: ordered.slice(start, start + limit), nextCursor });
}

/** `POST /users`: validation, the conflict of the address, idempotency by the key; the new account waits in the queue ("Wysyłanie…"). */
export function answerInvite(server: UsersServer, input: Record<string, unknown>, key: string | undefined): Answer {
  const email = typeof input['email'] === 'string' ? input['email'].normalize('NFC').trim().toLowerCase() : '';
  const displayName = typeof input['displayName'] === 'string' ? input['displayName'].trim() : '';
  const role = input['role'];
  const errors: { pointer: string; code: string }[] = [];
  if (!ADDRESS.test(email)) errors.push({ pointer: '/email', code: 'invalid_email' });
  if (displayName === '') errors.push({ pointer: '/displayName', code: 'required' });
  if (role !== 'administrator' && role !== 'editor' && role !== 'read_only') errors.push({ pointer: '/role', code: 'invalid_value' });
  if (errors.length > 0 || typeof input['id'] !== 'string' || (role !== 'administrator' && role !== 'editor' && role !== 'read_only')) {
    return problem(400, 'validation_failed', { errors });
  }
  const known = key === undefined ? undefined : server.keys.get(key);
  if (known !== undefined) return respond(201, known, { Location: `/api/v1/users/${known.id}` });
  const existing = server.users.find((user) => user.email === email);
  if (existing !== undefined) return problem(409, 'email_conflict', { existingUserId: existing.id });
  if (server.deletedEmails.includes(email)) return problem(409, 'email_conflict');
  const created: MockUser = {
    id: input['id'],
    email,
    displayName,
    role,
    status: 'invited',
    invitation: { state: 'sending', sentAt: null, expiresAt: null },
    version: 1,
    activatedAt: null,
    secondStepMethods: [],
  };
  server.users.push(created);
  server.accepted += 1;
  if (key !== undefined) server.keys.set(key, created);
  return respond(201, created, { Location: `/api/v1/users/${created.id}` });
}

/** `POST /users/{id}/invitations`: only an account that waits for activation; the invitation goes back to the queue. */
export function answerResend(server: UsersServer, id: string): Answer {
  const user = server.users.find((entry) => entry.id === id);
  if (user === undefined) return problem(404, 'not_found');
  if (user.status !== 'invited') return problem(409, 'invalid_state_transition');
  user.invitation = { state: 'sending', sentAt: null, expiresAt: null };
  return respond(200, user);
}

export type AccountOperationName = 'role' | 'deactivation' | 'reactivation' | 'sessions' | 'second-step-reset';

/**
 * The five operations of EVM-027 on an account (the policy of the real server — the roles, the blocking, the audit, the sessions —
 * is covered by the API integration tests): 404 first, then `If-Match` (428 / 412), then the rules of the story in their order
 * (the state, the last active Administrator, the own account, the passkey of a new Administrator). Every change raises the version.
 */
export function answerAccountOperation(
  server: UsersServer,
  operation: AccountOperationName,
  id: string,
  ifMatch: string | undefined,
  input: Record<string, unknown>,
): Answer {
  const user = server.users.find((entry) => entry.id === id);
  if (user === undefined) return problem(404, 'not_found');
  if (operation !== 'sessions') {
    if (ifMatch === undefined) return problem(428, 'precondition_required');
    if (ifMatch !== `"${String(user.version)}"`) return problem(412, 'version_conflict');
  }
  const activeAdministrators = server.users.filter((entry) => entry.role === 'administrator' && entry.status === 'active');
  const sole = user.role === 'administrator' && user.status === 'active' && activeAdministrators.length === 1;
  const done = (): Answer => {
    user.version += 1;
    return respond(200, user, { ETag: `"${String(user.version)}"` });
  };
  switch (operation) {
    case 'role': {
      const role = input['role'];
      if (role !== 'administrator' && role !== 'editor' && role !== 'read_only') return problem(400, 'validation_failed');
      if (user.status === 'deactivated' || user.role === role) return problem(409, 'invalid_state_transition');
      if (sole) return problem(409, 'last_active_administrator');
      if (user.id === SELF_ID) return problem(409, 'own_account_not_allowed');
      if (role === 'administrator' && !user.secondStepMethods.includes('passkey')) return problem(409, 'administrator_passkey_required');
      user.role = role;
      return done();
    }
    case 'deactivation':
      if (user.status === 'deactivated') return problem(409, 'invalid_state_transition');
      if (sole) return problem(409, 'last_active_administrator');
      if (user.id === SELF_ID) return problem(409, 'own_account_not_allowed');
      user.status = 'deactivated';
      user.invitation = null;
      return done();
    case 'reactivation':
      if (user.status !== 'deactivated') return problem(409, 'invalid_state_transition');
      if (user.activatedAt === null) {
        user.status = 'invited';
        user.invitation = { state: 'expired', sentAt: null, expiresAt: new Date(Date.now() - HOUR).toISOString() };
      } else user.status = 'active';
      return done();
    case 'sessions':
      if (user.id === SELF_ID) return problem(409, 'own_account_not_allowed');
      return { status: 204, headers: {}, body: '' };
    case 'second-step-reset':
      if (input['identityVerification'] !== 'in_person' && input['identityVerification'] !== 'video_call') {
        return problem(400, 'validation_failed');
      }
      if (user.status !== 'active') return problem(409, 'invalid_state_transition');
      if (sole) return problem(409, 'last_active_administrator');
      if (user.id === SELF_ID) return problem(409, 'own_account_not_allowed');
      user.secondStepMethods = [];
      return done();
  }
}
