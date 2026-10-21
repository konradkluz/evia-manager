import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { identityTables } from '../../src/modules/identity/infrastructure/tables.ts';
import { ACCOUNT, auditOf, getAccount, signedInWithKey } from '../support/account-flows.ts';
import { PATHS } from '../support/flows.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { everythingWritten } from '../support/totp-flows.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

const db = () => identityTables(current.database.admin);

describe('the profile (EVM-028 AC1; SR-DATA-03, SR-INPUT-01, SR-INPUT-07)', () => {
  it('EVM-028 AC1 a new name is seen in the header (the session) and by the other users (only id and displayName); the e-mail, the role and the version stay', async () => {
    const admin = await signedInWithKey(current);
    const colleague = await signedInWithKey(current, 'editor');
    const before = await db()
      .selectFrom('identity.users')
      .select(['email', 'role', 'version'])
      .where('id', '=', admin.user.id)
      .executeTakeFirstOrThrow();

    const response = await admin.panel.patch(ACCOUNT.account, { displayName: '  Anna Nowak-Wiśniewska  ' });
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({ displayName: 'Anna Nowak-Wiśniewska', email: admin.email, role: 'administrator' });

    expect((await admin.panel.get(PATHS.session)).body).toMatchObject({
      user: { id: admin.user.id, displayName: 'Anna Nowak-Wiśniewska' },
    });
    expect(((await getAccount(admin.panel)).body as { displayName: string }).displayName).toBe('Anna Nowak-Wiśniewska');
    const listed = await colleague.panel.get(ACCOUNT.assignable);
    const entry = (listed.body as { items: Array<Record<string, unknown>> }).items.find((item) => item['id'] === admin.user.id);
    expect(entry).toEqual({ id: admin.user.id, displayName: 'Anna Nowak-Wiśniewska' });
    const after = await db()
      .selectFrom('identity.users')
      .select(['email', 'role', 'version'])
      .where('id', '=', admin.user.id)
      .executeTakeFirstOrThrow();
    expect(after).toEqual(before);
  });

  it('EVM-028 AC1 the name is checked as the name of an invitation: empty is required, 201 characters too_long, a line break or a bidi override invalid_characters — and nothing changes', async () => {
    const admin = await signedInWithKey(current);
    const name = async () => ((await getAccount(admin.panel)).body as { displayName: string }).displayName;
    const original = await name();
    for (const [value, code] of [
      ['   ', 'required'],
      ['a'.repeat(201), 'too_long'],
      ['Jan\nKowalski', 'invalid_characters'],
      ['Jan‮Kowalski', 'invalid_characters'],
      ['Jan​Kowalski', 'invalid_characters'],
    ] as const) {
      const response = await admin.panel.patch(ACCOUNT.account, { displayName: value });
      expect(response.status, JSON.stringify(value)).toBe(400);
      expect(response.body).toMatchObject({ code: 'validation_failed', errors: [{ pointer: '/displayName', code }] });
    }
    expect((await admin.panel.patch(ACCOUNT.account, { displayName: 'a'.repeat(200) })).status).toBe(200);
    expect(await name()).toBe('a'.repeat(200));
    expect(original).not.toBe('a'.repeat(200));
  });

  it('EVM-028 AC8 the body names no account: a userId (or any other field) is 400 unknown_field, and the account of another person is never touched', async () => {
    const admin = await signedInWithKey(current);
    const stranger = await signedInWithKey(current, 'editor');
    const before = await db()
      .selectFrom('identity.users')
      .select('display_name')
      .where('id', '=', stranger.user.id)
      .executeTakeFirstOrThrow();
    const response = await admin.panel.patch(ACCOUNT.account, { displayName: 'Przejęte', userId: stranger.user.id });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ errors: [{ pointer: '/userId', code: 'unknown_field' }] });
    expect((await admin.panel.patch(ACCOUNT.account, { displayName: 'Przejęte', role: 'read_only' })).status).toBe(400);
    const after = await db()
      .selectFrom('identity.users')
      .select('display_name')
      .where('id', '=', stranger.user.id)
      .executeTakeFirstOrThrow();
    expect(after).toEqual(before);
    expect((await current.panel().patch(ACCOUNT.account, { displayName: 'Anonim' })).status).toBe(401);
  });

  it('EVM-028 AC1 K12 the change is audited WITHOUT the name — neither the old nor the new — and the name is in no log, outbox or alert', async () => {
    const admin = await signedInWithKey(current);
    const oldName = ((await getAccount(admin.panel)).body as { displayName: string }).displayName;
    expect((await admin.panel.patch(ACCOUNT.account, { displayName: 'Zofia Wyjątkowa-Nazwa' })).status).toBe(200);
    expect(await auditOf(current, 'account.profile_updated')).toEqual([
      { outcome: 'success', reason_code: null, actor_user_id: admin.user.id, object_id: admin.user.id },
    ]);
    const written = await everythingWritten(current);
    for (const text of ['Zofia Wyjątkowa-Nazwa', oldName]) {
      expect(written).not.toContain(text);
      expect(current.logs.text).not.toContain(text);
    }
  });
});
