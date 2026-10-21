import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { identityTables } from '../../src/modules/identity/infrastructure/tables.ts';
import {
  ACCOUNT,
  addKey,
  auditOf,
  getAccount,
  outboxOf,
  reauthWithCode,
  reauthWithKey,
  signedInWithCode,
  signedInWithKey,
  withoutTrace,
} from '../support/account-flows.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createUser } from '../support/identity-fixtures.ts';
import { signIn } from '../support/login-flows.ts';
import {
  codeNow,
  everythingWritten,
  generateCodes,
  insertTotpFactor,
  nextStep,
  sendLoginRecoveryCode,
  startLogin,
} from '../support/totp-flows.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

const db = () => identityTables(current.database.admin);
type Keys = Array<{ id: string; name: string; createdAt: string }>;
const keysOf = async (panel: Parameters<typeof getAccount>[0]): Promise<Keys> =>
  ((await getAccount(panel)).body as { secondStep: { passkeys: Keys } }).secondStep.passkeys;
const withMark = (admin: Awaited<ReturnType<typeof signedInWithKey>>) =>
  reauthWithKey(admin.panel, admin.authenticator, 'second_step_change', admin.password);
const notExisting = '00000000-0000-7000-8000-000000000001';
/** The alerts 9 about a change of the second step (the alert of a new browser comes with every sign-in of an Administrator and is not what these tests are about). */
const changeAlerts = async (userId: string) =>
  (await outboxOf(current, userId, 'administrator_alert')).filter((row) => row.variant === 'administrator_second_step_changed');

describe('the page of the account lists the methods (EVM-028 AC3, AC5)', () => {
  it('EVM-028 AC3 the list shows the name and the date of each key; a key made before has the name "Klucz dostępu"; no secret, public key or credential id leaves', async () => {
    const admin = await signedInWithKey(current);
    const response = await getAccount(admin.panel);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ email: admin.email, role: 'administrator', secondStep: { totp: null, recoveryCodes: null } });
    const keys = (response.body as { secondStep: { passkeys: Array<Record<string, unknown>> } }).secondStep.passkeys;
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ name: 'Klucz dostępu', deviceType: expect.any(String) as string });
    expect(Object.keys(keys[0] ?? {}).sort()).toEqual(['backedUp', 'createdAt', 'deviceType', 'id', 'name']);
    await db().updateTable('identity.passkeys').set({ name: null }).execute();
    expect((await keysOf(admin.panel))[0]?.name).toBe('Klucz dostępu');
  });
});

describe('adding a key from the account (EVM-028 AC3; SR-AUTH-09, SR-AUTH-10)', () => {
  it('EVM-028 AC3 after the full re-authentication a second key is added with a name: 201, the session and its cookie stay, the list shows both, e-mail 5 goes to the account and the audit has the event', async () => {
    const admin = await signedInWithKey(current);
    const cookie = admin.panel.cookie;
    expect((await withMark(admin)).status).toBe(204);
    const { options, registered } = await addKey(admin.panel, '  Telefon Jana ');
    expect(options.status).toBe(200);
    expect(registered?.status).toBe(201);
    expect(registered?.body).toMatchObject({ name: 'Telefon Jana' });
    expect(registered?.headers['set-cookie']).toBeUndefined();
    expect(admin.panel.cookie).toBe(cookie);
    expect((await keysOf(admin.panel)).map((key) => key.name)).toEqual(['Klucz dostępu', 'Telefon Jana']);
    expect(await outboxOf(current, admin.user.id, 'mfa_changed')).toEqual([{ kind: 'mfa_changed', variant: 'passkey_enrolled' }]);
    const created = await auditOf(current, 'passkey.registered');
    expect(created.at(-1)).toMatchObject({ outcome: 'success', actor_user_id: admin.user.id });
  });

  it('EVM-028 K10 the options exclude the keys the account already has and ask for user verification; looking at the mark spends nothing, the registration spends it', async () => {
    const admin = await signedInWithKey(current);
    expect((await withMark(admin)).status).toBe(204);
    const first = await admin.panel.post(ACCOUNT.passkeyOptions);
    const second = await admin.panel.post(ACCOUNT.passkeyOptions);
    expect([first.status, second.status]).toEqual([200, 200]);
    const body = second.body as { excludeCredentials?: Array<{ id: string }>; authenticatorSelection?: { userVerification?: string } };
    expect(body.excludeCredentials?.map((entry) => entry.id)).toEqual([admin.authenticator.credentialId.toString('base64url')]);
    expect(body.authenticatorSelection?.userVerification).toBe('required');
    const credential = (await import('../support/virtual-authenticator.ts')).VirtualAuthenticator;
    const registered = await admin.panel.post(ACCOUNT.passkeys, {
      credential: new credential().register(second.body as PublicKeyCredentialCreationOptionsJSON, { origin: 'https://panel.evia.test' }),
    });
    expect(registered.status).toBe(201);
    expect((await admin.panel.post(ACCOUNT.passkeyOptions)).status).toBe(403); // spent
  });

  it('EVM-028 AC3 without the mark a registration is 403 reauthentication_required and stores nothing — the options cannot be had either', async () => {
    const admin = await signedInWithKey(current);
    const { options, registered } = await addKey(admin.panel, 'Telefon');
    expect(options.status).toBe(403);
    expect(registered).toBeUndefined();
    expect(await keysOf(admin.panel)).toHaveLength(1);
  });

  it('EVM-028 K10 a mark that went (spent elsewhere, too old) between the options and the registration refuses the registration and spends nothing', async () => {
    const admin = await signedInWithKey(current);
    expect((await withMark(admin)).status).toBe(204);
    const options = await admin.panel.post(ACCOUNT.passkeyOptions);
    await db().updateTable('identity.sessions').set({ reauthenticated_at: null, reauth_purpose: null }).execute();
    const { VirtualAuthenticator } = await import('../support/virtual-authenticator.ts');
    const registered = await admin.panel.post(ACCOUNT.passkeys, {
      credential: new VirtualAuthenticator().register(options.body as PublicKeyCredentialCreationOptionsJSON, {
        origin: 'https://panel.evia.test',
      }),
    });
    expect(registered.status).toBe(403);
    expect(registered.body).toMatchObject({ code: 'reauthentication_required' });
    expect(await keysOf(admin.panel)).toHaveLength(1);
    const newest = await db()
      .selectFrom('identity.webauthn_challenges')
      .select('used_at')
      .where('purpose', '=', 'passkey_registration')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow();
    expect(newest.used_at).toBeNull();
  });

  it('EVM-028 K11 the name is plain text: a line break, a bidi override and 61 characters are 400 on /name, before the key is looked at, and the mark stays', async () => {
    const admin = await signedInWithKey(current);
    expect((await withMark(admin)).status).toBe(204);
    for (const [name, code] of [
      ['Klucz\nDruga', 'invalid_characters'],
      ['Klucz‮dcba', 'invalid_characters'],
      ['k'.repeat(61), 'too_long'],
      ['   ', 'required'],
    ] as const) {
      const { VirtualAuthenticator } = await import('../support/virtual-authenticator.ts');
      const options = await admin.panel.post(ACCOUNT.passkeyOptions);
      const response = await admin.panel.post(ACCOUNT.passkeys, {
        credential: new VirtualAuthenticator().register(options.body as PublicKeyCredentialCreationOptionsJSON, {
          origin: 'https://panel.evia.test',
        }),
        name,
      });
      expect(response.status, JSON.stringify(name)).toBe(400);
      expect(response.body).toMatchObject({ errors: [{ pointer: '/name', code }] });
    }
    expect((await admin.panel.post(ACCOUNT.passkeyOptions)).status).toBe(200);
    expect(await keysOf(admin.panel)).toHaveLength(1);
  });

  it('EVM-028 K11 the name of a key goes nowhere but the list: not into the e-mail, the audit trail, the outbox or the logs', async () => {
    const admin = await signedInWithKey(current);
    expect((await withMark(admin)).status).toBe(204);
    expect((await addKey(admin.panel, 'Telefon Jana')).registered?.status).toBe(201);
    expect(await everythingWritten(current)).not.toContain('Telefon Jana');
    expect(current.logs.text).not.toContain('Telefon Jana');
  });

  it('EVM-028 AC3 an Editor adds a key too; the e-mail goes to the account and no alert goes to the Administrators', async () => {
    const administrator = await createUser(current.database.admin, current.clock, { role: 'administrator', status: 'active' });
    const editor = await signedInWithKey(current, 'editor');
    expect((await withMark(editor)).status).toBe(204);
    expect((await addKey(editor.panel, 'Tablet')).registered?.status).toBe(201);
    expect(await outboxOf(current, editor.user.id, 'mfa_changed')).toEqual([{ kind: 'mfa_changed', variant: 'passkey_enrolled' }]);
    expect(await changeAlerts(administrator.id)).toEqual([]);
  });

  it('EVM-028 AC3 SR-LOG-07 a change on the account of an Administrator sends the alert to EVERY active Administrator — the one who changed it included', async () => {
    const colleague = await createUser(current.database.admin, current.clock, { role: 'administrator', status: 'active' });
    const inactive = await createUser(current.database.admin, current.clock, { role: 'administrator', status: 'deactivated' });
    const admin = await signedInWithKey(current);
    expect((await withMark(admin)).status).toBe(204);
    expect((await addKey(admin.panel)).registered?.status).toBe(201);
    const alert = [{ kind: 'administrator_alert', variant: 'administrator_second_step_changed' }];
    expect(await changeAlerts(admin.user.id)).toEqual(alert);
    expect(await changeAlerts(colleague.id)).toEqual(alert);
    expect(await changeAlerts(inactive.id)).toEqual([]);
  });
});

describe('removing a method (EVM-028 AC3, AC4; SR-AUTH-10)', () => {
  it('EVM-028 AC3 a key is removed after the re-authentication: 204, the list shrinks, e-mail 5 "usunięto klucz dostępu", the audit event, the alert for an Administrator; the key is gone for good', async () => {
    const admin = await signedInWithKey(current);
    expect((await withMark(admin)).status).toBe(204);
    expect((await addKey(admin.panel, 'Zapasowy')).registered?.status).toBe(201);
    const [first] = await keysOf(admin.panel);
    expect((await withMark(admin)).status).toBe(204);
    const removed = await admin.panel.delete(`${ACCOUNT.passkeys}/${first?.id}`);
    expect(removed.status).toBe(204);
    expect((await keysOf(admin.panel)).map((key) => key.name)).toEqual(['Zapasowy']);
    expect((await outboxOf(current, admin.user.id, 'mfa_changed')).map((row) => row.variant)).toEqual([
      'passkey_enrolled',
      'passkey_removed',
    ]);
    expect((await auditOf(current, 'passkey.removed')).at(-1)).toMatchObject({
      outcome: 'success',
      actor_user_id: admin.user.id,
      object_id: first?.id,
    });
    expect(await changeAlerts(admin.user.id)).toHaveLength(2); // the key added and the key removed
    expect(
      await db()
        .selectFrom('identity.passkeys')
        .select('id')
        .where('id', '=', first?.id ?? '')
        .execute(),
    ).toEqual([]);
  });

  it('EVM-028 AC4 an Administrator with one key cannot remove it: 409 last_second_step_method (passkey_required); the mark is not spent — a second key can be added with it, and then the first removed', async () => {
    const admin = await signedInWithKey(current);
    expect((await withMark(admin)).status).toBe(204);
    const [only] = await keysOf(admin.panel);
    const refused = await admin.panel.delete(`${ACCOUNT.passkeys}/${only?.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'last_second_step_method', errors: [{ pointer: '/passkeyId', code: 'passkey_required' }] });
    expect(await keysOf(admin.panel)).toHaveLength(1);
    expect(await outboxOf(current, admin.user.id, 'mfa_changed')).toEqual([]);
    expect((await addKey(admin.panel, 'Drugi')).registered?.status).toBe(201); // the same mark
    expect((await withMark(admin)).status).toBe(204);
    expect((await admin.panel.delete(`${ACCOUNT.passkeys}/${only?.id}`)).status).toBe(204);
  });

  it('EVM-028 AC4 the code of the app does not count for an Administrator: a key and a code is one method, the last key stays, the code can go', async () => {
    const admin = await signedInWithKey(current);
    await insertTotpFactor(current, admin.user.id);
    expect(((await getAccount(admin.panel)).body as { secondStep: { totp: unknown } }).secondStep.totp).toMatchObject({
      addedAt: expect.any(String) as string,
    });
    expect((await withMark(admin)).status).toBe(204);
    const [only] = await keysOf(admin.panel);
    expect((await admin.panel.delete(`${ACCOUNT.passkeys}/${only?.id}`)).status).toBe(409);
    const removed = await admin.panel.delete(ACCOUNT.totp);
    expect(removed.status).toBe(204);
    expect(await outboxOf(current, admin.user.id, 'mfa_changed')).toEqual([{ kind: 'mfa_changed', variant: 'totp_removed' }]);
    expect((await auditOf(current, 'mfa.totp_removed')).at(-1)).toMatchObject({ outcome: 'success', actor_user_id: admin.user.id });
    expect(await db().selectFrom('identity.totp_factors').select('id').execute()).toEqual([]);
  });

  it('EVM-028 AC4 an Editor with one method cannot remove it (method_required); with a key and a code either can go', async () => {
    const editor = await signedInWithCode(current);
    expect(
      (await reauthWithCode(editor.session, 'second_step_change', (nextStep(current), codeNow(current, editor.secret)), editor.password))
        .status,
    ).toBe(204);
    const refused = await editor.session.delete(ACCOUNT.totp);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'last_second_step_method', errors: [{ pointer: '/totp', code: 'method_required' }] });
    expect((await getAccount(editor.session)).status).toBe(200);
    expect(await db().selectFrom('identity.totp_factors').select('id').execute()).toHaveLength(1);
  });

  it('EVM-028 AC3 an Editor with a key and a code removes the code: 204, e-mail 5, no alert to the Administrators', async () => {
    const administrator = await createUser(current.database.admin, current.clock, { role: 'administrator', status: 'active' });
    const editor = await signedInWithKey(current, 'editor');
    await insertTotpFactor(current, editor.user.id);
    expect((await withMark(editor)).status).toBe(204);
    expect((await editor.panel.delete(ACCOUNT.totp)).status).toBe(204);
    expect(await outboxOf(current, editor.user.id, 'mfa_changed')).toEqual([{ kind: 'mfa_changed', variant: 'totp_removed' }]);
    expect(await changeAlerts(administrator.id)).toEqual([]);
    expect((await withMark(editor)).status).toBe(204);
    const [only] = await keysOf(editor.panel);
    expect((await editor.panel.delete(`${ACCOUNT.passkeys}/${only?.id}`)).body).toMatchObject({ code: 'last_second_step_method' });
  });

  it('EVM-028 AC3 removing needs the mark: 403 reauthentication_required, nothing changes; a code of the app that is not there is 404', async () => {
    const admin = await signedInWithKey(current);
    const [only] = await keysOf(admin.panel);
    const response = await admin.panel.delete(`${ACCOUNT.passkeys}/${only?.id}`);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'reauthentication_required' });
    expect((await admin.panel.delete(ACCOUNT.totp)).status).toBe(403);
    expect((await withMark(admin)).status).toBe(204);
    expect((await admin.panel.delete(ACCOUNT.totp)).status).toBe(404);
    expect(await keysOf(admin.panel)).toHaveLength(1);
  });

  it('EVM-028 AC8 K6 the key of somebody else and a key that does not exist are ONE answer — the same status and the same body — and the key of the other account stays', async () => {
    const admin = await signedInWithKey(current);
    const stranger = await signedInWithKey(current, 'editor');
    const [theirs] = await keysOf(stranger.panel);
    expect((await withMark(admin)).status).toBe(204);
    const foreign = await admin.panel.delete(`${ACCOUNT.passkeys}/${theirs?.id}`);
    const missing = await admin.panel.delete(`${ACCOUNT.passkeys}/${notExisting}`);
    expect([foreign.status, missing.status]).toEqual([404, 404]);
    expect(withoutTrace(foreign.body)).toEqual(withoutTrace(missing.body));
    expect(await keysOf(stranger.panel)).toHaveLength(1);
    // the mark was not spent by the refusals: the owner's own removal still has it (rule of AC4 aside)
    expect((await admin.panel.delete(ACCOUNT.totp)).status).toBe(404);
  });

  it('EVM-028 AC4 K7 two parallel removals of the last two keys of an Administrator: exactly one wins, the account keeps a key', async () => {
    const admin = await signedInWithKey(current);
    expect((await withMark(admin)).status).toBe(204);
    expect((await addKey(admin.panel, 'Drugi')).registered?.status).toBe(201);
    const [a, b] = await keysOf(admin.panel);
    // two sessions of the same account, each with its own mark
    const other = current.panel();
    nextStep(current);
    expect((await signIn(other, admin)).status).toBe(200);
    expect((await withMark(admin)).status).toBe(204);
    expect((await reauthWithKey(other, admin.authenticator, 'second_step_change', admin.password)).status).toBe(204);
    const [first, second] = await Promise.all([
      admin.panel.delete(`${ACCOUNT.passkeys}/${a?.id}`),
      other.delete(`${ACCOUNT.passkeys}/${b?.id}`),
    ]);
    expect([first.status, second.status].sort()).toEqual([204, 409]);
    expect(await db().selectFrom('identity.passkeys').select('id').where('user_id', '=', admin.user.id).execute()).toHaveLength(1);
  });
});

describe('adding a code of the app from the account (EVM-028 AC3; SR-AUTH-07, SR-AUTH-10)', () => {
  it('EVM-028 AC3 an Editor with a key: after the re-authentication the setup gives a secret, the right code confirms it — no new cookie, the same CSRF token, e-mail 5, the audit event; the list shows the code', async () => {
    const editor = await signedInWithKey(current, 'editor');
    expect((await withMark(editor)).status).toBe(204);
    const csrf = editor.panel.csrfToken;
    const setup = await editor.panel.post(ACCOUNT.totpEnrolment);
    expect(setup.status).toBe(200);
    expect(setup.headers['cache-control']).toBe('no-store');
    const { secret } = setup.body as { secret: string };
    const wrong = codeNow(current, secret) === '000000' ? '000001' : '000000';
    const bad = await editor.panel.post(ACCOUNT.totpConfirm, { code: wrong });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ code: 'totp_verification_failed' });
    const confirmed = await editor.panel.post(ACCOUNT.totpConfirm, { code: codeNow(current, secret) });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toEqual({ state: 'active', csrfToken: csrf });
    expect(confirmed.headers['set-cookie']).toBeUndefined();
    expect(((await getAccount(editor.panel)).body as { secondStep: { totp: unknown } }).secondStep.totp).toMatchObject({
      addedAt: expect.any(String) as string,
    });
    expect(await outboxOf(current, editor.user.id, 'mfa_changed')).toEqual([{ kind: 'mfa_changed', variant: 'totp_enrolled' }]);
    expect((await auditOf(current, 'mfa.totp_enrolled')).map((event) => event.outcome)).toEqual(['failed', 'success']);
    // spent: a second setup needs a new mark
    expect((await editor.panel.post(ACCOUNT.totpEnrolment)).status).toBe(403);
  });

  it('EVM-028 AC3 an Editor who already has a code cannot start another setup (409, no secret); an Administrator never can (403 forbidden); without the mark it is 403 reauthentication_required', async () => {
    const editor = await signedInCodeEditor();
    nextStep(current);
    const noMark = await editor.session.post(ACCOUNT.totpEnrolment);
    expect(noMark.status).toBe(403);
    expect(noMark.body).toMatchObject({ code: 'reauthentication_required' });
    expect((await reauthWithCode(editor.session, 'second_step_change', codeNow(current, editor.secret), editor.password)).status).toBe(204);
    const again = await editor.session.post(ACCOUNT.totpEnrolment);
    expect(again.status).toBe(409);
    expect(JSON.stringify(again.body)).not.toContain(editor.secret);
    const admin = await signedInWithKey(current);
    expect((await admin.panel.post(ACCOUNT.totpEnrolment)).body).toMatchObject({ code: 'forbidden' });
  });

  async function signedInCodeEditor() {
    return signedInWithCode(current);
  }
});

describe('new recovery codes from the account (EVM-028 AC5; SR-AUTH-08, SR-AUTH-10)', () => {
  it('EVM-028 AC5 after the re-authentication ten new codes are shown once; the earlier ones stop working; the page shows how many are left; e-mail 5, the audit event', async () => {
    const editor = await signedInWithCode(current);
    expect(editor.codes).toHaveLength(10);
    nextStep(current);
    // this session did not make the codes: without the mark it is the old refusal of the third step
    const refused = await generateCodes(editor.session);
    expect(refused.response.status).toBe(403);
    expect(refused.response.body).toMatchObject({ code: 'recovery_codes_regeneration_unavailable' });
    expect((await reauthWithCode(editor.session, 'second_step_change', codeNow(current, editor.secret), editor.password)).status).toBe(204);
    const generated = await generateCodes(editor.session);
    expect(generated.response.status).toBe(200);
    expect(generated.response.headers['cache-control']).toBe('no-store');
    expect(generated.codes).toHaveLength(10);
    expect(generated.codes.some((code) => editor.codes.includes(code))).toBe(false);
    const account = (await getAccount(editor.session)).body as {
      secondStep: { recoveryCodes: { remaining: number; generatedAt: string } };
    };
    expect(account.secondStep.recoveryCodes.remaining).toBe(10);
    // an old code no longer signs in; a new one does
    const browser = current.panel();
    nextStep(current);
    const oldLogin = await sendLoginRecoveryCode(browser, await startLogin(browser, editor), editor.codes[0] ?? '');
    expect(oldLogin.status).toBe(401);
    const newLogin = await sendLoginRecoveryCode(browser, await startLogin(browser, editor), generated.codes[0] ?? '');
    expect(newLogin.status).toBe(200);
    expect((await outboxOf(current, editor.user.id, 'mfa_changed')).map((row) => row.variant)).toContain('recovery_codes_generated');
    expect((await auditOf(current, 'mfa.recovery_codes_generated')).length).toBeGreaterThanOrEqual(2);
    // the codes are in no record
    const written = await everythingWritten(current);
    for (const code of generated.codes) expect(written).not.toContain(code);
  });

  it('EVM-028 AC5 the mark is spent by the generation: the next one asks again; the setup rule (the same session that made them) is not needed with the mark', async () => {
    const admin = await signedInWithKey(current);
    expect((await withMark(admin)).status).toBe(204);
    expect((await generateCodes(admin.panel)).response.status).toBe(200);
    // the same session made them: the old rule of the third step still lets it refresh them inside the window
    expect((await generateCodes(admin.panel)).response.status).toBe(200);
    expect((await withMark(admin)).status).toBe(204);
    expect((await generateCodes(admin.panel)).response.status).toBe(200);
  });

  it('EVM-028 AC5 an account without codes (made before) generates the first ones; the page showed none; an Administrator gets the alert for new codes from the account', async () => {
    const colleague = await createUser(current.database.admin, current.clock, { role: 'administrator', status: 'active' });
    const admin = await signedInWithKey(current);
    expect(((await getAccount(admin.panel)).body as { secondStep: { recoveryCodes: unknown } }).secondStep.recoveryCodes).toBeNull();
    expect((await withMark(admin)).status).toBe(204);
    const generated = await generateCodes(admin.panel);
    expect(generated.response.status).toBe(200);
    expect(
      ((await getAccount(admin.panel)).body as { secondStep: { recoveryCodes: { remaining: number } } }).secondStep.recoveryCodes.remaining,
    ).toBe(10);
    expect(await changeAlerts(colleague.id)).toHaveLength(1);
  });

  it('EVM-028 AC5 a session without the mark and without a fresh window is asked for the step-up first (403 step_up_required)', async () => {
    const admin = await signedInWithKey(current);
    current.clock.advance(16 * 60_000);
    const response = await generateCodes(admin.panel);
    expect(response.response.status).toBe(403);
    expect(response.response.body).toMatchObject({ code: 'step_up_required' });
    // with the mark no window is needed
    expect((await withMark(admin)).status).toBe(204);
    expect((await generateCodes(admin.panel)).response.status).toBe(200);
  });
});
