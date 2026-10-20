/**
 * The steps of the own account as the panel performs them (EVM-028): the full re-authentication with a key or a code of the app, a key added or removed, the
 * change of the password, "Moje sesje". Each helper returns the raw response so a test can assert on it. Synthetic data only.
 */
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { PATHS } from './flows.ts';
import type { IdentityApp } from './identity-app.ts';
import { enrolledAccount, signIn, type EnrolledAccount } from './login-flows.ts';
import type { PanelClient } from './panel-client.ts';
import { stepUpOptions } from './step-up-flows.ts';
import { codeNow, signInWithTotp, totpAccount, type TotpAccount } from './totp-flows.ts';
import { VirtualAuthenticator } from './virtual-authenticator.ts';

export const ACCOUNT = {
  account: '/api/v1/account',
  reauth: '/api/v1/account/reauthentication',
  password: '/api/v1/account/password',
  passkeys: '/api/v1/account/passkeys',
  passkeyOptions: '/api/v1/account/passkeys/registration-options',
  totp: '/api/v1/account/totp',
  totpEnrolment: '/api/v1/account/totp/enrolment',
  totpConfirm: '/api/v1/account/totp/confirm',
  recoveryCodes: '/api/v1/account/recovery-codes',
  sessions: '/api/v1/account/sessions',
  assignable: '/api/v1/users/assignable',
} as const;

export const NEW_PASSWORD = 'a fresh phrase for the new password';
export type Purpose = 'second_step_change' | 'password_change';

/** An Administrator or an Editor who has signed in with a passkey a moment ago (the window of the step-up is open). */
export async function signedInWithKey(
  app: IdentityApp,
  role: 'administrator' | 'editor' | 'read_only' = 'administrator',
): Promise<EnrolledAccount> {
  const account = await enrolledAccount(app, { role });
  const response = await signIn(account.panel, account);
  if (response.status !== 200) throw new Error(`sign-in failed: ${response.status}`);
  return account;
}

/** An Editor (or a Read-only user) who has signed in with a code of the app a moment ago. */
export async function signedInWithCode(
  app: IdentityApp,
  role: 'editor' | 'read_only' = 'editor',
): Promise<TotpAccount & { session: PanelClient }> {
  const account = await totpAccount(app, { role, withCodes: true });
  const { panel, response } = await signInWithTotp(app, account);
  if (response.status !== 200) throw new Error(`sign-in with a code failed: ${response.status}`);
  return { ...account, session: panel };
}

/** The proof of a passkey: options, then the assertion. */
export async function keyProof(panel: PanelClient, authenticator: VirtualAuthenticator): Promise<{ credential: unknown }> {
  const { response, options } = await stepUpOptions(panel);
  if (response.status !== 200) throw new Error(`step-up options failed: ${response.status}`);
  return { credential: authenticator.assert(options) };
}

/** The full re-authentication with a key (`password` only for `second_step_change`). */
export async function reauthWithKey(
  panel: PanelClient,
  authenticator: VirtualAuthenticator,
  purpose: Purpose,
  password?: string,
): Promise<Response> {
  const proof = await keyProof(panel, authenticator);
  return Promise.resolve(panel.post(ACCOUNT.reauth, { purpose, ...(password === undefined ? {} : { password }), ...proof }));
}

/** The full re-authentication with a code of the app. */
export function reauthWithCode(panel: PanelClient, purpose: Purpose, code: string, password?: string): Promise<Response> {
  return Promise.resolve(panel.post(ACCOUNT.reauth, { purpose, ...(password === undefined ? {} : { password }), method: 'totp', code }));
}

/** A key added from the account: the options and the registration of a (new) virtual authenticator; the browser keeps its session as it is. */
export async function addKey(
  panel: PanelClient,
  name?: string,
  authenticator: VirtualAuthenticator = new VirtualAuthenticator(),
): Promise<{ options: Response; registered: Response | undefined; authenticator: VirtualAuthenticator }> {
  const options = await panel.post(ACCOUNT.passkeyOptions);
  if (options.status !== 200) return { options, registered: undefined, authenticator };
  const credential = authenticator.register(options.body as PublicKeyCredentialCreationOptionsJSON, { origin: 'https://panel.evia.test' });
  const registered = await panel.post(ACCOUNT.passkeys, { credential, ...(name === undefined ? {} : { name }) });
  return { options, registered, authenticator };
}

export async function getAccount(panel: PanelClient): Promise<Response> {
  return Promise.resolve(panel.get(ACCOUNT.account));
}

/** The rows of the outbox for an account, oldest first. */
export async function outboxOf(app: IdentityApp, userId: string, kind?: string): Promise<Array<{ kind: string; variant: string | null }>> {
  const { rows } = await sql<{ kind: string; variant: string | null }>`
    select kind, variant from platform.email_outbox where recipient_user_id = ${userId} ${kind === undefined ? sql`` : sql`and kind = ${kind}`}
    order by created_at, id`.execute(app.database.admin);
  return rows;
}

/** The audit events of an action (oldest first), with the columns a test cares about. */
export async function auditOf(
  app: IdentityApp,
  action: string,
): Promise<Array<{ outcome: string; reason_code: string | null; actor_user_id: string | null; object_id: string | null }>> {
  const { rows } = await sql<{ outcome: string; reason_code: string | null; actor_user_id: string | null; object_id: string | null }>`
    select outcome, reason_code, actor_user_id, object_id from audit.events where action = ${action} order by occurred_at, id`.execute(
    app.database.admin,
  );
  return rows;
}

/** The body of a problem without the identifier of the trace — to compare two answers that must be the same. */
export function withoutTrace(body: unknown): Record<string, unknown> {
  const copy = { ...(body as Record<string, unknown>) };
  delete copy['traceId'];
  return copy;
}

export { codeNow, PATHS };
