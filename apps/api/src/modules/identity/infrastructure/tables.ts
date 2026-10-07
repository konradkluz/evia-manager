/**
 * Kysely types of the tables the `identity` module owns (EVM-016 W12). `platform` does not know module tables: the
 * module narrows a handle with `db.withTables<IdentityTables>()`. Column names are the database names (snake_case);
 * mapping to the domain happens in the queries of this module.
 */
import type { ColumnType, Generated, Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';

export interface UsersTable {
  id: Generated<string>;
  email: string;
  display_name: string;
  role: 'administrator' | 'editor' | 'read_only';
  status: 'invited' | 'active' | 'deactivated';
  webauthn_user_handle: Buffer;
  last_login_at: Date | null;
  deactivated_at: Date | null;
  created_at: Date;
  created_by: string | null;
  updated_at: Date;
  updated_by: string | null;
  version: Generated<number>;
  deleted_at: Date | null;
  deleted_by: string | null;
}

export interface PasswordCredentialsTable {
  user_id: string;
  password_hash: string;
  updated_at: Date;
}

export interface PasskeysTable {
  id: Generated<string>;
  user_id: string;
  credential_id: string;
  public_key: Buffer;
  /** bigint: the driver returns text. */
  counter: ColumnType<string, number, number>;
  transports: Generated<string[]>;
  device_type: 'single_device' | 'multi_device';
  backed_up: boolean;
  created_at: Date;
  last_used_at: Date | null;
}

export interface OneTimeLinksTable {
  id: Generated<string>;
  user_id: string;
  purpose: 'account_activation';
  token_hash: Buffer;
  issued_by: 'cli';
  issued_at: Date;
  expires_at: Date;
  used_at: Date | null;
  superseded_at: Date | null;
}

export type RevokeReason = 'logout' | 'rotated' | 'emergency_reset' | 'link_superseded' | 'expired';

export interface SessionsTable {
  id: Generated<string>;
  user_id: string;
  channel: 'web' | 'mobile';
  state: 'mfa_enrollment' | 'active';
  token_hash: Buffer;
  one_time_link_id: string | null;
  created_at: Date;
  last_seen_at: Date;
  last_authenticated_at: Date;
  /** The last authentication with a passkey in this session (sign-in with a key, step-up); null for every other origin of a session (0009). */
  passkey_authenticated_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  idle_expires_at: Date;
  absolute_expires_at: Date;
  revoked_at: Date | null;
  revoke_reason: RevokeReason | null;
  ip_address: string | null;
  user_agent: string | null;
}

/** The first step of a sign-in waiting for the second one (EVM-067). No address and no user agent are stored (RODO). */
export interface LoginAttemptsTable {
  id: Generated<string>;
  user_id: string;
  token_hash: Buffer;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
  failed_attempts: Generated<number>;
}

/** Exactly one of `session_id` (enrolment, step-up) and `login_attempt_id` (sign-in) is set, matching the purpose — a CHECK of the database. */
export interface WebauthnChallengesTable {
  id: Generated<string>;
  user_id: string;
  session_id: string | null;
  login_attempt_id: string | null;
  purpose: 'passkey_registration' | 'passkey_authentication' | 'passkey_step_up';
  challenge_hash: Buffer;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
}

export type IdentityTables = {
  'identity.users': UsersTable;
  'identity.password_credentials': PasswordCredentialsTable;
  'identity.passkeys': PasskeysTable;
  'identity.one_time_links': OneTimeLinksTable;
  'identity.sessions': SessionsTable;
  'identity.webauthn_challenges': WebauthnChallengesTable;
  'identity.login_attempts': LoginAttemptsTable;
};

/** A handle (pool or transaction) narrowed to the identity tables. */
export type IdentityDb = Kysely<IdentityTables>;

export const identityTables = (db: Kysely<Database>): IdentityDb => db.$extendTables<IdentityTables>();
