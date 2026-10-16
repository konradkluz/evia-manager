/**
 * Helpers of the tests of the password reset (EVM-025): the paths, a request for a link as the panel sends it, the worker delivering the
 * message (a fake of the port) and the token the person finds in the mail. Synthetic data only (`*.example.com`).
 */
import type { Response } from 'supertest';
import { InMemoryEmailSender } from '../../src/platform/email/in-memory-email-sender.ts';
import type { IdentityApp } from './identity-app.ts';
import { emailHarness, linkIn, outboxRows, type Harness } from './invitation-fixtures.ts';
import type { EnrolledAccount } from './login-flows.ts';
import type { PanelClient } from './panel-client.ts';

export const RESET = {
  request: '/api/v1/auth/password-reset/request',
  check: '/api/v1/auth/password-reset/check',
  complete: '/api/v1/auth/password-reset/complete',
} as const;

/** A new password that passes every rule (synthetic). */
export const NEW_PASSWORD = 'meadow lantern copper river 2026';

export const requestReset = (panel: PanelClient, email: string): Promise<Response> => Promise.resolve(panel.post(RESET.request, { email }));

export interface DeliveredReset {
  readonly token: string;
  readonly text: string;
  readonly harness: Harness;
}

/** Asks for a link as the person does and lets the worker send the pending message; @throws when no message was sent. */
export async function deliverReset(
  app: IdentityApp,
  account: EnrolledAccount,
  harness: Harness = emailHarness(app),
): Promise<DeliveredReset> {
  const response = await requestReset(app.panel(), account.email);
  if (response.status !== 202) throw new Error(`request failed: ${response.status}`);
  return processPending(app, account.user.id, harness);
}

/** Lets the worker send the pending `password_reset` message of the account and reads the link from the mail it sent. */
export async function processPending(app: IdentityApp, userId: string, harness: Harness): Promise<DeliveredReset> {
  const rows = (await outboxRows(app, { recipient: userId, kind: 'password_reset' })).filter((row) => row.state === 'pending');
  await harness.job.run({ ids: rows.map((row) => row.id) });
  const text = harness.sender.sent.at(-1)?.text ?? '';
  return { token: linkIn(text).token, text, harness };
}

export const freshHarness = (app: IdentityApp): Harness => emailHarness(app, new InMemoryEmailSender());
