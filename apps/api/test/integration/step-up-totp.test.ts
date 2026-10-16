import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { identityTables } from '../../src/modules/identity/infrastructure/tables.ts';
import { PATHS } from '../support/flows.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { signedInAdministrator } from '../support/step-up-flows.ts';
import {
  codeNow,
  generateCodes,
  insertTotpFactor,
  nextStep,
  SECOND_STEP,
  sendLoginTotp,
  signInWithTotp,
  startLogin,
  totpAccount,
  type TotpAccount,
} from '../support/totp-flows.ts';
import { adopt } from '../support/login-flows.ts';
import type { PanelClient } from '../support/panel-client.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

const db = () => identityTables(current.database.admin);
const events = async (action: string) =>
  (
    await sql<{ outcome: string; reason_code: string | null; actor_user_id: string | null; object_id: string | null }>`
      select outcome, reason_code, actor_user_id, object_id from audit.events where action = ${action} order by occurred_at, id`.execute(
      current.database.admin,
    )
  ).rows;
const sessionsOf = (userId: string) =>
  db().selectFrom('identity.sessions').selectAll().where('user_id', '=', userId).orderBy('created_at').execute();

const sendStepUp = (panel: PanelClient, code: string) => Promise.resolve(panel.post(SECOND_STEP.stepUp, { method: 'totp', code }));
const wrongCode = (secret: string): string => (codeNow(current, secret) === '000000' ? '000001' : '000000');

/** An Editor with codes who signed in with the app and whose window has run out: the next guarded operation asks for a step-up. */
async function staleSession(role: 'editor' | 'read_only' = 'editor') {
  const account = await totpAccount(current, { role, withCodes: true });
  const { panel } = await signInWithTotp(current, account);
  current.clock.advance(16 * 60_000);
  return { account, panel };
}

/** The operation that asks for a fresh proof: with this account (it has codes from another session) it answers 403 `recovery_codes_regeneration_unavailable` once the guard lets it in. */
const probe = async (panel: PanelClient) => (await generateCodes(panel)).response;

describe('step-up with a code of the app (EVM-023 AC7; SR-SESS-08, SR-SESS-02; ASVS V7.5.3)', () => {
  it('EVM-023 AC7 an Editor whose window ran out is asked for a step-up (403 step_up_required) and confirms with the code of the app; the window opens again', async () => {
    const { account, panel } = await staleSession();
    const asked = await probe(panel);
    expect(asked.status).toBe(403);
    expect(asked.body).toMatchObject({ code: 'step_up_required' });

    nextStep(current);
    const response = await sendStepUp(panel, codeNow(current, account.secret));
    expect(response.status).toBe(200);
    expect(Object.keys(response.body as object)).toEqual(['csrfToken']);
    adopt(panel, response);
    const after = await probe(panel);
    expect(after.status).toBe(403);
    expect(after.body).toMatchObject({ code: 'recovery_codes_regeneration_unavailable' }); // the guard let it in: the window is open
  });

  it('EVM-023 AC7 SR-SESS-02 a successful step-up replaces the session (new token, new CSRF token), keeps the absolute limit and records only the code, never a passkey', async () => {
    const { account, panel } = await staleSession();
    const oldCookie = panel.cookie;
    const before = (await sessionsOf(account.user.id)).filter((session) => session.revoked_at === null).at(-1);
    nextStep(current);
    const response = await sendStepUp(panel, codeNow(current, account.secret));
    expect(response.status).toBe(200);
    expect(response.headers['set-cookie']).toBeDefined();
    adopt(panel, response);
    expect(panel.cookie).not.toBe(oldCookie);
    const old = current.panel();
    old.cookie = oldCookie;
    expect((await old.get(PATHS.session)).status).toBe(401);

    const live = (await sessionsOf(account.user.id)).filter((session) => session.revoked_at === null).at(-1);
    expect(live?.id).not.toBe(before?.id);
    expect(live?.absolute_expires_at).toEqual(before?.absolute_expires_at); // a step-up does not extend the life of the session
    expect(live?.totp_authenticated_at).toEqual(current.clock.now());
    expect(live?.passkey_authenticated_at).toBeNull();
    expect((await events('step_up.succeeded')).at(-1)).toMatchObject({
      outcome: 'success',
      actor_user_id: account.user.id,
      object_id: live?.id,
    });
  });

  it('EVM-023 AC7 a Read-only user steps up with the code too', async () => {
    const { account, panel } = await staleSession('read_only');
    nextStep(current);
    expect((await sendStepUp(panel, codeNow(current, account.secret))).status).toBe(200);
  });

  it('EVM-023 AC7 a wrong code is 401 totp_failed: the session stays as it was, is counted and audited without the code', async () => {
    const { account, panel } = await staleSession();
    const cookie = panel.cookie;
    nextStep(current);
    const wrong = wrongCode(account.secret);
    const response = await sendStepUp(panel, wrong);
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'totp_failed' });
    expect(panel.cookie).toBe(cookie);
    expect((await panel.get(PATHS.session)).status).toBe(200); // still the same live session
    const session = (await sessionsOf(account.user.id)).filter((row) => row.revoked_at === null).at(-1);
    expect(session?.step_up_failed_attempts).toBe(1);
    expect(await events('step_up.failed')).toEqual([
      expect.objectContaining({ outcome: 'failed', reason_code: 'totp_failed', actor_user_id: account.user.id, object_id: session?.id }),
    ]);
    expect(JSON.stringify(await events('step_up.failed'))).not.toContain(`"${wrong}"`);
    expect((await sendStepUp(panel, codeNow(current, account.secret))).status).toBe(200); // the person may retry
  });

  it('EVM-023 AC7 C1 a code is spent once for the whole account: the code of a step-up cannot be used again, and the code of the sign-in cannot step up', async () => {
    const { account, panel } = await staleSession();
    nextStep(current);
    const code = codeNow(current, account.secret);
    const stepped = await sendStepUp(panel, code);
    expect(stepped.status).toBe(200);
    adopt(panel, stepped);
    const replay = await sendStepUp(panel, code);
    expect(replay.status).toBe(401);
    expect(replay.body).toMatchObject({ code: 'totp_failed' });
    const browser = current.panel();
    const refused = await sendLoginTotp(browser, await startLogin(browser, account), code);
    expect(refused.status).toBe(401); // the same code does not sign in either
  });

  it('EVM-023 AC7 B3 the fifth wrong code of a session ends it (401 session_revoked, reason step_up_failed); the sixth finds no session', async () => {
    const { account, panel } = await staleSession();
    nextStep(current);
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await sendStepUp(panel, wrongCode(account.secret));
      expect(response.status, `${attempt}`).toBe(401);
      expect(response.body, `${attempt}`).toMatchObject({ code: 'totp_failed' });
    }
    const fifth = await sendStepUp(panel, wrongCode(account.secret));
    expect(fifth.status).toBe(401);
    expect(fifth.body).toMatchObject({ code: 'session_revoked' });
    const ended = (await sessionsOf(account.user.id)).filter((session) => session.revoke_reason === 'step_up_failed');
    expect(ended).toHaveLength(1);
    expect((await events('step_up.failed')).filter((row) => row.reason_code === 'totp_failed')).toHaveLength(5);
    expect((await events('session.revoked')).some((row) => row.reason_code === 'totp_failed')).toBe(true);

    const sixth = await sendStepUp(panel, codeNow(current, account.secret));
    expect(sixth.status).toBe(401);
    expect(sixth.body).toMatchObject({ code: 'session_revoked' });
    // the account is not locked: the person signs in again with the password and the code
    nextStep(current);
    expect((await signInWithTotp(current, account)).response.status).toBe(200);
  });

  it('EVM-023 AC7 the failures are counted per session: another session of the account is not affected', async () => {
    const { account, panel } = await staleSession();
    const other = (await signInWithTotp(current, account, 1)).panel; // a second session of the same person
    current.clock.advance(16 * 60_000);
    nextStep(current);
    for (let attempt = 0; attempt < 5; attempt += 1) await sendStepUp(panel, wrongCode(account.secret));
    expect((await panel.get(PATHS.session)).status).toBe(401);
    expect((await other.get(PATHS.session)).status).toBe(200);
  });

  it('EVM-023 AC3 AC7 an Administrator in the panel cannot step up with a code (403 forbidden): the key is the only way, the session stays as it was', async () => {
    const admin = await signedInAdministrator(current);
    const { secret } = await insertTotpFactor(current, admin.user.id);
    const cookie = admin.panel.cookie;
    nextStep(current);
    const response = await sendStepUp(admin.panel, codeNow(current, secret));
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'forbidden' });
    expect(admin.panel.cookie).toBe(cookie);
    expect((await admin.panel.get(PATHS.session)).status).toBe(200);
  });

  it('EVM-023 AC7 C3 the role is read from the database: an Editor promoted to Administrator meanwhile is refused, whatever the session says', async () => {
    const { account, panel } = await staleSession();
    await sql`update identity.users set role = 'administrator' where id = ${account.user.id}`.execute(current.database.admin);
    nextStep(current);
    const response = await sendStepUp(panel, codeNow(current, account.secret));
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'forbidden' });
  });

  it('EVM-023 AC7 a recovery code is not accepted at a step-up, whatever the field is called; the account must have a code of the app', async () => {
    const { account, panel } = await staleSession();
    nextStep(current);
    for (const body of [
      { method: 'recovery_code', code: account.codes[0] ?? '' },
      { code: account.codes[0] ?? '' },
      { method: 'totp', code: account.codes[0] ?? '' },
      { method: 'totp', code: '123456', userId: account.user.id },
      { method: 'totp' },
    ]) {
      const response = await panel.post(SECOND_STEP.stepUp, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body).toMatchObject({ code: 'validation_failed' });
    }
    // an account without a code of the app has nothing to prove with
    const bare = await signedInAdministrator(current, { role: 'editor' });
    nextStep(current);
    expect((await sendStepUp(bare.panel, '123456')).status).toBe(403);
  });

  it('EVM-023 AC7 AC8 the account is the one of the session: the code of another person does not step up this session (401) and moves nothing for the other', async () => {
    const { panel } = await staleSession();
    const other = await totpAccount(current, { role: 'editor' });
    nextStep(current);
    const response = await sendStepUp(panel, codeNow(current, other.secret));
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'totp_failed' });
    expect(
      Number(
        (await db().selectFrom('identity.totp_factors').select('last_used_step').where('user_id', '=', other.user.id).executeTakeFirst())
          ?.last_used_step,
      ),
    ).toBeLessThan(Math.floor(current.clock.now().getTime() / 30_000));
  });

  it('EVM-023 AC7 two parallel step-ups of one session with one code give one new session', async () => {
    const { account, panel } = await staleSession();
    nextStep(current);
    const code = codeNow(current, account.secret);
    const results = await Promise.all([sendStepUp(panel, code), sendStepUp(panel, code)]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 401]);
    const live = (await sessionsOf(account.user.id)).filter(
      (session) => session.revoked_at === null && session.totp_authenticated_at !== null,
    );
    expect(live.filter((session) => session.totp_authenticated_at?.getTime() === current.clock.now().getTime())).toHaveLength(1);
  });

  it('EVM-023 AC7 the operation needs a session, the origin of the panel and the CSRF token like the passkey step-up', async () => {
    const account: TotpAccount = await totpAccount(current);
    const anonymous = await current.panel().post(SECOND_STEP.stepUp, { method: 'totp', code: '123456' });
    expect(anonymous.status).toBe(401);
    const token = account.panel.csrfToken;
    account.panel.csrfToken = undefined;
    expect((await sendStepUp(account.panel, '123456')).status).toBe(403);
    account.panel.csrfToken = token;
  });
});
