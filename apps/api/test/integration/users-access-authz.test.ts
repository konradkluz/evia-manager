import { AUTHZ_MANIFEST } from '@evia/contracts/authz';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { USERS, browserOf, type Browser } from '../support/invitation-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { etag } from '../support/user-access-fixtures.ts';
import { sql } from 'kysely';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

interface Operation {
  readonly id: string;
  readonly method: 'put' | 'post' | 'delete';
  readonly path: (userId: string) => string;
  readonly body?: Record<string, string>;
  /** The state of the account the operation can act on. */
  readonly target: 'active' | 'deactivated';
  readonly ok: number;
}

const OPERATIONS: readonly Operation[] = [
  { id: 'changeUserRole', method: 'put', path: (id) => `${USERS}/${id}/role`, body: { role: 'read_only' }, target: 'active', ok: 200 },
  { id: 'deactivateUser', method: 'post', path: (id) => `${USERS}/${id}/deactivation`, target: 'active', ok: 200 },
  { id: 'reactivateUser', method: 'post', path: (id) => `${USERS}/${id}/reactivation`, target: 'deactivated', ok: 200 },
  { id: 'endUserSessions', method: 'delete', path: (id) => `${USERS}/${id}/sessions`, target: 'active', ok: 204 },
  {
    id: 'resetUserSecondStep',
    method: 'post',
    path: (id) => `${USERS}/${id}/second-step-reset`,
    body: { identityVerification: 'in_person' },
    target: 'active',
    ok: 200,
  },
];

async function targetFor(operation: Operation) {
  const user = await createUser(current.database.admin, current.clock, { role: 'editor', status: operation.target });
  await sql`update identity.users set activated_at = ${current.clock.now()} where id = ${user.id}`.execute(current.database.admin);
  return user;
}

/** A request built by hand (no browser: the caller sets every header it wants — the attacks of the matrix). */
function rawCall(operation: Operation, userId: string) {
  const server = current.app.getHttpServer();
  const path = operation.path(userId);
  return operation.method === 'put'
    ? request(server).put(path)
    : operation.method === 'delete'
      ? request(server).delete(path)
      : request(server).post(path);
}

/** The request as the panel sends it (the headers a browser adds, the CSRF token of the session), with a correct `If-Match` for the account. */
async function send(browser: Browser, operation: Operation, userId: string, overrides: { ifMatch?: string } = {}) {
  const headers: Record<string, string> = operation.id === 'endUserSessions' ? {} : { 'If-Match': overrides.ifMatch ?? etag(1) };
  if (operation.method === 'put') return browser.panel.put(operation.path(userId), operation.body, headers);
  if (operation.method === 'delete') return browser.panel.delete(operation.path(userId), headers);
  return browser.panel.post(operation.path(userId), operation.body, headers);
}

describe('who may administer accounts (EVM-027 AC8; SR-AUTHZ-05, SR-AUTHZ-11, SR-SESS-08)', () => {
  it('EVM-027 AC8 every operation is for the Administrator after a step-up on the web channel, with audit — in the contract and in the guard', () => {
    for (const operation of OPERATIONS) {
      expect(AUTHZ_MANIFEST[operation.id], operation.id).toMatchObject({
        method: operation.method,
        authz: { roles: ['administrator'], channels: ['web'], stepUp: true, audit: true },
      });
    }
  });

  for (const operation of OPERATIONS) {
    it(`EVM-027 AC8 ${operation.id}: the Administrator with a fresh key is let in (${operation.ok}); without one (never, or 16 minutes ago) it is 403 step_up_required and nothing changes`, async () => {
      const admin = await browserOf(current);
      const target = await targetFor(operation);
      const done = await send(admin, operation, target.id);
      expect(done.status, JSON.stringify(done.body)).toBe(operation.ok);
      expect(JSON.stringify(done.body)).not.toMatch(/hash|secret|token/i);

      for (const key of ['none', 'stale'] as const) {
        const weak = await browserOf(current, { key });
        const other = await targetFor(operation);
        const before = await current.snapshot();
        const denied = await send(weak, operation, other.id);
        expect(denied.status, key).toBe(403);
        expect(denied.body).toMatchObject({ code: 'step_up_required' });
        expect(await current.snapshot(), key).toBe(before);
      }
    });

    it(`EVM-027 AC8 ${operation.id}: an Editor and a Tylko odczyt user get 403 forbidden — for a real account, a missing one and a stale version alike, so nothing tells whether the account exists — an anonymous caller 401, and nothing changes`, async () => {
      const target = await targetFor(operation);
      for (const role of ['editor', 'read_only'] as const satisfies readonly Role[]) {
        const browser = await browserOf(current, { role, key: 'fresh' });
        const snapshot = await current.snapshot();
        for (const id of [target.id, '0198f2a0-7b1c-7c4e-8d3a-5f6b7c8d9e99']) {
          const denied = await send(browser, operation, id, { ifMatch: etag(99) });
          expect(denied.status, `${role} ${id}`).toBe(403);
          expect(denied.body).toMatchObject({ code: 'forbidden' });
        }
        expect(await current.snapshot()).toBe(snapshot);
      }

      const anonymous = await rawCall(operation, target.id)
        .set('Origin', PANEL_ORIGIN)
        .set('Sec-Fetch-Site', 'same-origin')
        .set('If-Match', etag(1));
      expect(anonymous.status).toBe(401);
      expect(anonymous.body).toMatchObject({ code: 'unauthenticated' });
    });

    it(`EVM-027 AC8 ${operation.id}: the mobile channel is 403 forbidden BEFORE the object is looked at (a missing account is not 404), a session of the setup of a second step 403 mfa_enrollment_required, a request without the CSRF token or from another origin 403 csrf_failed`, async () => {
      const mobile = await browserOf(current, { channel: 'mobile' });
      const missing = '0198f2a0-7b1c-7c4e-8d3a-5f6b7c8d9e99';
      const onMobile = await send(mobile, operation, missing);
      expect(onMobile.status).toBe(403);
      expect(onMobile.body).toMatchObject({ code: 'forbidden' });

      const waiting = await browserOf(current, { state: 'mfa_enrollment' });
      const enrolling = await send(waiting, operation, missing);
      expect(enrolling.status).toBe(403);
      expect(enrolling.body).toMatchObject({ code: 'mfa_enrollment_required' });

      const admin = await browserOf(current);
      const target = await targetFor(operation);
      const bare = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
      bare.cookie = admin.panel.cookie;
      const withoutToken: Browser = { ...admin, panel: bare };
      const noCsrf = await send(withoutToken, operation, target.id);
      expect(noCsrf.status).toBe(403);
      expect(noCsrf.body).toMatchObject({ code: 'csrf_failed' });
      const session = await createSession(current.database.admin, current.clock, admin.user, {
        passkeyAuthenticatedAt: current.clock.now(),
      });
      const crossSite = await rawCall(operation, target.id)
        .set('Cookie', session.cookie)
        .set('X-CSRF-Token', session.csrfToken)
        .set('Origin', 'https://evil.example')
        .set('Sec-Fetch-Site', 'cross-site')
        .set('If-Match', etag(1));
      expect(crossSite.status).toBe(403);
      expect(crossSite.body).toMatchObject({ code: 'csrf_failed' });
    });

    it(`EVM-027 AC8 ${operation.id}: an account that does not exist or is deleted is 404 not_found for the Administrator — the same for both`, async () => {
      const admin = await browserOf(current);
      const gone = await targetFor(operation);
      await sql`update identity.users set deleted_at = ${current.clock.now()} where id = ${gone.id}`.execute(current.database.admin);
      for (const id of [gone.id, '0198f2a0-7b1c-7c4e-8d3a-5f6b7c8d9e99']) {
        const response = await send(admin, operation, id);
        expect(response.status, id).toBe(404);
        expect(response.body).toMatchObject({ code: 'not_found' });
      }
      const malformed = await send(admin, operation, 'not-a-uuid');
      expect(malformed.status).toBe(400);
    });
  }
});
