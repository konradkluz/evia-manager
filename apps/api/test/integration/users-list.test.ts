import { sql, type KyselyPlugin } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/platform/database/database.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { DATABASE } from '../../src/platform/tokens.ts';
import { EmailTransientError } from '../../src/platform/email/email-errors.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createUser } from '../support/identity-fixtures.ts';
import { migratedDatabase } from './database.ts';
import { USERS, browserOf, emailHarness, invite, inviteBody, outboxRows } from '../support/invitation-fixtures.ts';

let current: IdentityApp | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

interface Item {
  id: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  invitation: { state: string; sentAt: string | null; expiresAt: string | null } | null;
}
const bodyOf = (response: { body: unknown }) => response.body as { items: Item[]; nextCursor: string | null };

describe('the list of users for the Administrator (EVM-024 AC5, AC8; W-16; SR-AUTHZ-05, SR-DATA-03)', () => {
  it('EVM-024 AC5 AC8 only an Administrator on the web channel reads it — no step-up is needed; an Editor and a Tylko odczyt user get 403, a mobile token 403, an enrolment session 403, an anonymous caller 401', async () => {
    current = await createIdentityApp();
    const admin = await browserOf(current, { key: 'none' });
    const ok = await admin.panel.get(USERS);
    expect(ok.status).toBe(200);
    expect(bodyOf(ok).items.map((item) => item.id)).toEqual([admin.user.id]);
    expect(bodyOf(ok).nextCursor).toBeNull();
    expect((await current.panel().get(USERS)).status).toBe(401);
    for (const role of ['editor', 'read_only'] as const) {
      const response = await (await browserOf(current, { role })).panel.get(USERS);
      expect(response.status, role).toBe(403);
      expect(response.body).toMatchObject({ code: 'forbidden' });
    }
    expect((await (await browserOf(current, { channel: 'mobile' })).panel.get(USERS)).status).toBe(403);
    const enrolling = await (await browserOf(current, { state: 'mfa_enrollment' })).panel.get(USERS);
    expect(enrolling.status).toBe(403);
    expect(enrolling.body).toMatchObject({ code: 'mfa_enrollment_required' });
  });

  it('EVM-024 AC5 the list holds the fields of the contract and nothing else: no hash, no handle, no credential, no IP address, no method of MFA', async () => {
    current = await createIdentityApp();
    const admin = await browserOf(current);
    const response = await admin.panel.get(USERS);
    expect(Object.keys(bodyOf(response).items[0] ?? {}).sort()).toEqual(['displayName', 'email', 'id', 'invitation', 'role', 'status']);
    expect(JSON.stringify(response.body)).not.toMatch(/hash|handle|passkey|credential|ip_|webauthn/i);
  });

  it('EVM-024 AC5 the state of an invitation: sending, sent, failed ("Nie wysłano") and expired — and none for an account that is not waiting', async () => {
    current = await createIdentityApp();
    const admin = await browserOf(current);
    const { job, sender } = emailHarness(current);
    const send = async (email: string, behave: () => void = () => undefined) => {
      const body = inviteBody({ email, displayName: email });
      expect((await invite(admin, body)).status).toBe(201);
      const [row] = await outboxRows(current as IdentityApp, { recipient: body.id, kind: 'user_invitation' });
      behave();
      return { body, id: row?.id ?? '' };
    };
    const sending = await send('wysylana@example.com');
    const sent = await send('wyslana@example.com');
    await job.run({ ids: [sent.id] });
    const failed = await send('niewyslana@example.com');
    sender.failAll(new EmailTransientError('timeout'));
    for (let attempt = 0; attempt < 5; attempt += 1) await job.run({ ids: [failed.id] }).catch(() => undefined);
    sender.recover();
    const expired = await send('wygasla@example.com');
    await job.run({ ids: [expired.id] });
    const active = await createUser(current.database.admin, current.clock, { role: 'editor', email: 'czynny@example.com' });
    const off = await createUser(current.database.admin, current.clock, {
      role: 'editor',
      status: 'deactivated',
      email: 'off@example.com',
    });

    current.clock.advance(73 * 3_600_000); // the links sent at the start have run out (the administrator's session too: use a fresh one)
    const later = await browserOf(current);
    const items = new Map(bodyOf(await later.panel.get(USERS)).items.map((item) => [item.id, item]));
    expect(items.get(sending.body.id)?.invitation).toEqual({ state: 'sending', sentAt: null, expiresAt: null });
    expect(items.get(failed.body.id)?.invitation).toEqual({ state: 'failed', sentAt: null, expiresAt: null });
    expect(items.get(sent.body.id)?.invitation).toEqual({
      state: 'expired',
      sentAt: '2026-10-01T08:00:00.000Z',
      expiresAt: '2026-10-04T08:00:00.000Z',
    });
    expect(items.get(expired.body.id)?.invitation?.state).toBe('expired');
    expect(items.get(active.id)).toMatchObject({ status: 'active', invitation: null });
    expect(items.get(off.id)).toMatchObject({ status: 'deactivated', invitation: null });

    // within the 72 hours a sent invitation is `sent` with its end
    current.clock.set('2026-10-02T08:00:00.000Z');
    const early = await browserOf(current);
    const earlyItems = new Map(bodyOf(await early.panel.get(USERS)).items.map((item) => [item.id, item]));
    expect(earlyItems.get(sent.body.id)?.invitation).toEqual({
      state: 'sent',
      sentAt: '2026-10-01T08:00:00.000Z',
      expiresAt: '2026-10-04T08:00:00.000Z',
    });
  });

  it('EVM-024 AC5 an account of the command of the first Administrator (no message in the outbox) shows the state of its link: sent while it is valid, expired after', async () => {
    current = await createIdentityApp();
    const { user } = await current.pendingAdministrator({ email: 'pierwszy@example.com' });
    const find = async () =>
      bodyOf(await (await browserOf(current as IdentityApp)).panel.get(USERS)).items.find((item) => item.id === user.id);
    expect((await find())?.invitation).toEqual({
      state: 'sent',
      sentAt: '2026-10-01T08:00:00.000Z',
      expiresAt: '2026-10-04T08:00:00.000Z',
    });
    current.clock.advance(80 * 3_600_000);
    expect((await find())?.invitation?.state).toBe('expired');
    const bare = await createUser(current.database.admin, current.clock, { role: 'editor', status: 'invited' });
    const item = bodyOf(await (await browserOf(current)).panel.get(USERS)).items.find((row) => row.id === bare.id);
    expect(item?.invitation).toEqual({ state: 'expired', sentAt: null, expiresAt: null });
  });

  it('EVM-024 AC5 the order is the display name in the collation pl-PL ("Ł" after "L"), then the id; deleted accounts are not listed', async () => {
    current = await createIdentityApp();
    const admin = await browserOf(current, { displayName: 'Ola Administrator' });
    for (const displayName of ['Zofia', 'Łukasz', 'Lech', 'Adam', 'Maria']) {
      await createUser(current.database.admin, current.clock, { role: 'editor', displayName });
    }
    const gone = await createUser(current.database.admin, current.clock, { role: 'editor', displayName: 'Bartek Usunięty' });
    await sql`update identity.users set deleted_at = ${current.clock.now()} where id = ${gone.id}`.execute(current.database.admin);

    const names = bodyOf(await admin.panel.get(USERS)).items.map((item) => item.displayName);
    expect(names).toEqual(['Adam', 'Lech', 'Łukasz', 'Maria', 'Ola Administrator', 'Zofia']);
  });

  it('EVM-024 AC5 the cursor pages through the list without gaps or repeats, is bound to the user and the operation, and a bad one is one 400 invalid_cursor', async () => {
    current = await createIdentityApp();
    const admin = await browserOf(current, { displayName: 'A Administrator' });
    for (let index = 0; index < 6; index += 1) {
      await createUser(current.database.admin, current.clock, { role: 'editor', displayName: `Osoba ${String(index)}` });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const response = await admin.panel.get(`${USERS}?limit=3${cursor === null ? '' : `&cursor=${cursor}`}`);
      expect(response.status).toBe(200);
      const page = bodyOf(response);
      expect(page.items.length).toBeLessThanOrEqual(3);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(7);

    const first = bodyOf(await admin.panel.get(`${USERS}?limit=2`));
    const token = first.nextCursor ?? '';
    const other = await browserOf(current, { displayName: 'Inny Administrator' });
    for (const bad of [token.slice(0, -2) + 'AA', 'A'.repeat(40), `${token}x`]) {
      const response = await admin.panel.get(`${USERS}?cursor=${bad}`);
      expect(response.status, bad).toBe(400);
      expect(response.body).toMatchObject({ code: 'invalid_cursor' });
    }
    const stolen = await other.panel.get(`${USERS}?cursor=${token}`);
    expect(stolen.status).toBe(400);
    expect(stolen.body).toMatchObject({ code: 'invalid_cursor' });
    // a user deleted while the Administrator pages keeps the position
    const lastOfPage = first.items.at(-1);
    await sql`update identity.users set deleted_at = ${current.clock.now()} where id = ${lastOfPage?.id ?? ''}`.execute(
      current.database.admin,
    );
    expect((await admin.panel.get(`${USERS}?cursor=${token}`)).status).toBe(200);
  });

  it('EVM-024 AC5 the query is strict: a limit outside 1..100, an unknown or a repeated parameter is 400', async () => {
    current = await createIdentityApp();
    const admin = await browserOf(current);
    for (const query of ['limit=0', 'limit=101', 'limit=abc', 'limit=1.5', 'sort=email', 'q=anna', 'limit=1&limit=2']) {
      const response = await admin.panel.get(`${USERS}?${query}`);
      expect(response.status, query).toBe(400);
    }
    expect((await admin.panel.get(`${USERS}?limit=100`)).status).toBe(200);
  });

  it('EVM-024 AC5 a page costs the same number of statements however many accounts it holds: no query per row (the statuses come in one query for the page)', async () => {
    const counted: string[] = [];
    const counter: KyselyPlugin = {
      transformQuery: (args) => {
        counted.push(args.node.kind);
        return args.node;
      },
      transformResult: (args) => Promise.resolve(args.result),
    };
    const database = await migratedDatabase();
    const logger = createLogger({ level: 'fatal' });
    const counting = createDatabase({ url: database.appUrl, logger, pool: { max: 2 } }).withPlugin(counter);
    current = await createIdentityApp({ database, configure: (builder) => builder.overrideProvider(DATABASE).useValue(counting) });
    const admin = await browserOf(current);
    const measure = async () => {
      counted.length = 0;
      expect((await admin.panel.get(`${USERS}?limit=100`)).status).toBe(200);
      return counted.length;
    };
    const small = await measure();
    for (let index = 0; index < 40; index += 1) {
      const user = await createUser(current.database.admin, current.clock, {
        role: 'editor',
        status: 'invited',
        displayName: `Osoba ${String(index)}`,
      });
      await sql`insert into platform.email_outbox (kind, recipient_user_id, state, created_at) values ('user_invitation', ${user.id}, 'pending', ${current.clock.now()})`.execute(
        current.database.admin,
      );
    }
    const large = await measure();
    expect(large).toBe(small);
  });
});
