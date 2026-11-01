import { AUTHZ_MANIFEST } from '@evia/contracts/authz';
import { sql } from 'kysely';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createMobileSession } from '../support/identity-fixtures.ts';
import { browserOf, auditActions, type Browser } from '../support/invitation-fixtures.ts';
import { deviceRow, MOBILE, newPhone, signedInPhone, signInPhone } from '../support/mobile-flows.ts';
import { totpAccount } from '../support/totp-flows.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

const OWN = '/api/v1/account/devices';
const DEVICES = '/api/v1/devices';
const problemOf = (response: { body: unknown }): string => (response.body as { code: string }).code;
const withoutTrace = (body: unknown): Record<string, unknown> => {
  return Object.fromEntries(Object.entries(body as Record<string, unknown>).filter(([key]) => key !== 'traceId'));
};

/** A device of a fresh account with a session and an access token, written straight into the database. */
async function deviceOf(browser: Browser, model: string = 'Pixel 8') {
  const created = await createMobileSession(current.database.admin, current.clock, browser.user);
  await sql`update identity.devices set model = ${model} where id = ${created.deviceId}`.execute(current.database.admin);
  return created;
}

/** What the phone gets for a request with its access token (the configuration of the app is open to any signed-in phone). */
const asPhone = (bearer: string) => newPhone(current).get(MOBILE.config, { Authorization: `Bearer ${bearer}` });

const CSRF_HEADERS = { Origin: PANEL_ORIGIN, 'Sec-Fetch-Site': 'same-origin' } as const;

describe('EVM-095 AC1 my devices (W-15)', () => {
  it('EVM-095 AC1 the Editor sees only THEIR phones, with the fields of the contract and nothing else; the state is Active', async () => {
    const editor = await browserOf(current, { role: 'editor', key: 'none' });
    const other = await browserOf(current, { role: 'editor', key: 'none' });
    const mine = await deviceOf(editor);
    await deviceOf(other, 'Galaxy S24');
    const response = await editor.panel.get(OWN);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const items = (response.body as { items: Array<Record<string, unknown>> }).items;
    expect(items).toHaveLength(1);
    expect(Object.keys(items[0] ?? {}).sort()).toEqual(['appVersion', 'createdAt', 'id', 'lastContactAt', 'model', 'osVersion', 'state']);
    expect(items[0]).toMatchObject({ id: mine.deviceId, model: 'Pixel 8', state: 'active' });
  });

  it('EVM-095 AC1 Read-only gets 403 forbidden with no data; an anonymous caller 401', async () => {
    const reader = await browserOf(current, { role: 'read_only', key: 'none' });
    const response = await reader.panel.get(OWN);
    expect(response.status).toBe(403);
    expect(problemOf(response)).toBe('forbidden');
    expect((response.body as { items?: unknown }).items).toBeUndefined();
    expect((await request(current.app.getHttpServer()).get(OWN)).status).toBe(401);
  });

  it('EVM-095 AC1 AC3 logging out a phone needs a fresh step-up (403 step_up_required), then ends its session: the next request of the phone is 401 session_revoked and the state is Signed out', async () => {
    const editor = await browserOf(current, { role: 'editor', key: 'stale' });
    const phone = await deviceOf(editor);
    const refused = await editor.panel.post(`${OWN}/${phone.deviceId}/logout`);
    expect(refused.status).toBe(403);
    expect(problemOf(refused)).toBe('step_up_required');
    expect((await asPhone(phone.bearer)).status).toBe(200);

    const fresh = await browserOf(current, { role: 'editor', key: 'fresh' });
    const own = await deviceOf(fresh);
    const done = await fresh.panel.post(`${OWN}/${own.deviceId}/logout`);
    expect(done.status).toBe(204);
    expect(done.headers['cache-control']).toBe('no-store');
    const after = await asPhone(own.bearer);
    expect(after.status).toBe(401);
    expect(problemOf(after)).toBe('session_revoked');
    expect(((await fresh.panel.get(OWN)).body as { items: Array<{ state: string }> }).items[0]?.state).toBe('signed_out');
    // the encrypted queue is the phone's: the register keeps the device, only the session is over
    expect(await deviceRow(current, own.deviceId)).toMatchObject({ state: 'active', removed_at: null });
  });

  it('EVM-095 AC1 AC6 a device of somebody else, one that does not exist and one removed from the register are the SAME 404 - byte for byte', async () => {
    const editor = await browserOf(current, { role: 'editor', key: 'fresh' });
    const stranger = await browserOf(current, { role: 'editor', key: 'fresh' });
    const foreign = await deviceOf(stranger);
    const removed = await deviceOf(editor);
    await sql`update identity.devices set removed_at = now() where id = ${removed.deviceId}`.execute(current.database.admin);
    const responses = [];
    for (const id of [foreign.deviceId, '00000000-0000-7000-8000-00000000abcd', removed.deviceId]) {
      responses.push(await editor.panel.post(`${OWN}/${id}/logout`));
    }
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(problemOf(response)).toBe('not_found');
    }
    expect(responses.map((response) => JSON.stringify(withoutTrace(response.body)))).toEqual(
      Array(3).fill(JSON.stringify(withoutTrace(responses[0]?.body))),
    );
    // the phone of the stranger is untouched
    expect((await asPhone(foreign.bearer)).status).toBe(200);
  });

  it('EVM-095 AC1 AC6 a bad identifier is 400 validation_failed (the path is strict)', async () => {
    const editor = await browserOf(current, { role: 'editor', key: 'fresh' });
    expect((await editor.panel.post(`${OWN}/not-a-uuid/logout`)).status).toBe(400);
  });
});

describe('EVM-095 AC2 the devices of all users (W-17)', () => {
  it("EVM-095 AC2 the Administrator sees every user's phones with the owner as userId and displayName, the patch level and the state - and no secret", async () => {
    const admin = await browserOf(current, { role: 'administrator', key: 'fresh', displayName: 'Anna Admin' });
    const technician = await browserOf(current, { role: 'editor', key: 'none', displayName: 'Tomasz Technik' });
    const device = await deviceOf(technician);
    await sql`update identity.devices set security_patch = '2024-01-05', pending_items_reported = 3 where id = ${device.deviceId}`.execute(
      current.database.admin,
    );
    const response = await admin.panel.get(DEVICES);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const page = response.body as { items: Array<Record<string, unknown>>; nextCursor: string | null };
    expect(page.nextCursor).toBeNull();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: device.deviceId,
      user: { userId: technician.user.id, displayName: 'Tomasz Technik' },
      model: 'Pixel 8',
      patchLevel: 'older_12m',
      state: 'active',
      pendingItemsReported: 3,
    });
    const text = JSON.stringify(response.body);
    for (const forbidden of ['secret', 'hash', 'public', 'token', 'ip', 'serial', 'imei', 'email']) {
      expect(
        Object.keys(page.items[0] ?? {})
          .join(' ')
          .toLowerCase(),
        forbidden,
      ).not.toContain(forbidden);
    }
    expect(text).not.toContain(technician.user.email);
  });

  it('EVM-095 AC2 Editor and Read-only get 403 forbidden (never step_up_required) and no data; the Administrator with a stale key gets step_up_required', async () => {
    for (const role of ['editor', 'read_only'] as const) {
      const browser = await browserOf(current, { role, key: 'fresh' });
      const response = await browser.panel.get(DEVICES);
      expect(response.status).toBe(403);
      expect(problemOf(response)).toBe('forbidden');
      expect((response.body as { items?: unknown }).items).toBeUndefined();
    }
    const stale = await browserOf(current, { role: 'administrator', key: 'stale' });
    const response = await stale.panel.get(DEVICES);
    expect(response.status).toBe(403);
    expect(problemOf(response)).toBe('step_up_required');
  });

  it('EVM-095 AC2 filters by owner and by state, pages with an opaque cursor; a changed cursor, a cursor with other filters and a bad limit are refused', async () => {
    const admin = await browserOf(current, { role: 'administrator', key: 'fresh' });
    const first = await browserOf(current, { role: 'editor', key: 'none' });
    const second = await browserOf(current, { role: 'editor', key: 'none' });
    const a = await deviceOf(first);
    current.clock.advance(1000);
    const b = await deviceOf(second, 'Galaxy S24');
    await sql`update identity.devices set last_contact_at = ${current.clock.now()} where id = ${b.deviceId}`.execute(
      current.database.admin,
    );
    await sql`update identity.sessions set revoked_at = now(), revoke_reason = 'logout' where device_id = ${a.deviceId}`.execute(
      current.database.admin,
    );

    const owner = await admin.panel.get(`${DEVICES}?userId=${second.user.id}`);
    expect((owner.body as { items: Array<{ id: string }> }).items.map((item) => item.id)).toEqual([b.deviceId]);
    const signedOut = await admin.panel.get(`${DEVICES}?state=signed_out`);
    expect((signedOut.body as { items: Array<{ id: string }> }).items.map((item) => item.id)).toEqual([a.deviceId]);

    const page1 = await admin.panel.get(`${DEVICES}?limit=1`);
    const { items, nextCursor } = page1.body as { items: Array<{ id: string }>; nextCursor: string };
    expect(items.map((item) => item.id)).toEqual([b.deviceId]);
    expect(nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    const page2 = await admin.panel.get(`${DEVICES}?limit=1&cursor=${nextCursor}`);
    expect((page2.body as { items: Array<{ id: string }>; nextCursor: null }).items.map((item) => item.id)).toEqual([a.deviceId]);
    expect((page2.body as { nextCursor: null }).nextCursor).toBeNull();

    const tampered = `${nextCursor.slice(0, -2)}${nextCursor.endsWith('AA') ? 'BB' : 'AA'}`;
    expect(problemOf(await admin.panel.get(`${DEVICES}?limit=1&cursor=${tampered}`))).toBe('invalid_cursor');
    expect(problemOf(await admin.panel.get(`${DEVICES}?limit=1&state=active&cursor=${nextCursor}`))).toBe('invalid_cursor');
    for (const query of ['limit=0', 'limit=101', 'userId=nope', 'state=lost', 'cursor=!!!']) {
      expect((await admin.panel.get(`${DEVICES}?${query}`)).status, query).toBe(400);
    }
  });

  it('EVM-095 AC2 AC6 a cursor of one Administrator does not open for another', async () => {
    const admin = await browserOf(current, { role: 'administrator', key: 'fresh' });
    const second = await browserOf(current, { role: 'administrator', key: 'fresh' });
    const owner = await browserOf(current, { role: 'editor', key: 'none' });
    await deviceOf(owner);
    await deviceOf(owner, 'Galaxy S24');
    const { nextCursor } = (await admin.panel.get(`${DEVICES}?limit=1`)).body as { nextCursor: string };
    expect(problemOf(await second.panel.get(`${DEVICES}?limit=1&cursor=${nextCursor}`))).toBe('invalid_cursor');
  });

  it('EVM-095 AC2 AC6 reading the list is audited: device.list_read without the values of the filters', async () => {
    const admin = await browserOf(current, { role: 'administrator', key: 'fresh' });
    const owner = await browserOf(current, { role: 'editor', key: 'none' });
    await deviceOf(owner);
    await admin.panel.get(`${DEVICES}?userId=${owner.user.id}`);
    const events = (await auditActions(current)).filter((event) => event.action === 'device.list_read');
    expect(events).toMatchObject([{ actor_user_id: admin.user.id, outcome: 'success', object_id: null }]);
    const { rows } = await sql<{
      text: string;
    }>`select to_jsonb(t)::text as text from audit.events t where action = 'device.list_read'`.execute(current.database.admin);
    expect(rows[0]?.text).not.toContain(owner.user.id);
  });
});

describe('EVM-095 AC3 logout of a device', () => {
  it('EVM-095 AC3 the Administrator logs out a phone: 401 session_revoked, the refresh is refused, the state stays and the slot of the limit is free', async () => {
    const admin = await browserOf(current, { role: 'administrator', key: 'fresh' });
    const account = await totpAccount(current);
    const first = await signedInPhone(current, account);
    await signedInPhone(current, account);
    const response = await admin.panel.post(`${DEVICES}/${first.deviceId}/logout`);
    expect(response.status).toBe(204);
    expect(response.headers['cache-control']).toBe('no-store');
    const refused = await first.get(MOBILE.config, first.authorised());
    expect(refused.status).toBe(401);
    expect(problemOf(refused)).toBe('session_revoked');
    expect(problemOf(await first.refresh())).toBe('session_revoked');
    expect(await deviceRow(current, first.deviceId ?? '')).toMatchObject({ state: 'active' });
    // a third phone fits now (the limit counts devices with a valid session)
    const third = newPhone(current);
    expect((await signInPhone(current, third, account)).second.status).toBe(200);
    const events = (await auditActions(current)).filter((event) => event.action === 'device.logged_out');
    expect(events).toMatchObject([{ actor_user_id: admin.user.id, object_id: first.deviceId, reason_code: 'manual', outcome: 'success' }]);
  });

  it('EVM-095 AC3 AC6 an unknown device is 404 for the Administrator, a bad identifier 400; the Editor and Read-only are 403 forbidden', async () => {
    const admin = await browserOf(current, { role: 'administrator', key: 'fresh' });
    expect((await admin.panel.post(`${DEVICES}/00000000-0000-7000-8000-00000000abcd/logout`)).status).toBe(404);
    expect((await admin.panel.post(`${DEVICES}/nope/logout`)).status).toBe(400);
    for (const role of ['editor', 'read_only'] as const) {
      const browser = await browserOf(current, { role, key: 'fresh' });
      const response = await browser.panel.post(`${DEVICES}/00000000-0000-7000-8000-00000000abcd/logout`);
      expect(response.status).toBe(403);
      expect(problemOf(response)).toBe('forbidden');
    }
  });

  it('EVM-095 AC3 AC6 a mutation without the CSRF token is 403 csrf_failed and changes nothing', async () => {
    const admin = await browserOf(current, { role: 'administrator', key: 'fresh' });
    const owner = await browserOf(current, { role: 'editor', key: 'none' });
    const phone = await deviceOf(owner);
    for (const path of [`${DEVICES}/${phone.deviceId}/logout`, `${DEVICES}/${phone.deviceId}/wipe`]) {
      const response = await request(current.app.getHttpServer())
        .post(path)
        .set(CSRF_HEADERS)
        .set('Cookie', admin.panel.cookieHeader() ?? '')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ confirmModel: 'Pixel 8' }));
      expect(response.status, path).toBe(403);
      expect(problemOf(response)).toBe('csrf_failed');
    }
    expect((await asPhone(phone.bearer)).status).toBe(200);
    expect(await deviceRow(current, phone.deviceId)).toMatchObject({ state: 'active' });
  });
});

describe('EVM-095 AC4 lock and wipe', () => {
  it('EVM-095 AC4 the summary gives the devices, the active ones and the sum of the reported unsent items (audited); 404 for an unknown user', async () => {
    const admin = await browserOf(current, { role: 'administrator', key: 'fresh' });
    const owner = await browserOf(current, { role: 'editor', key: 'none' });
    const one = await deviceOf(owner);
    const two = await deviceOf(owner, 'Galaxy S24');
    await sql`update identity.devices set pending_items_reported = 4 where id = ${one.deviceId}`.execute(current.database.admin);
    await sql`update identity.devices set pending_items_reported = 7, state = 'wiped' where id = ${two.deviceId}`.execute(
      current.database.admin,
    );
    const response = await admin.panel.get(`/api/v1/users/${owner.user.id}/devices/summary`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ devices: 2, activeDevices: 1, pendingItemsReported: 11 });
    expect((await admin.panel.get('/api/v1/users/00000000-0000-7000-8000-00000000abcd/devices/summary')).status).toBe(404);
    const editor = await browserOf(current, { role: 'editor', key: 'fresh' });
    expect((await editor.panel.get(`/api/v1/users/${owner.user.id}/devices/summary`)).status).toBe(403);
  });

  it('EVM-095 AC4 a model typed wrong (or in the wrong case) is 400 device_model_mismatch with no echo and changes nothing; trim and NFC are forgiven', async () => {
    const admin = await browserOf(current, { role: 'administrator', key: 'fresh' });
    const owner = await browserOf(current, { role: 'editor', key: 'none' });
    const composed = 'Zażółć'.normalize('NFC');
    const phone = await deviceOf(owner, composed);
    for (const typed of ['zażółć', 'Pixel 8', 'Zażółć 2']) {
      const response = await admin.panel.post(`${DEVICES}/${phone.deviceId}/wipe`, { confirmModel: typed });
      expect(response.status, typed).toBe(400);
      expect(problemOf(response)).toBe('device_model_mismatch');
      expect(JSON.stringify(response.body)).not.toContain(typed);
    }
    expect(await deviceRow(current, phone.deviceId)).toMatchObject({ state: 'active' });
    expect((await asPhone(phone.bearer)).status).toBe(200);
    const decomposed = `  ${'Zażółć'.normalize('NFD')}  `;
    expect((await admin.panel.post(`${DEVICES}/${phone.deviceId}/wipe`, { confirmModel: decomposed })).status).toBe(204);
  });

  it('EVM-095 AC4 the body is strict: no body, an empty model, a long model and an unknown field are 400 validation_failed', async () => {
    const admin = await browserOf(current, { role: 'administrator', key: 'fresh' });
    const owner = await browserOf(current, { role: 'editor', key: 'none' });
    const phone = await deviceOf(owner);
    for (const body of [undefined, {}, { confirmModel: '' }, { confirmModel: 'x'.repeat(101) }, { confirmModel: 'Pixel 8', extra: 1 }]) {
      const response = await admin.panel.post(`${DEVICES}/${phone.deviceId}/wipe`, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(problemOf(response)).not.toBe('device_model_mismatch');
    }
  });

  it('EVM-095 AC4 the order of the wipe: the next request, the refresh and the sign-in with the installation secret (even with a wrong password) are 401 device_wipe_required; the phone confirms and the state is Wiped', async () => {
    const admin = await browserOf(current, { role: 'administrator', key: 'fresh' });
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    await sql`update identity.devices set pending_items_reported = 5 where id = ${phone.deviceId ?? null}`.execute(current.database.admin);

    const ordered = await admin.panel.post(`${DEVICES}/${phone.deviceId}/wipe`, { confirmModel: ' Pixel 8 ' });
    expect(ordered.status).toBe(204);
    expect(ordered.headers['cache-control']).toBe('no-store');

    const request1 = await phone.get(MOBILE.config, phone.authorised());
    expect([request1.status, problemOf(request1)]).toEqual([401, 'device_wipe_required']);
    expect(problemOf(await phone.refresh())).toBe('device_wipe_required');
    const wrongPassword = await phone.firstStep({ email: account.email, password: 'wrong password entirely' }, { pair: true });
    expect([wrongPassword.status, problemOf(wrongPassword)]).toEqual([401, 'device_wipe_required']);
    const rightPassword = await phone.firstStep(account, { pair: true });
    expect(problemOf(rightPassword)).toBe('device_wipe_required');
    expect(await deviceRow(current, phone.deviceId ?? '')).toMatchObject({ state: 'wipe_required' });

    const listed = (await admin.panel.get(`${DEVICES}?userId=${account.user.id}`)).body as {
      items: Array<{ state: string; pendingItemsReported: number }>;
    };
    expect(listed.items[0]).toMatchObject({ state: 'wipe_required', pendingItemsReported: 5 });

    // a logout never takes the device back from the wipe
    expect((await admin.panel.post(`${DEVICES}/${phone.deviceId}/logout`)).status).toBe(204);
    expect(await deviceRow(current, phone.deviceId ?? '')).toMatchObject({ state: 'wipe_required' });

    const confirmed = await phone.post(MOBILE.wipe, { deviceId: phone.deviceId, installationSecret: phone.installationSecret });
    expect(confirmed.status).toBe(204);
    expect(await deviceRow(current, phone.deviceId ?? '')).toMatchObject({ state: 'wiped' });
    expect(
      ((await admin.panel.get(`${DEVICES}?userId=${account.user.id}`)).body as { items: Array<{ state: string }> }).items[0]?.state,
    ).toBe('wiped');
    // a second order is a 204 that changes nothing and writes nothing
    expect((await admin.panel.post(`${DEVICES}/${phone.deviceId}/wipe`, { confirmModel: 'Pixel 8' })).status).toBe(204);
    expect(await deviceRow(current, phone.deviceId ?? '')).toMatchObject({ state: 'wiped' });
    expect((await auditActions(current)).filter((event) => event.action === 'device.wipe_ordered')).toMatchObject([
      { actor_user_id: admin.user.id, object_id: phone.deviceId, reason_code: 'manual', outcome: 'success' },
    ]);
  });

  it('EVM-095 AC4 a device ordered to wipe takes no place in the limit of two: a third phone signs in', async () => {
    const admin = await browserOf(current, { role: 'administrator', key: 'fresh' });
    const account = await totpAccount(current);
    const first = await signedInPhone(current, account);
    await signedInPhone(current, account);
    expect((await signInPhone(current, newPhone(current), account)).second.status).toBe(403);
    await admin.panel.post(`${DEVICES}/${first.deviceId}/wipe`, { confirmModel: 'Pixel 8' });
    const third = newPhone(current);
    expect((await signInPhone(current, third, account)).second.status).toBe(200);
  });

  it('EVM-095 AC4 the order races with the confirmation of the phone: both end in Wiped, with no server error', async () => {
    const admin = await browserOf(current, { role: 'administrator', key: 'fresh' });
    const account = await totpAccount(current);
    const phone = await signedInPhone(current, account);
    await admin.panel.post(`${DEVICES}/${phone.deviceId}/wipe`, { confirmModel: 'Pixel 8' });
    const body = { deviceId: phone.deviceId, installationSecret: phone.installationSecret };
    const results = await Promise.all([
      admin.panel.post(`${DEVICES}/${phone.deviceId}/wipe`, { confirmModel: 'Pixel 8' }),
      phone.post(MOBILE.wipe, body),
      admin.panel.post(`${DEVICES}/${phone.deviceId}/wipe`, { confirmModel: 'Pixel 8' }),
    ]);
    expect(results.map((result) => result.status)).toEqual([204, 204, 204]);
    expect(await deviceRow(current, phone.deviceId ?? '')).toMatchObject({ state: 'wiped' });
  });

  it('EVM-095 AC4 AC6 the audit of the wipe holds no model, no secret and no token', async () => {
    const admin = await browserOf(current, { role: 'administrator', key: 'fresh' });
    const owner = await browserOf(current, { role: 'editor', key: 'none' });
    const phone = await deviceOf(owner, 'Model Probierczy 9');
    await admin.panel.post(`${DEVICES}/${phone.deviceId}/wipe`, { confirmModel: 'Model Probierczy 9' });
    const { rows } = await sql<{
      text: string;
    }>`select to_jsonb(t)::text as text from audit.events t where action like 'device.%' or action = 'session.revoked'`.execute(
      current.database.admin,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.text).not.toContain('Probierczy');
      expect(row.text).not.toContain(phone.bearer);
    }
  });
});

describe('EVM-095 AC6 the contract says it: the web channel only, the roles, the step-up, the audit', () => {
  const administratorOnly = ['listDevices', 'logoutDevice', 'wipeDevice', 'getUserDevicesSummary'];
  it('EVM-095 AC6 all six operations are web-only; the four of the Administrator have a step-up and an audit; the two of the account are for the Administrator and the Editor', () => {
    for (const id of [...administratorOnly, 'listAccountDevices', 'logoutAccountDevice']) {
      expect(AUTHZ_MANIFEST[id]?.authz.channels, id).toEqual(['web']);
      expect(AUTHZ_MANIFEST[id]?.authz.allowDuringMfaEnrollment === true, id).toBe(false);
    }
    for (const id of administratorOnly) {
      expect(AUTHZ_MANIFEST[id]?.authz, id).toMatchObject({ roles: ['administrator'], stepUp: true, audit: true });
    }
    expect(AUTHZ_MANIFEST['listAccountDevices']?.authz).toMatchObject({ roles: ['administrator', 'editor'] });
    expect(AUTHZ_MANIFEST['listAccountDevices']?.authz.stepUp).toBeUndefined();
    expect(AUTHZ_MANIFEST['logoutAccountDevice']?.authz).toMatchObject({ roles: ['administrator', 'editor'], stepUp: true, audit: true });
  });
});
