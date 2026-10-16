import { AUTHZ_MANIFEST, PUBLIC_OPERATIONS } from '@evia/contracts/authz';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createLink, createPasskey, createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertTotpFactor, nextStep, SECOND_STEP, totpCode } from '../support/totp-flows.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

const ROLES: readonly Role[] = ['administrator', 'editor', 'read_only'];
const MINUTE = 60_000;

type State = 'enrolment_with_link' | 'enrolment_from_login' | 'active_fresh' | 'active_stale' | 'active_from_recovery_code';

/** One browser in one of the states of the matrix of the story: the account and its session are written straight into the database. */
async function caller(role: Role, state: State, options: { channel?: 'web' | 'mobile' } = {}) {
  const waiting = state === 'enrolment_with_link';
  const user = await createUser(current.database.admin, current.clock, { role, status: waiting ? 'invited' : 'active' });
  let secret: string | undefined;
  if (state === 'enrolment_from_login') {
    // an active account without any second step: the password alone gives the session that is not tied to a link
  } else if (!waiting) {
    if (role === 'administrator') await createPasskey(current.database.admin, current.clock, user);
    else secret = (await insertTotpFactor(current, user.id)).secret;
  }
  const link = waiting ? await createLink(current.database.admin, current.clock, user.id) : undefined;
  const session = await createSession(current.database.admin, current.clock, user, {
    channel: options.channel ?? 'web',
    state: waiting || state === 'enrolment_from_login' ? 'mfa_enrollment' : 'active',
    ...(link === undefined ? {} : { linkId: link.id }),
    ...(state === 'active_fresh' ? { passkeyAuthenticatedAt: current.clock.now(), totpAuthenticatedAt: current.clock.now() } : {}),
    ...(state === 'active_stale'
      ? {
          passkeyAuthenticatedAt: new Date(current.clock.now().getTime() - 16 * MINUTE),
          totpAuthenticatedAt: new Date(current.clock.now().getTime() - 16 * MINUTE),
        }
      : {}),
  });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { panel, user, secret };
}

const answer = (response: { status: number; body: unknown }) => ({
  status: response.status,
  code: (response.body as { code?: string }).code,
});

describe('the authorization of the second step: the matrix of roles and states (EVM-023 AC8; SR-AUTHZ-05, SR-AUTHZ-12; C5)', () => {
  it('EVM-023 AC8 the contract: the two sign-in operations are public and the three of the account are sessions of the web channel for every role', () => {
    for (const id of ['loginTotp', 'loginRecoveryCode']) {
      expect(AUTHZ_MANIFEST[id]?.method, id).toBe('post');
      expect(AUTHZ_MANIFEST[id]?.authz, id).toEqual({ public: true });
      expect(PUBLIC_OPERATIONS, id).toContain(id);
    }
    for (const id of ['setupTotp', 'confirmTotp', 'generateRecoveryCodes', 'stepUp']) {
      expect(AUTHZ_MANIFEST[id]?.authz.roles, id).toEqual(['administrator', 'editor', 'read_only']);
      expect(AUTHZ_MANIFEST[id]?.authz.channels, id).toEqual(['web']);
    }
  });

  it('EVM-023 AC8 B1 setupTotp: only the enrolment of a link, only for Editor and Read-only; the Administrator, a session of the password alone and an active session are 403 forbidden; nobody is 401', async () => {
    const anonymous = await current.panel().post(SECOND_STEP.setup);
    expect(answer(anonymous)).toEqual({ status: 401, code: 'unauthenticated' });
    const expected: Record<State, (role: Role) => { status: number; code?: string }> = {
      enrolment_with_link: (role) => (role === 'administrator' ? { status: 403, code: 'forbidden' } : { status: 200 }),
      enrolment_from_login: () => ({ status: 403, code: 'forbidden' }),
      active_fresh: () => ({ status: 403, code: 'forbidden' }),
      active_stale: () => ({ status: 403, code: 'forbidden' }),
      active_from_recovery_code: () => ({ status: 403, code: 'forbidden' }),
    };
    for (const state of Object.keys(expected) as State[])
      for (const role of ROLES) {
        nextStep(current);
        const { panel } = await caller(role, state);
        const response = await panel.post(SECOND_STEP.setup);
        const want = expected[state](role);
        expect(response.status, `${role} ${state}`).toBe(want.status);
        if (want.code !== undefined) expect((response.body as { code?: string }).code, `${role} ${state}`).toBe(want.code);
      }
  });

  it('EVM-023 AC8 B1 confirmTotp: the same states, the same answers — the code is not even looked at where the session may not enrol', async () => {
    const anonymous = await current.panel().post(SECOND_STEP.confirm, { code: '123456' });
    expect(answer(anonymous)).toEqual({ status: 401, code: 'unauthenticated' });
    for (const state of ['enrolment_from_login', 'active_fresh', 'active_stale', 'active_from_recovery_code'] as const)
      for (const role of ROLES) {
        nextStep(current);
        const { panel } = await caller(role, state);
        expect(answer(await panel.post(SECOND_STEP.confirm, { code: '123456' })), `${role} ${state}`).toEqual({
          status: 403,
          code: 'forbidden',
        });
      }
    for (const role of ROLES) {
      nextStep(current);
      const { panel } = await caller(role, 'enrolment_with_link');
      const expected = role === 'administrator' ? { status: 403, code: 'forbidden' } : { status: 400, code: 'totp_verification_failed' };
      expect(answer(await panel.post(SECOND_STEP.confirm, { code: '123456' })), role).toEqual(expected);
    }
  });

  it('EVM-023 AC8 B4 generateRecoveryCodes: an enrolment is 403 mfa_enrollment_required, a stale window 403 step_up_required, a fresh one 200 for every role; mobile is 403 forbidden', async () => {
    const anonymous = await current.panel().post(SECOND_STEP.recoveryCodes);
    expect(answer(anonymous)).toEqual({ status: 401, code: 'unauthenticated' });
    for (const role of ROLES) {
      nextStep(current);
      for (const state of ['enrolment_with_link', 'enrolment_from_login'] as const)
        expect(answer(await (await caller(role, state)).panel.post(SECOND_STEP.recoveryCodes)), `${role} ${state}`).toEqual({
          status: 403,
          code: 'mfa_enrollment_required',
        });
      for (const state of ['active_stale', 'active_from_recovery_code'] as const)
        expect(answer(await (await caller(role, state)).panel.post(SECOND_STEP.recoveryCodes)), `${role} ${state}`).toEqual({
          status: 403,
          code: 'step_up_required',
        });
      expect((await (await caller(role, 'active_fresh')).panel.post(SECOND_STEP.recoveryCodes)).status, role).toBe(200);
      expect(
        answer(await (await caller(role, 'active_fresh', { channel: 'mobile' })).panel.post(SECOND_STEP.recoveryCodes)),
        `${role} mobile`,
      ).toEqual({ status: 403, code: 'forbidden' });
    }
  });

  it('EVM-023 AC8 B4 the answer for a fresh session is the first generation only: a second session of the same account gets 403 recovery_codes_regeneration_unavailable (IDOR over the codes of another session)', async () => {
    const first = await caller('editor', 'active_fresh');
    expect((await first.panel.post(SECOND_STEP.recoveryCodes)).status).toBe(200);
    const sameAccountOtherSession = await createSession(current.database.admin, current.clock, first.user, {
      passkeyAuthenticatedAt: current.clock.now(),
      totpAuthenticatedAt: current.clock.now(),
    });
    const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
    panel.cookie = sameAccountOtherSession.cookie;
    panel.csrfToken = sameAccountOtherSession.csrfToken;
    expect(answer(await panel.post(SECOND_STEP.recoveryCodes))).toEqual({ status: 403, code: 'recovery_codes_regeneration_unavailable' });
  });

  it('EVM-023 AC7 AC8 stepUp with a code: Editor and Read-only are let in, the Administrator is 403, an enrolment is 403 mfa_enrollment_required, nobody is 401', async () => {
    const anonymous = await current.panel().post(SECOND_STEP.stepUp, { method: 'totp', code: '123456' });
    expect(answer(anonymous)).toEqual({ status: 401, code: 'unauthenticated' });
    for (const role of ROLES) {
      nextStep(current);
      const fresh = await caller(role, 'active_stale');
      if (role === 'administrator') {
        await insertTotpFactor(current, fresh.user.id);
        const response = await fresh.panel.post(SECOND_STEP.stepUp, { method: 'totp', code: '123456' });
        expect(answer(response), role).toEqual({ status: 403, code: 'forbidden' });
      } else {
        const code = totpCode(fresh.secret ?? '', current.clock.now());
        expect((await fresh.panel.post(SECOND_STEP.stepUp, { method: 'totp', code })).status, role).toBe(200);
      }
      for (const state of ['enrolment_with_link', 'enrolment_from_login'] as const)
        expect(
          answer(await (await caller(role, state)).panel.post(SECOND_STEP.stepUp, { method: 'totp', code: '123456' })),
          `${role} ${state}`,
        ).toEqual({
          status: 403,
          code: 'mfa_enrollment_required',
        });
    }
  });

  it('EVM-023 AC8 the operations of the account and the step-up are not for the mobile channel in M1: a mobile session is 403 forbidden', async () => {
    for (const role of ['administrator', 'editor'] as const) {
      nextStep(current);
      const { panel } = await caller(role, 'active_fresh', { channel: 'mobile' });
      for (const [path, body] of [
        [SECOND_STEP.setup, {}],
        [SECOND_STEP.confirm, { code: '123456' }],
        [SECOND_STEP.stepUp, { method: 'totp', code: '123456' }],
      ] as const)
        expect(answer(await panel.post(path, body)), `${role} ${path}`).toEqual({ status: 403, code: 'forbidden' });
    }
  });

  it('EVM-023 AC8 the mutations of a session need the origin of the panel and the CSRF token: without them 403 csrf_failed, whatever the state', async () => {
    const { panel } = await caller('editor', 'active_fresh');
    const token = panel.csrfToken;
    panel.csrfToken = 'x'.repeat(43);
    for (const path of [SECOND_STEP.setup, SECOND_STEP.confirm, SECOND_STEP.recoveryCodes, SECOND_STEP.stepUp])
      expect(answer(await panel.post(path, {})), path).toEqual({ status: 403, code: 'csrf_failed' });
    panel.csrfToken = token;
  });

  it('EVM-023 AC8 the account is always the one of the session or of the loginToken: no body of these operations may name one (400, nothing changes)', async () => {
    const { panel, user } = await caller('editor', 'active_fresh');
    for (const [path, body] of [
      [SECOND_STEP.setup, { userId: user.id }],
      [SECOND_STEP.confirm, { code: '123456', userId: user.id }],
      [SECOND_STEP.recoveryCodes, { userId: user.id }],
      [SECOND_STEP.stepUp, { method: 'totp', code: '123456', userId: user.id }],
    ] as const)
      expect((await panel.post(path, body)).status, path).toBe(400);
    const loginBodies = [
      [SECOND_STEP.loginTotp, { loginToken: 'A'.repeat(43), code: '123456', userId: user.id }],
      [SECOND_STEP.loginRecoveryCode, { loginToken: 'A'.repeat(43), code: 'ABCDEFGHIJKLMNOPQRST', email: 'x@example.com' }],
    ] as const;
    for (const [path, body] of loginBodies) expect((await current.panel().post(path, body)).status, path).toBe(400);
  });

  it('EVM-023 AC8 the sign-in operations are public: a signed-in browser, a revoked cookie and a stranger get the same answer to the same wrong loginToken', async () => {
    const strangers = [current.panel(), (await caller('editor', 'active_fresh')).panel];
    const revoked = await caller('read_only', 'active_fresh');
    await revoked.panel.post('/api/v1/auth/logout');
    strangers.push(revoked.panel);
    for (const path of [SECOND_STEP.loginTotp, SECOND_STEP.loginRecoveryCode]) {
      const answers = new Set<string>();
      for (const panel of strangers) {
        nextStep(current);
        const body =
          path === SECOND_STEP.loginTotp
            ? { loginToken: 'B'.repeat(43), code: '123456' }
            : { loginToken: 'B'.repeat(43), code: 'ABCDEFGHIJKLMNOPQRST' };
        answers.add(JSON.stringify(answer(await panel.post(path, body))));
      }
      expect(answers.size, path).toBe(1);
      expect([...answers][0]).toBe(JSON.stringify({ status: 401, code: 'unauthenticated' }));
    }
  });
});
