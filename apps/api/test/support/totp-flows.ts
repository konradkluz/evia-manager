/**
 * The steps of a code from an authenticator app as the panel performs them (EVM-023): the setup and the confirmation of the activation flow, the codes an app
 * would show (computed here with the same library and the clock of the app under test — never a fixed code), the second step of a sign-in and the recovery
 * codes. Each helper returns the raw response so a test can assert on it. Synthetic data only.
 */
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { Secret, TOTP } from 'otpauth';
import type { Response } from 'supertest';
import type { FieldEncryption } from '../../src/platform/crypto/field-encryption.ts';
import { FIELD_ENCRYPTION } from '../../src/platform/tokens.ts';
import { totpSecretContext } from '../../src/modules/identity/domain/totp.ts';
import { PASSWORD, setPassword } from './flows.ts';
import type { IdentityApp } from './identity-app.ts';
import { createLink, createUser, type Role, type UserFixture } from './identity-fixtures.ts';
import { adopt, firstStep, type EnrolledAccount } from './login-flows.ts';
import type { PanelClient } from './panel-client.ts';

export const SECOND_STEP = {
  setup: '/api/v1/account/totp/enrolment',
  confirm: '/api/v1/account/totp/confirm',
  recoveryCodes: '/api/v1/account/recovery-codes',
  loginTotp: '/api/v1/auth/login/totp',
  loginRecoveryCode: '/api/v1/auth/login/recovery-code',
  stepUp: '/api/v1/auth/step-up',
} as const;

const STEP_MS = 30_000;

/** The code an authenticator app shows for `secret` at `at` (`steps`: the app's clock is that many 30-second steps ahead; negative — behind). */
export function totpCode(secretBase32: string, at: Date, steps: number = 0): string {
  const totp = new TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secretBase32) });
  return totp.generate({ timestamp: at.getTime() + steps * STEP_MS });
}

/** The code for the clock of the app under test. */
export const codeNow = (app: IdentityApp, secret: string, steps: number = 0): string => totpCode(secret, app.clock.now(), steps);

/** Moves the clock into the next 30-second step AND the next minute (the per-address limits start a new window). */
export const nextStep = (app: IdentityApp): void => {
  app.clock.advance(61_000);
};

export interface TotpAccount {
  readonly user: UserFixture;
  readonly email: string;
  readonly password: string;
  /** The key to type in (base32), as W-03 shows it. */
  readonly secret: string;
  /** The browser that enrolled: it holds the `active` session that the confirmation created. */
  readonly panel: PanelClient;
  readonly confirmed: Response;
  /** The ten recovery codes of the third step (empty unless `withCodes`). */
  readonly codes: string[];
}

/**
 * An account with a password and an ACTIVE code of the app, made through the real activation (link → password → setup → confirmation) and — with
 * `withCodes` — the ten recovery codes of the third step, generated in the session of the confirmation. The clock moves on afterwards.
 */
export async function totpAccount(
  app: IdentityApp,
  options: { role?: Role; email?: string; password?: string; withCodes?: boolean } = {},
): Promise<TotpAccount> {
  const role = options.role ?? 'editor';
  const password = options.password ?? PASSWORD;
  const user = await createUser(app.database.admin, app.clock, {
    role,
    status: 'invited',
    ...(options.email === undefined ? {} : { email: options.email }),
  });
  const link = await createLink(app.database.admin, app.clock, user.id);
  const panel = app.panel();
  const activated = await setPassword(panel, link.token, password);
  if (activated.status !== 200) throw new Error(`password step failed: ${activated.status}`);
  const setup = await panel.post(SECOND_STEP.setup);
  if (setup.status !== 200) throw new Error(`setup failed: ${setup.status}`);
  const { secret } = setup.body as { secret: string };
  const confirmed = await confirmTotp(panel, codeNow(app, secret));
  if (confirmed.status !== 200) throw new Error(`confirmation failed: ${confirmed.status}`);
  let codes: string[] = [];
  if (options.withCodes === true) {
    const generated = await generateCodes(panel);
    if (generated.response.status !== 200) throw new Error(`recovery codes failed: ${generated.response.status}`);
    codes = generated.codes;
  }
  nextStep(app);
  return { user, email: user.email, password, secret, panel, confirmed, codes };
}

/** The confirmation of the setup; on success the browser adopts the new session. */
export async function confirmTotp(panel: PanelClient, code: string): Promise<Response> {
  const response = await panel.post(SECOND_STEP.confirm, { code });
  if (response.status === 200) adopt(panel, response);
  return response;
}

/** The first step of a sign-in; @returns the `loginToken` of the answer. */
export async function startLogin(panel: PanelClient, account: Pick<TotpAccount, 'email' | 'password'>): Promise<string> {
  const response = await firstStep(panel, account.email, account.password);
  const body = response.body as { loginToken?: string };
  if (response.status !== 200 || body.loginToken === undefined) throw new Error(`first step gave no loginToken: ${response.status}`);
  return body.loginToken;
}

export const sendLoginTotp = (panel: PanelClient, loginToken: string, code: string): Promise<Response> =>
  Promise.resolve(panel.post(SECOND_STEP.loginTotp, { loginToken, code }));

export const sendLoginRecoveryCode = (panel: PanelClient, loginToken: string, code: string): Promise<Response> =>
  Promise.resolve(panel.post(SECOND_STEP.loginRecoveryCode, { loginToken, code }));

/** The sign-in with a code of the app: a fresh browser, both steps; the browser ends up with the new session when it succeeds. */
export async function signInWithTotp(
  app: IdentityApp,
  account: TotpAccount,
  steps: number = 0,
): Promise<{ panel: PanelClient; response: Response }> {
  const panel = app.panel();
  const loginToken = await startLogin(panel, account);
  const response = await sendLoginTotp(panel, loginToken, codeNow(app, account.secret, steps));
  if (response.status === 200) adopt(panel, response);
  return { panel, response };
}

/** The recovery codes of the third step: the browser must hold a session with a fresh authentication. @returns the ten codes (or the failed response) */
export async function generateCodes(panel: PanelClient): Promise<{ response: Response; codes: string[] }> {
  const response = await panel.post(SECOND_STEP.recoveryCodes);
  return { response, codes: response.status === 200 ? (response.body as { codes: string[] }).codes : [] };
}

/** Writes an ACTIVE TOTP factor straight into the database for an account that exists (the sealed secret is made with the key of the app under test). */
export async function insertTotpFactor(
  app: IdentityApp,
  userId: string,
  options: { state?: 'pending' | 'active'; secret?: Buffer } = {},
): Promise<{ secret: string }> {
  const encryption = app.app.get<FieldEncryption>(FIELD_ENCRYPTION, { strict: false });
  const raw = options.secret ?? Buffer.from(Array.from({ length: 20 }, (_, index) => index + 1));
  const secret = new Secret({ buffer: new Uint8Array(raw).buffer }).base32;
  const state = options.state ?? 'active';
  const sealed = encryption.encrypt(raw, totpSecretContext(userId));
  const now = app.clock.now();
  await sql`
    insert into identity.totp_factors (user_id, secret_ciphertext, state, created_at, confirmed_at)
    values (${userId}, ${sealed}, ${state}, ${now}, ${state === 'active' ? now : null})`.execute(app.database.admin);
  return { secret };
}

/** The enrolled-with-passkey account of `login-flows` gets an active code of the app too. */
export async function addTotp(app: IdentityApp, account: EnrolledAccount): Promise<string> {
  return (await insertTotpFactor(app, account.user.id)).secret;
}

/** Keeps the audit trail, the outbox and the log of a test comparable: the SHA-256 of a text, so a test can ask "is this value anywhere" without printing it. */
export const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

/** Everything the story writes down about the second step, as one text — to prove that a secret or a code is nowhere in it. */
export async function everythingWritten(app: IdentityApp): Promise<string> {
  const queries = [
    sql<{ row: string }>`select to_jsonb(t)::text as row from audit.events t`,
    sql<{ row: string }>`select to_jsonb(t)::text as row from platform.email_outbox t`,
    sql<{ row: string }>`select to_jsonb(t)::text as row from platform.security_alert_outbox t`,
    sql<{ row: string }>`select to_jsonb(t)::text as row from identity.login_attempts t`,
  ];
  const parts: string[] = [];
  for (const query of queries) parts.push(...(await query.execute(app.database.admin)).rows.map((row) => row.row));
  return parts.join('\n');
}
