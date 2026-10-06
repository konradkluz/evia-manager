/**
 * The steps of the sign-in as the panel performs them (EVM-067): accounts that are fully enrolled (password and passkey,
 * through the real activation), the first step, the options, the assertion of a virtual authenticator. Each helper returns
 * the raw response so a test can assert on it. Synthetic data only.
 */
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server';
import type { Response } from 'supertest';
import { PASSWORD, PATHS, passkeyOptions, registerPasskey, setPassword } from './flows.ts';
import type { IdentityApp } from './identity-app.ts';
import { createLink, createUser, type Role, type UserFixture } from './identity-fixtures.ts';
import type { PanelClient } from './panel-client.ts';
import { VirtualAuthenticator, type AssertionKnobs } from './virtual-authenticator.ts';

export const LOGIN = {
  login: '/api/v1/auth/login',
  options: '/api/v1/auth/login/passkey/options',
  passkey: '/api/v1/auth/login/passkey',
  extend: '/api/v1/auth/session/extend',
} as const;

export { PASSWORD };

export interface EnrolledAccount {
  readonly user: UserFixture;
  readonly email: string;
  readonly password: string;
  readonly authenticator: VirtualAuthenticator;
  /** The browser that enrolled: it still holds the (active) session of the activation. */
  readonly panel: PanelClient;
}

/**
 * An active account with a password and one passkey, created through the activation flow of EVM-016. The clock is moved by
 * one minute afterwards, so the per-IP limits start a fresh window for the scenario.
 */
export async function enrolledAccount(
  app: IdentityApp,
  options: { role?: Role; email?: string; password?: string } = {},
): Promise<EnrolledAccount> {
  const role = options.role ?? 'administrator';
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
  const { options: registration } = await passkeyOptions(panel);
  const authenticator = new VirtualAuthenticator();
  const registered = await registerPasskey(panel, registration, authenticator);
  if (registered.status !== 201) throw new Error(`passkey step failed: ${registered.status}`);
  const session = await panel.get(PATHS.session);
  panel.csrfToken = (session.body as { csrfToken: string }).csrfToken;
  app.clock.advance(61_000);
  return { user, email: user.email, password, authenticator, panel };
}

/** First step. */
export const firstStep = (panel: PanelClient, email: string, password: string): Promise<Response> =>
  Promise.resolve(panel.post(LOGIN.login, { email, password }));

/** The second step's options for a `loginToken`. */
export async function loginOptions(
  panel: PanelClient,
  loginToken: string,
): Promise<{ response: Response; options: PublicKeyCredentialRequestOptionsJSON }> {
  const response = await panel.post(LOGIN.options, { loginToken });
  return { response, options: response.body as PublicKeyCredentialRequestOptionsJSON };
}

/** The assertion of the authenticator for the options, sent to the second step. */
export function secondStep(
  panel: PanelClient,
  loginToken: string,
  authenticator: VirtualAuthenticator,
  options: PublicKeyCredentialRequestOptionsJSON,
  knobs: AssertionKnobs = {},
): Promise<Response> {
  return Promise.resolve(panel.post(LOGIN.passkey, { loginToken, credential: authenticator.assert(options, knobs) }));
}

/** The browser adopts a successful session like the panel does (cookie and CSRF token). */
export function adopt(panel: PanelClient, response: Response): void {
  panel.adopt(response.headers['set-cookie']);
  panel.csrfToken = (response.body as { csrfToken?: string }).csrfToken;
}

/** Both steps with the right password and key; the browser ends up with the new session. */
export async function signIn(panel: PanelClient, account: EnrolledAccount): Promise<Response> {
  const step1 = await firstStep(panel, account.email, account.password);
  if (step1.status !== 200) throw new Error(`first step failed: ${step1.status}`);
  const { loginToken } = step1.body as { loginToken: string };
  const { options } = await loginOptions(panel, loginToken);
  const step2 = await secondStep(panel, loginToken, account.authenticator, options);
  if (step2.status === 200) adopt(panel, step2);
  return step2;
}
