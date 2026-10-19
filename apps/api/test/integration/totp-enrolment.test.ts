import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FieldEncryption } from '../../src/platform/crypto/field-encryption.ts';
import { FIELD_ENCRYPTION } from '../../src/platform/tokens.ts';
import { totpSecretContext } from '../../src/modules/identity/domain/totp.ts';
import { identityTables } from '../../src/modules/identity/infrastructure/tables.ts';
import { PATHS, setPassword } from '../support/flows.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createLink, createPasskey, createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { outboxRows } from '../support/invitation-fixtures.ts';
import { enrolledAccount } from '../support/login-flows.ts';
import type { PanelClient } from '../support/panel-client.ts';
import { codeNow, confirmTotp, everythingWritten, insertTotpFactor, SECOND_STEP, sha256, totpAccount } from '../support/totp-flows.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

const db = () => identityTables(current.database.admin);
const factorOf = (userId: string) => db().selectFrom('identity.totp_factors').selectAll().where('user_id', '=', userId).executeTakeFirst();
const audit = async (action: string) =>
  (
    await sql<{
      outcome: string;
      reason_code: string | null;
      actor_user_id: string | null;
      object_id: string | null;
      session_id: string | null;
    }>`
      select outcome, reason_code, actor_user_id, object_id, session_id from audit.events where action = ${action} order by occurred_at, id`.execute(
      current.database.admin,
    )
  ).rows;

/** The page W-03: an invited person who opened the link and set the password — a session in `mfa_enrollment` bound to the link. */
async function waitingForSecondStep(role: Role = 'editor', email?: string) {
  const user = await createUser(current.database.admin, current.clock, {
    role,
    status: 'invited',
    ...(email === undefined ? {} : { email }),
  });
  const link = await createLink(current.database.admin, current.clock, user.id);
  const panel = current.panel();
  const response = await setPassword(panel, link.token);
  expect(response.status).toBe(200);
  return { user, link, panel };
}

const setup = async (panel: PanelClient) => {
  const response = await panel.post(SECOND_STEP.setup);
  return { response, body: response.body as { secret: string; otpauthUri: string } };
};

describe('setup of the code of the app (EVM-023 AC1; SR-AUTH-07, SR-CRYPTO-02, B1)', () => {
  it('EVM-023 AC1 setup gives a 160-bit key and an otpauth address of the issuer and the e-mail of the employee, never cached', async () => {
    const { user, panel } = await waitingForSecondStep('editor', 'ewa.edytor@example.com');
    const { response, body } = await setup(panel);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(body.secret).toMatch(/^[A-Z2-7]{32}$/); // 32 base32 characters = 160 bits
    const uri = new URL(body.otpauthUri);
    expect(uri.protocol).toBe('otpauth:');
    expect(decodeURIComponent(uri.pathname)).toBe('/EVia Manager:ewa.edytor@example.com');
    expect(uri.searchParams.get('secret')).toBe(body.secret);
    expect((await factorOf(user.id))?.state).toBe('pending');
  });

  it('EVM-023 AC1 the secret is in the database only as a sealed envelope that opens for this account alone (P12)', async () => {
    const { user, panel } = await waitingForSecondStep();
    const { body } = await setup(panel);
    const factor = await factorOf(user.id);
    const sealed = factor?.secret_ciphertext as Buffer;
    const raw = Buffer.from(body.secret.replace(/=+$/, ''), 'ascii');
    expect(sealed.includes(raw)).toBe(false);
    const encryption = current.app.get<FieldEncryption>(FIELD_ENCRYPTION, { strict: false });
    const opened = encryption.decrypt(sealed, totpSecretContext(user.id));
    expect(opened).toHaveLength(20);
    expect(() => encryption.decrypt(sealed, totpSecretContext('another-account'))).toThrow();
    // the whole database holds the key to type in nowhere in the clear
    const everything = (
      await sql<{ row: string }>`select to_jsonb(t)::text as row from identity.totp_factors t`.execute(current.database.admin)
    ).rows;
    expect(JSON.stringify(everything)).not.toContain(body.secret);
  });

  it('EVM-023 AC1 a second setup before the confirmation replaces the pending secret: the earlier key no longer confirms', async () => {
    const { user, panel } = await waitingForSecondStep();
    const first = (await setup(panel)).body.secret;
    const second = (await setup(panel)).body.secret;
    expect(second).not.toBe(first);
    expect((await confirmTotp(panel, codeNow(current, first))).status).toBe(400);
    expect((await factorOf(user.id))?.state).toBe('pending');
    expect((await confirmTotp(panel, codeNow(current, second))).status).toBe(200);
  });

  it('EVM-023 AC8 every role may enrol except the Administrator in the panel (403, nothing stored): Editor and Read-only get the key', async () => {
    for (const role of ['editor', 'read_only'] as const) {
      const { user, panel } = await waitingForSecondStep(role);
      expect((await setup(panel)).response.status, role).toBe(200);
      expect((await factorOf(user.id))?.state, role).toBe('pending');
    }
    const { user, panel } = await waitingForSecondStep('administrator');
    const { response } = await setup(panel);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'forbidden' });
    expect(await factorOf(user.id)).toBeUndefined();
    const confirmation = await confirmTotp(panel, '123456');
    expect(confirmation.status).toBe(403);
  });

  it('EVM-023 AC1 B1 EVM-027 D2 the password alone gives no session to an account without a second step (403 mfa_setup_expired), and a session without a link enrols nothing: setup and confirmation are 403 (AB-01)', async () => {
    const account = await enrolledAccount(current, { role: 'editor' });
    await sql`delete from identity.passkeys where user_id = ${account.user.id}`.execute(current.database.admin);
    const login = await current.panel().post('/api/v1/auth/login', { email: account.email, password: account.password });
    expect(login.status).toBe(403);
    expect(login.body).toMatchObject({ code: 'mfa_setup_expired' });
    expect(login.headers['set-cookie']).toBeUndefined();
    // a session of the earlier code (EVM-067) that has no link: it exists in a database that was running before the change, and enrols nothing
    const session = await createSession(current.database.admin, current.clock, account.user, { state: 'mfa_enrollment' });
    const panel = current.panel();
    panel.cookie = session.cookie;
    panel.csrfToken = session.csrfToken;
    const attempt = await setup(panel);
    expect(attempt.response.status).toBe(403);
    expect(attempt.response.body).toMatchObject({ code: 'forbidden' });
    expect((await confirmTotp(panel, '123456')).status).toBe(403);
    expect(await factorOf(account.user.id)).toBeUndefined();
  });

  it('EVM-023 AC1 B1 an active session cannot enrol either (403), and an account that already has an active factor never gets a second setup (409, no secret)', async () => {
    const account = await totpAccount(current);
    const active = await account.panel.post(SECOND_STEP.setup);
    expect(active.status).toBe(403);

    // an enrolment session of a link on an account that already has an active TOTP factor (it cannot come from the flows — a defence of the service)
    const waiting = await createUser(current.database.admin, current.clock, { role: 'editor', status: 'invited' });
    const { secret } = await insertTotpFactor(current, waiting.id);
    const before = (await factorOf(waiting.id))?.secret_ciphertext as Buffer;
    const link = await createLink(current.database.admin, current.clock, waiting.id);
    const session = await createSession(current.database.admin, current.clock, waiting, { state: 'mfa_enrollment', linkId: link.id });
    const panel = current.panel();
    panel.cookie = session.cookie;
    panel.csrfToken = session.csrfToken;
    const second = await setup(panel);
    expect(second.response.status).toBe(409);
    expect(second.response.body).toMatchObject({ code: 'mfa_already_configured' });
    expect(JSON.stringify(second.response.body)).not.toContain(secret);
    expect(((await factorOf(waiting.id))?.secret_ciphertext as Buffer).equals(before)).toBe(true);
    expect((await factorOf(waiting.id))?.state).toBe('active');
  });

  it('EVM-023 AC1 B1 an account that already has a passkey gets no setup either: 409', async () => {
    const user = await createUser(current.database.admin, current.clock, { role: 'editor', status: 'invited' });
    await createPasskey(current.database.admin, current.clock, user);
    const link = await createLink(current.database.admin, current.clock, user.id);
    const session = await createSession(current.database.admin, current.clock, user, { state: 'mfa_enrollment', linkId: link.id });
    const panel = current.panel();
    panel.cookie = session.cookie;
    panel.csrfToken = session.csrfToken;
    const { response } = await setup(panel);
    expect(response.status).toBe(409);
    expect(await factorOf(user.id)).toBeUndefined();
  });

  it('EVM-023 AC1 without a key of the encrypted fields nothing is stored and the answer is 503 (fail closed)', async () => {
    await current.close();
    current = await createIdentityApp({ env: { FIELD_ENCRYPTION_KEYS: '' } });
    const { user, panel } = await waitingForSecondStep();
    const { response } = await setup(panel);
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ code: 'service_unavailable' });
    expect(await factorOf(user.id)).toBeUndefined();
  });

  it('EVM-023 AC1 the body of the setup carries nothing: a named account is refused (the account is the session)', async () => {
    const { user, panel } = await waitingForSecondStep();
    const response = await panel.post(SECOND_STEP.setup, { userId: user.id });
    expect(response.status).toBe(400);
    expect(await factorOf(user.id)).toBeUndefined();
  });
});

describe('confirmation of the code of the app (EVM-023 AC1, AC6; SR-AUTH-07, SR-SESS-02, B1)', () => {
  it('EVM-023 AC1 a wrong code activates nothing: the method stays pending, the account invited, the link unused, and the failure is audited without the code', async () => {
    const { user, link, panel } = await waitingForSecondStep();
    const { body } = await setup(panel);
    const wrong = codeNow(current, body.secret) === '000000' ? '000001' : '000000';
    const response = await confirmTotp(panel, wrong);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'totp_verification_failed' });
    expect((await factorOf(user.id))?.state).toBe('pending');
    const account = await db().selectFrom('identity.users').select('status').where('id', '=', user.id).executeTakeFirstOrThrow();
    expect(account.status).toBe('invited');
    const spent = await db().selectFrom('identity.one_time_links').select('used_at').where('id', '=', link.id).executeTakeFirstOrThrow();
    expect(spent.used_at).toBeNull();
    expect(await audit('mfa.totp_enrolled')).toEqual([
      expect.objectContaining({ outcome: 'failed', reason_code: 'totp_failed', actor_user_id: user.id }),
    ]);
    expect(await everythingWritten(current)).not.toContain(`"${wrong}"`);
    // the same key still confirms afterwards (the person may retry)
    expect((await confirmTotp(panel, codeNow(current, body.secret))).status).toBe(200);
  });

  it('EVM-023 AC1 AC6 a correct code in one transaction: the method is active, the account active, the link spent, the enrolment session ended and a new active one started', async () => {
    const { user, link, panel } = await waitingForSecondStep();
    const enrolmentCookie = panel.cookie;
    const { body } = await setup(panel);
    const response = await confirmTotp(panel, codeNow(current, body.secret));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ state: 'active' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(panel.cookie).toBeDefined();
    expect(panel.cookie).not.toBe(enrolmentCookie);

    const factor = await factorOf(user.id);
    expect(factor?.state).toBe('active');
    expect(factor?.confirmed_at).not.toBeNull();
    const account = await db().selectFrom('identity.users').select('status').where('id', '=', user.id).executeTakeFirstOrThrow();
    expect(account.status).toBe('active');
    const spent = await db().selectFrom('identity.one_time_links').select('used_at').where('id', '=', link.id).executeTakeFirstOrThrow();
    expect(spent.used_at).not.toBeNull();

    const sessions = await db().selectFrom('identity.sessions').selectAll().where('user_id', '=', user.id).orderBy('created_at').execute();
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ state: 'mfa_enrollment', revoke_reason: 'rotated' });
    expect(sessions[1]).toMatchObject({ state: 'active', revoked_at: null, one_time_link_id: null, passkey_authenticated_at: null });
    expect(sessions[1]?.totp_authenticated_at).not.toBeNull(); // the code was just proved: the third step may ask for the recovery codes
    // the old session is dead
    const old = current.panel();
    old.cookie = enrolmentCookie;
    expect((await old.get(PATHS.session)).status).toBe(401);
  });

  it('EVM-023 AC6 the change is audited (the account, never the secret or a code) and an e-mail about it waits in the outbox without a body', async () => {
    const { user, panel } = await waitingForSecondStep();
    const { body } = await setup(panel);
    const code = codeNow(current, body.secret);
    await confirmTotp(panel, code);
    expect(await audit('mfa.totp_enrolled')).toEqual([
      expect.objectContaining({ outcome: 'success', actor_user_id: user.id, object_id: user.id }),
    ]);
    expect(await outboxRows(current, { recipient: user.id, kind: 'mfa_changed' })).toEqual([
      expect.objectContaining({ variant: 'totp_enrolled', state: 'pending' }),
    ]);
    const written = await everythingWritten(current);
    expect(written).not.toContain(body.secret);
    expect(written).not.toContain(code);
    expect(written).not.toContain(sha256(body.secret));
    expect(written).not.toContain(user.email);
  });

  it('EVM-023 AC1 B1 two parallel confirmations activate once: one 200, the other finds the enrolment ended (401), one factor, one new session', async () => {
    const { user, panel } = await waitingForSecondStep();
    const { body } = await setup(panel);
    const code = codeNow(current, body.secret);
    const first = panel.post(SECOND_STEP.confirm, { code });
    const second = panel.post(SECOND_STEP.confirm, { code });
    const statuses = (await Promise.all([first, second])).map((response) => response.status).sort();
    expect(statuses).toEqual([200, 401]);
    expect(await audit('mfa.totp_enrolled')).toHaveLength(1);
    const live = await db()
      .selectFrom('identity.sessions')
      .select('id')
      .where('user_id', '=', user.id)
      .where('state', '=', 'active')
      .where('revoked_at', 'is', null)
      .execute();
    expect(live).toHaveLength(1);
  });

  it('EVM-023 AC1 C1 the code that confirmed the setup can never sign in: the step is recorded', async () => {
    const { user, panel } = await waitingForSecondStep('editor', 'ala.edytor@example.com');
    const { body } = await setup(panel);
    const code = codeNow(current, body.secret);
    await confirmTotp(panel, code);
    const factor = await factorOf(user.id);
    expect(Number(factor?.last_used_step)).toBe(Math.floor(current.clock.now().getTime() / 30_000));
    const browser = current.panel();
    const first = await browser.post('/api/v1/auth/login', { email: user.email, password: 'Zq9-lamp-Orbit-4' });
    const { loginToken } = first.body as { loginToken: string };
    const second = await browser.post(SECOND_STEP.loginTotp, { loginToken, code });
    expect(second.status).toBe(401);
    expect(second.body).toMatchObject({ code: 'totp_failed' });
  });

  it('EVM-023 AC1 B1 a link that ran out between the setup and the confirmation ends the enrolment (401 session_revoked) and changes nothing', async () => {
    const { user, link, panel } = await waitingForSecondStep();
    const { body } = await setup(panel);
    await sql`update identity.one_time_links set expires_at = ${new Date(current.clock.now().getTime() - 1)}, issued_at = ${new Date(current.clock.now().getTime() - 10)} where id = ${link.id}`.execute(
      current.database.admin,
    );
    const response = await confirmTotp(panel, codeNow(current, body.secret));
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'session_revoked' });
    expect((await factorOf(user.id))?.state).toBe('pending');
    const account = await db().selectFrom('identity.users').select('status').where('id', '=', user.id).executeTakeFirstOrThrow();
    expect(account.status).toBe('invited');
  });

  it('EVM-023 AC1 a confirmation without a setup is a refused code, and the code must be six digits (anything else is a 400 of the schema, a named account too)', async () => {
    const { panel, user } = await waitingForSecondStep();
    const none = await confirmTotp(panel, '123456');
    expect(none.status).toBe(400);
    expect(none.body).toMatchObject({ code: 'totp_verification_failed' });
    for (const body of [
      { code: '12345' },
      { code: '1234567' },
      { code: 'abcdef' },
      { code: 123456 },
      {},
      { code: '123456', userId: user.id },
    ]) {
      const response = await panel.post(SECOND_STEP.confirm, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body).toMatchObject({ code: 'validation_failed' });
    }
  });

  it('EVM-023 AC1 the confirmation needs the CSRF token and the origin of the panel like every operation of a session', async () => {
    const { panel } = await waitingForSecondStep();
    await setup(panel);
    const token = panel.csrfToken;
    panel.csrfToken = undefined;
    expect((await panel.post(SECOND_STEP.confirm, { code: '123456' })).status).toBe(403);
    panel.csrfToken = token;
    expect((await panel.post(SECOND_STEP.confirm, { code: '123456' })).body).toMatchObject({ code: 'totp_verification_failed' });
  });
});
