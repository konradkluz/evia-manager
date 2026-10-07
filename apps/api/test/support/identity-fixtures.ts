/**
 * Synthetic accounts, sessions and links written straight into the database (EVM-016 AC8): the roles Administrator,
 * Editor and Read-only, the channels web and mobile, and sessions in either state. There is no code path in the API that
 * creates a `mobile` session in M1 — only these fixtures do (SR-AUTHZ-12). Addresses use the reserved `.invalid` TLD.
 */
import { randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import { SESSION_COOKIE_NAME } from '../../src/modules/identity/domain/constants.ts';
import { deriveCsrfToken, hashToken, newToken } from '../../src/modules/identity/domain/tokens.ts';
import { identityTables } from '../../src/modules/identity/infrastructure/tables.ts';
import type { Database } from '../../src/platform/database/database.ts';
import type { Clock } from '../../src/platform/clock/clock.ts';

export type Role = 'administrator' | 'editor' | 'read_only';

export interface UserFixture {
  readonly id: string;
  readonly email: string;
  readonly role: Role;
}

let counter = 0;

export async function createUser(
  db: Kysely<Database>,
  clock: Clock,
  options: { role?: Role; status?: 'invited' | 'active' | 'deactivated'; email?: string; displayName?: string } = {},
): Promise<UserFixture> {
  counter += 1;
  const role = options.role ?? 'administrator';
  const email = options.email ?? `${role.replace('_', '-')}-${counter}@evia.invalid`;
  const now = clock.now();
  const row = await identityTables(db)
    .insertInto('identity.users')
    .values({
      email,
      display_name: options.displayName ?? `Użytkownik ${counter}`,
      role,
      status: options.status ?? 'active',
      webauthn_user_handle: randomBytes(32),
      last_login_at: null,
      deactivated_at: null,
      created_at: now,
      created_by: null,
      updated_at: now,
      updated_by: null,
      deleted_at: null,
      deleted_by: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { id: row.id, email, role };
}

export interface LinkFixture {
  readonly id: string;
  readonly token: string;
}

/** An unused activation link of the account, valid for `ttlMs` from now (default 72 hours). */
export async function createLink(
  db: Kysely<Database>,
  clock: Clock,
  userId: string,
  options: { ttlMs?: number; issuedAt?: Date } = {},
): Promise<LinkFixture> {
  const token = newToken();
  const issuedAt = options.issuedAt ?? clock.now();
  const row = await identityTables(db)
    .insertInto('identity.one_time_links')
    .values({
      user_id: userId,
      purpose: 'account_activation',
      token_hash: hashToken(token),
      issued_by: 'cli',
      issued_at: issuedAt,
      expires_at: new Date(issuedAt.getTime() + (options.ttlMs ?? 72 * 3_600_000)),
      used_at: null,
      superseded_at: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { id: row.id, token };
}

export interface SessionFixture {
  readonly id: string;
  readonly token: string;
  /** The `Cookie` header of the browser. */
  readonly cookie: string;
  readonly csrfToken: string;
}

export async function createSession(
  db: Kysely<Database>,
  clock: Clock,
  user: UserFixture,
  options: {
    channel?: 'web' | 'mobile';
    state?: 'mfa_enrollment' | 'active';
    linkId?: string;
    /** The last authentication with a passkey of this session (default: none — a session of a password, activation or recovery code). */
    passkeyAuthenticatedAt?: Date | null;
  } = {},
): Promise<SessionFixture> {
  const token = newToken();
  const now = clock.now();
  const row = await identityTables(db)
    .insertInto('identity.sessions')
    .values({
      user_id: user.id,
      channel: options.channel ?? 'web',
      state: options.state ?? 'active',
      token_hash: hashToken(token),
      one_time_link_id: options.linkId ?? null,
      created_at: now,
      last_seen_at: now,
      last_authenticated_at: now,
      passkey_authenticated_at: options.passkeyAuthenticatedAt ?? null,
      idle_expires_at: new Date(now.getTime() + 3_600_000),
      absolute_expires_at: new Date(now.getTime() + 12 * 3_600_000),
      revoked_at: null,
      revoke_reason: null,
      ip_address: null,
      user_agent: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { id: row.id, token, cookie: `${SESSION_COOKIE_NAME}=${token}`, csrfToken: deriveCsrfToken(token) };
}

/** A passkey of the account written straight into the database (a synthetic public key — it never verifies anything). */
export async function createPasskey(db: Kysely<Database>, clock: Clock, user: UserFixture): Promise<void> {
  await identityTables(db)
    .insertInto('identity.passkeys')
    .values({
      user_id: user.id,
      credential_id: randomBytes(32).toString('base64url'),
      public_key: randomBytes(77),
      counter: 0,
      transports: ['internal'],
      device_type: 'multi_device',
      backed_up: true,
      created_at: clock.now(),
      last_used_at: null,
    })
    .execute();
}
