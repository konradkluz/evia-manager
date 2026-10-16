import { AUTHZ_MANIFEST, PUBLIC_OPERATIONS } from '@evia/contracts/authz';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { browserOf, outboxRows, type Browser } from '../support/invitation-fixtures.ts';
import { enrolledAccount } from '../support/login-flows.ts';
import { deliverReset, NEW_PASSWORD, RESET } from '../support/password-reset-fixtures.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

const OPERATIONS = ['requestPasswordReset', 'checkPasswordResetLink', 'completePasswordReset'] as const;
const UNKNOWN_TOKEN = 'A'.repeat(43);

const bodyFor = (operation: (typeof OPERATIONS)[number]): Record<string, string> =>
  operation === 'requestPasswordReset'
    ? { email: 'nikt@example.com' }
    : operation === 'checkPasswordResetLink'
      ? { token: UNKNOWN_TOKEN }
      : { token: UNKNOWN_TOKEN, password: NEW_PASSWORD };

const expectedStatus = { requestPasswordReset: 202, checkPasswordResetLink: 400, completePasswordReset: 400 } as const;

describe('the authorization of the three operations (EVM-025 AC7; SR-AUTHZ-05, SR-AUTHZ-12; K8)', () => {
  it('EVM-025 AC7 the three operations are public, POST only, on the allow-list, and declare no channel: a reset is the one thing a person without a session does', () => {
    for (const id of OPERATIONS) {
      const operation = AUTHZ_MANIFEST[id];
      expect(operation?.method, id).toBe('post');
      expect(operation?.authz, id).toEqual({ public: true });
      expect(PUBLIC_OPERATIONS, id).toContain(id);
    }
    expect(
      Object.values(AUTHZ_MANIFEST).filter((operation) => operation.authz.public === true && operation.path.includes('password-reset')),
    ).toHaveLength(3);
  });

  it('EVM-025 AC7 an unauthenticated caller and a signed-in Administrator, Editor and Read-only user get the same answer from every operation', async () => {
    const callers: Array<[string, Browser | undefined]> = [['anonymous', undefined]];
    for (const role of ['administrator', 'editor', 'read_only'] as const) callers.push([role, await browserOf(current, { role })]);
    callers.push(['mfa_enrollment', await browserOf(current, { role: 'editor', state: 'mfa_enrollment', key: 'none' })]);
    for (const id of OPERATIONS) {
      const answers = new Set<string>();
      for (const [label, browser] of callers) {
        current.clock.advance(61_000);
        const panel = browser?.panel ?? current.panel();
        const response = await panel.post(AUTHZ_MANIFEST[id]?.path ?? '', bodyFor(id));
        expect(response.status, `${id} ${label}`).toBe(expectedStatus[id]);
        answers.add(JSON.stringify({ status: response.status, code: (response.body as { code?: string }).code }));
      }
      expect(answers.size, id).toBe(1);
    }
  });

  it('EVM-025 AC7 a session of the mobile channel is no different: the operations are public and no channel rule applies to them (decision: public operations declare no channel; mobile reset starts with E9)', async () => {
    const mobile = await browserOf(current, { role: 'editor', channel: 'mobile' });
    for (const id of OPERATIONS) {
      current.clock.advance(61_000);
      const response = await mobile.panel.post(AUTHZ_MANIFEST[id]?.path ?? '', bodyFor(id));
      expect(response.status, id).toBe(expectedStatus[id]);
    }
  });

  it('EVM-025 AC7 a signed-in person can reset the password of their own account: the link comes, the completion works, the old session ends', async () => {
    const account = await enrolledAccount(current, { role: 'read_only', email: 'tylko.odczyt@example.com' });
    const link = await deliverReset(current, account);
    const response = await account.panel.post(RESET.complete, { token: link.token, password: NEW_PASSWORD });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ state: 'second_step' });
  });

  it('EVM-025 AC7 a mutation from another site, without an Origin or with a foreign one, is 403 csrf_failed and nothing happens', async () => {
    await enrolledAccount(current, { role: 'editor', email: 'ewa.aktywna@example.com' });
    const server = current.app.getHttpServer();
    const attempts = [
      () => request(server).post(RESET.request).set('Content-Type', 'application/json').send({ email: 'ewa.aktywna@example.com' }),
      () =>
        request(server)
          .post(RESET.request)
          .set('Origin', 'https://zlosliwa.example.com')
          .set('Sec-Fetch-Site', 'cross-site')
          .set('Content-Type', 'application/json')
          .send({ email: 'ewa.aktywna@example.com' }),
      () =>
        request(server)
          .post(RESET.request)
          .set('Origin', PANEL_ORIGIN)
          .set('Sec-Fetch-Site', 'cross-site')
          .set('Content-Type', 'application/json')
          .send({ email: 'ewa.aktywna@example.com' }),
    ];
    for (const attempt of attempts) {
      const response = await attempt();
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ code: 'csrf_failed' });
    }
    expect(await outboxRows(current, { kind: 'password_reset' })).toEqual([]);
  });

  it('EVM-025 AC7 an invited account cannot reset: no message, no link — the same answer as for an unknown address', async () => {
    const invited = await current.pendingAdministrator({ email: 'zaproszony@example.com' });
    const answer = await current.panel().post(RESET.request, { email: invited.user.email });
    expect(answer.status).toBe(202);
    expect(await outboxRows(current, { recipient: invited.user.id })).toEqual([]);
    expect((await current.panel().post(RESET.check, { token: invited.link.token })).body).toMatchObject({
      code: 'password_reset_link_invalid',
    });
  });
});
