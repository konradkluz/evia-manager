/**
 * The steps of the activation as the panel performs them, for the API tests: set the password, ask for the passkey
 * options, answer them with a virtual authenticator. Each helper returns the raw response so a test can assert on it.
 */
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server';
import type { Response } from 'supertest';
import type { IdentityApp } from './identity-app.ts';
import type { LinkFixture, UserFixture } from './identity-fixtures.ts';
import type { PanelClient } from './panel-client.ts';
import { VirtualAuthenticator, type RegistrationKnobs } from './virtual-authenticator.ts';

export const PASSWORD = 'Zq9-lamp-Orbit-4';
export const PATHS = {
  check: '/api/v1/auth/activation/check',
  password: '/api/v1/auth/activation/password',
  session: '/api/v1/auth/session',
  logout: '/api/v1/auth/logout',
  options: '/api/v1/account/passkeys/registration-options',
  passkeys: '/api/v1/account/passkeys',
} as const;

/** Sets the password; on success the browser keeps the session cookie and the CSRF token, as the panel does. */
export async function setPassword(panel: PanelClient, token: string, password: string = PASSWORD): Promise<Response> {
  const response = await panel.post(PATHS.password, { token, password });
  if (response.status === 200) {
    panel.adopt(response.headers['set-cookie']);
    panel.csrfToken = (response.body as { csrfToken: string }).csrfToken;
  }
  return response;
}

export async function passkeyOptions(panel: PanelClient): Promise<{ response: Response; options: PublicKeyCredentialCreationOptionsJSON }> {
  const response = await panel.post(PATHS.options);
  return { response, options: response.body as PublicKeyCredentialCreationOptionsJSON };
}

export async function registerPasskey(
  panel: PanelClient,
  options: PublicKeyCredentialCreationOptionsJSON,
  authenticator: VirtualAuthenticator = new VirtualAuthenticator(),
  knobs: RegistrationKnobs = {},
): Promise<Response> {
  const response = await panel.post(PATHS.passkeys, {
    credential: authenticator.register(options, { origin: 'https://panel.evia.test', ...knobs }),
  });
  if (response.status === 201) {
    panel.adopt(response.headers['set-cookie']);
    panel.csrfToken = undefined;
  }
  return response;
}

export interface Activation {
  readonly panel: PanelClient;
  readonly user: UserFixture;
  readonly link: LinkFixture;
  readonly authenticator: VirtualAuthenticator;
}

/** The whole happy path: pending Administrator, password, passkey; the browser ends up with an active session. */
export async function activateAdministrator(app: IdentityApp, email?: string): Promise<Activation> {
  const { user, link } = await app.pendingAdministrator(email === undefined ? {} : { email });
  const panel = app.panel();
  const password = await setPassword(panel, link.token);
  if (password.status !== 200) throw new Error(`password step failed: ${password.status}`);
  const { options } = await passkeyOptions(panel);
  const authenticator = new VirtualAuthenticator();
  const registered = await registerPasskey(panel, options, authenticator);
  if (registered.status !== 201) throw new Error(`passkey step failed: ${registered.status}`);
  const session = await panel.get(PATHS.session);
  panel.csrfToken = (session.body as { csrfToken: string }).csrfToken;
  return { panel, user, link, authenticator };
}
