import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PANEL_ORIGIN } from '../support/app.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp();
});
afterAll(async () => {
  await current.close();
});

const PATH = '/api/v1/users/assignable';
const admin = () => current.database.admin;

async function signIn(role: Role, channel: 'web' | 'mobile' = 'web', displayName?: string) {
  const user = await createUser(admin(), current.clock, { role, ...(displayName === undefined ? {} : { displayName }) });
  const session = await createSession(admin(), current.clock, user, { channel });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}

describe('the users to choose an assignee from (EVM-022 AC1, AC7; SR-DATA-03, SR-AUTHZ-05, SR-API-02)', () => {
  it('EVM-022 AC1 the answer is the ACTIVE users by display name then id — each with the id and the display name and NOTHING else (no e-mail, role, status, last sign-in)', async () => {
    const zeta = await signIn('editor', 'web', 'Zofia Testowa');
    await createUser(admin(), current.clock, { status: 'invited', displayName: 'Ignacy Zaproszony' });
    await createUser(admin(), current.clock, { status: 'deactivated', displayName: 'Dariusz Wyłączony' });
    const deleted = await createUser(admin(), current.clock, { displayName: 'Urszula Usunięta' });
    await sql`update identity.users set deleted_at = now() where id = ${deleted.id}`.execute(admin());
    const anna = await signIn('administrator', 'web', 'Anna Testowa');
    await sql`update identity.users set last_login_at = now() where id = ${anna.userId}`.execute(admin());

    const response = await zeta.panel.get(PATH);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.body as { items: Array<Record<string, unknown>>; nextCursor: unknown };
    expect(body.nextCursor).toBeNull();
    expect(body.items.map((item) => item['displayName'])).toEqual(['Anna Testowa', 'Zofia Testowa']);
    for (const item of body.items) expect(Object.keys(item).sort()).toEqual(['displayName', 'id']);
    expect(body.items.map((item) => item['id'])).toEqual([anna.userId, zeta.userId]);
    expect(JSON.stringify(body)).not.toMatch(/evia\.invalid|administrator|editor|Zaproszony|Wyłączony|Usunięta|lastLogin|mfa/i);
  });

  it('EVM-022 AC7 Administrator and Editor 200; Read-only 403; no session 401; the mobile channel 403', async () => {
    for (const role of ['administrator', 'editor'] as const) expect((await (await signIn(role)).panel.get(PATH)).status, role).toBe(200);
    const readOnly = await (await signIn('read_only')).panel.get(PATH);
    expect(readOnly.status).toBe(403);
    expect(readOnly.body).toMatchObject({ code: 'forbidden' });
    const anonymous = await new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN).get(PATH);
    expect(anonymous.status).toBe(401);
    for (const role of ['administrator', 'editor'] as const)
      expect((await (await signIn(role, 'mobile')).panel.get(PATH)).status, role).toBe(403);
  });

  it('EVM-022 AC7 the operation takes no parameter: any query parameter is 400 unknown_parameter', async () => {
    const response = await (await signIn('editor')).panel.get(`${PATH}?role=read_only`);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'unknown_parameter' });
  });

  it('EVM-022 AC1 the answer is bounded to 100 users (the contract maxItems)', async () => {
    const browser = await signIn('administrator');
    for (let index = 0; index < 105; index += 1)
      await createUser(admin(), current.clock, { displayName: `Bulk ${String(index).padStart(3, '0')}` });
    const response = await browser.panel.get(PATH);
    expect(response.status).toBe(200);
    expect((response.body as { items: unknown[] }).items).toHaveLength(100);
  });
});
