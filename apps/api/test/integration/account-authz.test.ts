import { AUTHZ_MANIFEST, MFA_ENROLLMENT_OPERATIONS, PUBLIC_OPERATIONS } from '@evia/contracts/authz';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AUTHENTICATION_OPERATIONS } from '../../src/modules/authorization/index.ts';
import { buildMatrix, runMatrix } from '../authorization/role-matrix.ts';
import { ACCOUNT, signedInWithKey } from '../support/account-flows.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser } from '../support/identity-fixtures.ts';
import { matrixObjects } from '../support/matrix-objects.ts';
import { PanelClient } from '../support/panel-client.ts';
import { PANEL_ORIGIN } from '../support/app.ts';

let current: IdentityApp | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});
beforeEach(async () => {
  current = await createIdentityApp();
});

const lists = { publicOperations: PUBLIC_OPERATIONS, mfaEnrollmentOperations: MFA_ENROLLMENT_OPERATIONS };
/** The operations of the own account (EVM-028 K6): every role, the web channel, a session in the `active` state only. */
const ACCOUNT_OPERATIONS = [
  'getAccount',
  'updateAccount',
  'reauthenticate',
  'changePassword',
  'removePasskey',
  'removeTotp',
  'listAccountSessions',
  'endAccountSession',
  'endOtherAccountSessions',
] as const;
const STEP_UP_OPERATIONS = ['listAccountSessions', 'endAccountSession', 'endOtherAccountSessions'];

describe('the authorization of the own account (EVM-028 AC8; SR-AUTHZ-05, SR-AUTHZ-12; ASVS V8.2.1, V8.2.2)', () => {
  it('EVM-028 AC8 K6 the contract says it: every role, the web channel only, never during the enrolment; the sessions ask for a step-up; the writes are audited', () => {
    for (const id of ACCOUNT_OPERATIONS) {
      const authz = AUTHZ_MANIFEST[id]?.authz;
      expect(authz?.roles, id).toEqual(['administrator', 'editor', 'read_only']);
      expect(authz?.channels, id).toEqual(['web']);
      expect(authz?.allowDuringMfaEnrollment === true, id).toBe(false);
      expect(MFA_ENROLLMENT_OPERATIONS, id).not.toContain(id);
      expect(authz?.stepUp === true, id).toBe(STEP_UP_OPERATIONS.includes(id));
      expect(authz?.audit === true, id).toBe(AUTHZ_MANIFEST[id]?.method !== 'get');
    }
  });

  it('EVM-028 K1 the re-authentication and the change of the password share the bucket of 20 a minute per address with the sign-in: the 21st is 429 with Retry-After', () => {
    for (const id of ['reauthenticate', 'changePassword', 'login', 'stepUp']) expect(AUTHENTICATION_OPERATIONS, id).toContain(id);
  });

  it('EVM-028 K1 21 requests of the re-authentication in one minute: the 21st is 429 rate_limited with Retry-After, whoever sends them', async () => {
    const app = current as IdentityApp;
    const admin = await signedInWithKey(app);
    app.clock.advance(61_000); // the sign-in above has used some of the bucket
    let last = 0;
    let retryAfter: string | undefined;
    for (let attempt = 0; attempt < 21; attempt += 1) {
      const response = await admin.panel.post(ACCOUNT.reauth, {});
      last = response.status;
      retryAfter = response.headers['retry-after'];
      if (attempt < 20) expect(response.status, `request ${attempt + 1}`).toBe(400);
    }
    expect(last).toBe(429);
    expect(Number(retryAfter)).toBeGreaterThan(0);
    const password = await admin.panel.post(ACCOUNT.password, {});
    expect(password.status).toBe(429); // the same bucket
  });

  it('EVM-028 AC8 the matrix generated from the contract — Administrator, Editor, Read-only, anonymous, revoked, expired, both channels, both states, a fresh and a stale window, and the object of somebody else — is answered as expected for every operation of the account', async () => {
    const app = current as IdentityApp;
    const cells = buildMatrix(AUTHZ_MANIFEST, lists).filter((cell) => (ACCOUNT_OPERATIONS as readonly string[]).includes(cell.operationId));
    expect(new Set(cells.map((cell) => cell.operationId))).toEqual(new Set(ACCOUNT_OPERATIONS));
    expect(cells.filter((cell) => !cell.idor)).toHaveLength(ACCOUNT_OPERATIONS.length * 19);
    // the key of somebody else for each role, and the session of somebody else for the Administrator with a fresh key (the only caller a step-up lets in)
    expect(
      cells
        .filter((cell) => cell.idor)
        .map((cell) => cell.operationId)
        .sort(),
    ).toEqual(['endAccountSession', 'removePasskey', 'removePasskey', 'removePasskey']);
    // the anonymous caller is 401 on every one of them, the mobile channel 403, an enrolment session 403 mfa_enrollment_required
    for (const cell of cells.filter((candidate) => candidate.caller.kind === 'anonymous')) {
      expect(cell.expectation, cell.operationId).toEqual({ outcome: 'denied', status: 401, code: 'unauthenticated' });
    }
    expect(await runMatrix(app, cells, await matrixObjects(app))).toEqual([]);
  });

  it('EVM-028 AC8 a session in mfa_enrollment gets 403 mfa_enrollment_required on all of them — and the enrolment operations of EVM-023 keep working for it (regression)', async () => {
    const app = current as IdentityApp;
    const user = await createUser(app.database.admin, app.clock, { role: 'editor', status: 'active' });
    const waiting = await createSession(app.database.admin, app.clock, user, { state: 'mfa_enrollment' });
    const panel = new PanelClient(app.app.getHttpServer(), PANEL_ORIGIN);
    panel.cookie = waiting.cookie;
    panel.csrfToken = waiting.csrfToken;
    const paths: Array<[string, string]> = [
      ['get', ACCOUNT.account],
      ['patch', ACCOUNT.account],
      ['post', ACCOUNT.reauth],
      ['post', ACCOUNT.password],
      ['delete', `${ACCOUNT.passkeys}/00000000-0000-7000-8000-000000000001`],
      ['delete', ACCOUNT.totp],
      ['get', ACCOUNT.sessions],
      ['delete', ACCOUNT.sessions],
      ['delete', `${ACCOUNT.sessions}/00000000-0000-7000-8000-000000000001`],
    ];
    for (const [method, path] of paths) {
      app.clock.advance(61_000);
      const response =
        method === 'get'
          ? await panel.get(path)
          : method === 'delete'
            ? await panel.delete(path)
            : await (method === 'patch' ? panel.patch(path, {}) : panel.post(path, {}));
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(response.body, `${method} ${path}`).toMatchObject({ code: 'mfa_enrollment_required' });
    }
  });
});
