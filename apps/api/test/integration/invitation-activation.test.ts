import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PATHS, passkeyOptions, registerPasskey, setPassword } from '../support/flows.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { auditActions, browserOf, emailHarness, invite, inviteBody, linkIn, linksOf, outboxRows } from '../support/invitation-fixtures.ts';
import { VirtualAuthenticator } from '../support/virtual-authenticator.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

/** An invitation as the Administrator sends it and the worker delivers it: the account and the token the person finds in the mail. */
async function invitedPerson(role: 'editor' | 'administrator' | 'read_only') {
  const admin = await browserOf(current);
  const body = inviteBody({ role, email: `osoba-${role}@example.com` });
  expect((await invite(admin, body)).status).toBe(201);
  const { job, sender } = emailHarness(current);
  const [row] = await outboxRows(current, { recipient: body.id, kind: 'user_invitation' });
  await job.run({ ids: [row?.id ?? ''] });
  const { token } = linkIn(sender.sent.at(-1)?.text ?? '');
  return { admin, body, token };
}

describe('the activation of an invited account (EVM-024 AC3; SR-AUTH-01, SR-AUTH-02, SR-AUTH-06, SR-API-04, SR-LOG-02)', () => {
  it('EVM-024 AC3 an invited Editor and an invited Administrator open W-13 (the check does not use the link up), set the password, register the key and the account is active; the link no longer works', async () => {
    for (const role of ['editor', 'administrator'] as const) {
      const { body, token } = await invitedPerson(role);
      const person = current.panel();

      for (let time = 0; time < 3; time += 1) {
        const check = await person.post(PATHS.check, { token });
        expect(check.status).toBe(200);
        expect(check.body).toEqual({ email: `osoba-${role}@example.com`, role });
      }
      expect((await linksOf(current, body.id))[0]?.used_at).toBeNull();

      expect((await setPassword(person, token)).status).toBe(200);
      const status = async () =>
        (await sql<{ status: string }>`select status from identity.users where id = ${body.id}`.execute(current.database.admin)).rows[0]
          ?.status;
      expect(await status()).toBe('invited'); // not yet: the second step is still to do (SR-AUTH-06)

      const { response, options } = await passkeyOptions(person);
      expect(response.status).toBe(200);
      expect(options.authenticatorSelection).toMatchObject({ userVerification: 'required' });
      expect((await registerPasskey(person, options, new VirtualAuthenticator())).status).toBe(201);

      expect(await status()).toBe('active');
      const [link] = await linksOf(current, body.id);
      expect(link?.used_at).not.toBeNull();
      const again = await current.panel().post(PATHS.check, { token });
      expect(again.status).toBe(400);
      expect(again.body).toMatchObject({ code: 'activation_link_invalid' });
      const actions = (await auditActions(current))
        .filter((event) => event.object_id === body.id || event.actor_user_id === body.id)
        .map((event) => event.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'user.invited',
          'activation_link.issued',
          'account.password_set',
          'passkey.registered',
          'account.activated',
        ]),
      );
    }
  });

  it('EVM-024 AC3 until the second step is done every other request of the new account is 403 mfa_enrollment_required', async () => {
    const { token } = await invitedPerson('editor');
    const person = current.panel();
    expect((await setPassword(person, token)).status).toBe(200);
    for (const path of ['/api/v1/work-orders', '/api/v1/customers', '/api/v1/users/assignable', '/api/v1/users']) {
      const response = await person.get(path);
      expect(response.status, path).toBe(403);
      expect(response.body).toMatchObject({ code: 'mfa_enrollment_required' });
    }
    expect((await person.get(PATHS.session)).status).toBe(200);
  });

  it('EVM-024 AC3 the token is sent only in the body of a POST: it is in no log of the API, no audit event and no stored row except as a hash — and the check by a mail scanner changes nothing', async () => {
    const { token } = await invitedPerson('editor');
    const before = JSON.stringify((await sql`select * from identity.one_time_links`.execute(current.database.admin)).rows);
    const person = current.panel();
    expect((await person.post(PATHS.check, { token })).status).toBe(200);
    expect(JSON.stringify((await sql`select * from identity.one_time_links`.execute(current.database.admin)).rows)).toBe(before);
    expect((await setPassword(person, token)).status).toBe(200);
    // the token in the address (a scanner or a mistake) is no way in: a GET with it is a route that does not exist
    expect((await current.panel().get(`/api/v1/auth/activation/check?token=${token}`)).status).toBeGreaterThanOrEqual(400);

    expect(JSON.stringify(current.logs.entries)).not.toContain(token);
    const stored = await sql<{ row: string }>`select to_jsonb(t)::text as row from audit.events t`.execute(current.database.admin);
    expect(stored.rows.map((row) => row.row).join(String.fromCharCode(10))).not.toContain(token);
  });

  it('EVM-024 AC3 an account that was invited with the role Tylko odczyt activates the same way (the role comes from the invitation, never from the request of the person)', async () => {
    const { body, token } = await invitedPerson('read_only');
    const person = current.panel();
    const check = await person.post(PATHS.check, { token, role: 'administrator' });
    expect(check.status).toBe(400); // a field outside the schema is refused
    expect((await person.post(PATHS.check, { token })).body).toMatchObject({ role: 'read_only' });
    const roles = await sql<{ role: string }>`select role from identity.users where id = ${body.id}`.execute(current.database.admin);
    expect(roles.rows).toEqual([{ role: 'read_only' }]);
  });
});
