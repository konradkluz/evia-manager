/**
 * The steps of a step-up as the panel performs them (EVM-029): the options, the assertion of a virtual authenticator, the
 * adoption of the new session. Each helper returns the raw response so a test can assert on it. Synthetic data only.
 */
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server';
import type { Response } from 'supertest';
import type { Role } from './identity-fixtures.ts';
import { adopt, enrolledAccount, signIn, type EnrolledAccount } from './login-flows.ts';
import type { IdentityApp } from './identity-app.ts';
import type { PanelClient } from './panel-client.ts';
import type { AssertionKnobs, VirtualAuthenticator } from './virtual-authenticator.ts';

export const STEP_UP = {
  options: '/api/v1/auth/step-up/options',
  verify: '/api/v1/auth/step-up',
  audit: '/api/v1/audit/events',
} as const;

/** Options of a step-up for the session of the browser. */
export async function stepUpOptions(panel: PanelClient): Promise<{ response: Response; options: PublicKeyCredentialRequestOptionsJSON }> {
  const response = await panel.post(STEP_UP.options);
  return { response, options: response.body as PublicKeyCredentialRequestOptionsJSON };
}

/** The assertion of the authenticator for the options, sent to the step-up. */
export function sendStepUp(
  panel: PanelClient,
  authenticator: VirtualAuthenticator,
  options: PublicKeyCredentialRequestOptionsJSON,
  knobs: AssertionKnobs = {},
): Promise<Response> {
  return Promise.resolve(panel.post(STEP_UP.verify, { credential: authenticator.assert(options, knobs) }));
}

/** Options and assertion; on success the browser adopts the new session (cookie and CSRF token), as the panel does. */
export async function stepUp(panel: PanelClient, authenticator: VirtualAuthenticator): Promise<Response> {
  const { response, options } = await stepUpOptions(panel);
  if (response.status !== 200) throw new Error(`step-up options failed: ${response.status}`);
  const result = await sendStepUp(panel, authenticator, options);
  if (result.status === 200) adopt(panel, result);
  return result;
}

/**
 * An Administrator who has just signed in with the key — the window of the step-up is open (`passkey_authenticated_at` = now).
 * The account is enrolled through the real activation first (that session has no passkey authentication).
 */
export async function signedInAdministrator(app: IdentityApp, options: { role?: Role; email?: string } = {}): Promise<EnrolledAccount> {
  const account = await enrolledAccount(app, { role: 'administrator', ...options });
  const response = await signIn(account.panel, account);
  if (response.status !== 200) throw new Error(`sign-in failed: ${response.status}`);
  return account;
}

export const MINUTES = (count: number): number => count * 60_000;
