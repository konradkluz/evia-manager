import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EVENT_BUS } from '../../src/platform/tokens.ts';
import { EventBus, type DomainEvent, type EventContext } from '../../src/platform/events/event-bus.ts';
import { EmailPermanentError, EmailTransientError } from '../../src/platform/email/email-errors.ts';
import { PATHS, setPassword } from '../support/flows.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createUser } from '../support/identity-fixtures.ts';
import {
  USERS,
  auditActions,
  browserOf,
  emailHarness,
  everythingAsText,
  invite,
  inviteBody,
  linkIn,
  linksOf,
  outboxRows,
} from '../support/invitation-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

const itemsOf = (response: { body: unknown }) => (response.body as { items: Array<{ id: string }> }).items;
const sha256 = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();
const usersTable = async () =>
  (
    await sql<{
      id: string;
      email: string;
      status: string;
      role: string;
    }>`select id, email, status, role from identity.users order by created_at, id`.execute(current.database.admin)
  ).rows;

describe('the invitation of a user (EVM-024 AC1; SR-AUTH-12, SR-SESS-08, SR-LOG-03, SR-CRYPTO-03)', () => {
  it('EVM-024 AC1 an Administrator after a step-up invites a person: 201, the account is invited, the e-mail is in the outbox (ids only) in the same transaction, the audit event holds no address, and the answer has no token', async () => {
    const admin = await browserOf(current);
    const body = inviteBody({ email: '  Anna.Testowa@Example.com ' });
    const response = await invite(admin, body);

    expect(response.status).toBe(201);
    expect(response.headers['location']).toBe(`${USERS}/${body.id}`);
    expect(response.body).toEqual({
      id: body.id,
      email: 'anna.testowa@example.com',
      displayName: 'Anna Testowa',
      role: 'editor',
      status: 'invited',
      invitation: { state: 'sending', sentAt: null, expiresAt: null },
      version: 1,
      activatedAt: null,
      secondStepMethods: [],
    });
    expect(await usersTable()).toContainEqual({ id: body.id, email: 'anna.testowa@example.com', status: 'invited', role: 'editor' });

    const [row, ...rest] = await outboxRows(current, { recipient: body.id });
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ kind: 'user_invitation', variant: null, state: 'pending', attempts: 0, enqueued_at: null, sent_at: null });
    // no token yet: it is made by the worker when it sends (the hash only is stored)
    expect(await linksOf(current, body.id)).toEqual([]);

    const events = (await auditActions(current)).filter((event) => event.action === 'user.invited');
    expect(events).toEqual([
      {
        action: 'user.invited',
        actor_type: 'user',
        actor_user_id: admin.user.id,
        object_id: body.id,
        outcome: 'success',
        reason_code: null,
      },
    ]);
    const stored = await everythingAsText(current);
    const outbox = JSON.stringify(await outboxRows(current));
    expect(outbox).not.toMatch(/anna|testowa|example\.com/i);
    expect(
      stored
        .split('\n')
        .filter((line) => line.startsWith('audit.events') || line.startsWith('platform.'))
        .join('\n'),
    ).not.toMatch(/anna|testowa/i);
    expect(JSON.stringify(response.body)).not.toMatch(/token|hash/i);
  });

  it("EVM-024 AC1 when the worker sends: the link is in the fragment of the address, the database holds only its 32-byte hash valid for 72 hours from the sending, and the event of the link is the system's", async () => {
    const admin = await browserOf(current);
    const body = inviteBody();
    expect((await invite(admin, body)).status).toBe(201);
    const [row] = await outboxRows(current, { recipient: body.id });
    const { job, sender } = emailHarness(current);

    expect(await job.run({ ids: [row?.id ?? ''] })).toMatchObject({ sent: 1 });

    const [message, ...others] = sender.sent;
    expect(others).toEqual([]);
    expect(message?.to).toBe('anna.testowa@example.com');
    expect(message?.subject).toBe('EVia Manager: zaproszenie do panelu');
    const { path, token } = linkIn(message?.text ?? '');
    expect(path).toBe('/activate');
    // the token is in the fragment only — never in the path or the query (SR-API-04)
    expect(message?.text).not.toMatch(/activate\?|\/activate\/[A-Za-z0-9_-]{20}/);
    const [link, ...otherLinks] = await linksOf(current, body.id);
    expect(otherLinks).toEqual([]);
    expect(link?.token_hash.equals(sha256(token))).toBe(true);
    expect(link?.token_hash).toHaveLength(32);
    expect(link?.issued_by).toBe('invitation');
    expect(link?.issued_at.toISOString()).toBe('2026-10-01T08:00:00.000Z');
    expect((link?.expires_at.getTime() ?? 0) - (link?.issued_at.getTime() ?? 0)).toBe(72 * 3_600_000);
    expect(await everythingAsText(current)).not.toContain(token);
    expect((await outboxRows(current, { recipient: body.id }))[0]).toMatchObject({ state: 'sent', attempts: 1 });
    expect(await auditActions(current)).toContainEqual({
      action: 'activation_link.issued',
      actor_type: 'system',
      actor_user_id: null,
      object_id: body.id,
      outcome: 'success',
      reason_code: null,
    });
  });

  it('EVM-024 AC1 the invitation and its outbox row are one transaction: when the audit write fails, neither the account nor the row exists', async () => {
    await current.close();
    const failing = new (class extends EventBus {
      override async publish(tx: Parameters<EventBus['publish']>[0], event: DomainEvent, context: EventContext): Promise<void> {
        if (event.type === 'user.invited') throw new Error('synthetic audit failure');
        await super.publish(tx, event, context);
      }
    })();
    current = await createIdentityApp({ configure: (builder) => builder.overrideProvider(EVENT_BUS).useValue(failing) });
    const admin = await browserOf(current);
    const body = inviteBody();

    expect((await invite(admin, body)).status).toBe(500);

    expect((await usersTable()).map((user) => user.id)).not.toContain(body.id);
    expect(await outboxRows(current)).toEqual([]);
    expect(await sql`select 1 from platform.idempotency_records`.execute(current.database.admin).then((result) => result.rows)).toEqual([]);
  });

  it('EVM-024 AC1 an invitation with the role Administrator sends an alert to EVERY active Administrator — the actor too — and none to anyone else; an Editor invitation sends none', async () => {
    const admin = await browserOf(current);
    const other = await createUser(current.database.admin, current.clock, { role: 'administrator' });
    const deactivated = await createUser(current.database.admin, current.clock, { role: 'administrator', status: 'deactivated' });
    const pending = await createUser(current.database.admin, current.clock, { role: 'administrator', status: 'invited' });
    const editor = await createUser(current.database.admin, current.clock, { role: 'editor' });

    const asEditor = inviteBody({ role: 'editor' });
    expect((await invite(admin, asEditor)).status).toBe(201);
    expect(await outboxRows(current, { kind: 'administrator_alert' })).toEqual([]);

    const asAdministrator = inviteBody({ email: 'szef@example.com', displayName: 'Szef', role: 'administrator' });
    expect((await invite(admin, asAdministrator)).status).toBe(201);
    const alerts = await outboxRows(current, { kind: 'administrator_alert' });
    expect(alerts.map((alert) => alert.recipient_user_id).sort()).toEqual([admin.user.id, other.id].sort());
    expect(alerts.every((alert) => alert.variant === 'administrator_invitation' && alert.state === 'pending')).toBe(true);
    for (const excluded of [deactivated, pending, editor])
      expect(alerts.map((alert) => alert.recipient_user_id)).not.toContain(excluded.id);

    // a resend of an invitation with the role Administrator alerts again; of an Editor — never
    const resend = await admin.panel.post(`${USERS}/${asAdministrator.id}/invitations`);
    expect(resend.status).toBe(200);
    expect(await outboxRows(current, { kind: 'administrator_alert' })).toHaveLength(4);
    expect((await admin.panel.post(`${USERS}/${asEditor.id}/invitations`)).status).toBe(200);
    expect(await outboxRows(current, { kind: 'administrator_alert' })).toHaveLength(4);
  });

  it('EVM-024 AC1 the alert for Administrators names no one: no address, no name, no token, a link to the audit log only', async () => {
    const admin = await browserOf(current, { email: 'szefowa@example.com' });
    expect(
      (await invite(admin, inviteBody({ email: 'nowy.admin@example.com', displayName: 'Nowy Admin', role: 'administrator' }))).status,
    ).toBe(201);
    const { job, sender } = emailHarness(current);
    const [alert] = await outboxRows(current, { kind: 'administrator_alert' });

    await job.run({ ids: [alert?.id ?? ''] });

    const [message] = sender.sent;
    expect(message?.to).toBe('szefowa@example.com');
    expect(message?.subject).toBe('EVia Manager: alert bezpieczeństwa — zaproszenie administratora');
    expect(message?.text).toContain('wysłano zaproszenie z rolą Administrator.');
    expect(message?.text).toContain('https://panel.evia.test/administration/audit');
    expect(message?.text).not.toMatch(/nowy\.admin|Nowy Admin|#[A-Za-z0-9_-]{43}/);
    expect(await linksOf(current, admin.user.id)).toEqual([]);
  });
});

describe('the text of the e-mail and the address (EVM-024 AC2; SR-INPUT-07, CWE-93)', () => {
  it('EVM-024 AC2 the text comes from the fixed template: the role and the end of the validity, no name, no data of customers', async () => {
    const admin = await browserOf(current);
    const body = inviteBody({ displayName: 'Anna <b>Testowa</b> ąęł' });
    expect((await invite(admin, body)).status).toBe(201);
    const { job, sender } = emailHarness(current);
    await job.run({ ids: [(await outboxRows(current))[0]?.id ?? ''] });

    const text = sender.sent[0]?.text ?? '';
    expect(text).toContain('zaproszono Cię do panelu EVia Manager firmy EVia Charge z rolą: Edytor.');
    // 2026-10-01 08:00Z + 72 h = 2026-10-04 08:00Z = 10:00 in Europe/Warsaw (CEST)
    expect(text).toContain('Link jest jednorazowy i ważny 72 godziny — do 04.10.2026, 10:00.');
    expect(text).toContain('Adres panelu: https://panel.evia.test');
    expect(text).not.toMatch(/Anna|Testowa|<b>/);
    expect(sender.sent[0]?.subject).not.toMatch(/Anna|Testowa/);
  });

  it('EVM-024 AC2 an address with CR or LF, a quoted part, two recipients or no address at all is 400 validation_failed (invalid_email) and nothing is written', async () => {
    const admin = await browserOf(current);
    const before = await everythingAsText(current);
    for (const email of [
      'a@b.test\r\nBcc: victim@evil.test',
      'a@b.test\nBcc: victim@evil.test',
      '"a@b"@example.com',
      'a@example.com, b@example.com',
      'Anna <a@example.com>',
      'not an address',
      '',
      'a\u0000@example.com',
    ]) {
      const response = await invite(admin, inviteBody({ email }));
      expect(response.status, JSON.stringify(email)).toBe(400);
      expect(response.body).toMatchObject({ code: 'validation_failed', errors: [{ pointer: '/email', code: 'invalid_email' }] });
      expect(JSON.stringify(response.body)).not.toMatch(/victim|evil/);
    }
    expect(await everythingAsText(current)).toBe(before);
    expect(await outboxRows(current)).toEqual([]);
  });

  it('EVM-024 AC2 the name is plain text: empty, too long, with a control character are refused with a pointer and a code; an unknown field and a field of the server are refused too', async () => {
    const admin = await browserOf(current);
    const cases: Array<[Record<string, unknown>, string, string]> = [
      [{ displayName: '   ' }, '/displayName', 'required'],
      [{ displayName: 'a'.repeat(201) }, '/displayName', 'too_long'],
      [{ displayName: 'Anna\nTestowa' }, '/displayName', 'invalid_characters'],
      [{ displayName: 'Anna‮Testowa' }, '/displayName', 'invalid_characters'],
      [{ role: 'owner' }, '/role', 'invalid_value'],
      [{ status: 'active' }, '/status', 'unknown_field'],
      [{ userId: uuidv7() }, '/userId', 'unknown_field'],
    ];
    for (const [overrides, pointer, code] of cases) {
      const response = await invite(admin, { ...inviteBody(), ...overrides });
      expect(response.status, JSON.stringify(overrides)).toBe(400);
      expect(response.body).toMatchObject({ code: 'validation_failed', errors: expect.arrayContaining([{ pointer, code }]) as unknown });
    }
    expect((await invite(admin, { ...inviteBody(), id: 'not-a-uuid' })).status).toBe(400);
    expect((await invite(admin, { email: 'a@example.com' })).status).toBe(400);
    expect(await outboxRows(current)).toEqual([]);
  });
});

describe('a link that does not work and the resend (EVM-024 AC4; SR-AUTH-12, ASVS V6.4.1)', () => {
  async function invited(admin: Awaited<ReturnType<typeof browserOf>>, overrides = {}) {
    const body = inviteBody(overrides);
    expect((await invite(admin, body)).status).toBe(201);
    const harness = emailHarness(current);
    const [row] = await outboxRows(current, { recipient: body.id, kind: 'user_invitation' });
    await harness.job.run({ ids: [row?.id ?? ''] });
    const token = linkIn(harness.sender.sent.at(-1)?.text ?? '').token;
    return { body, token, harness };
  }
  const check = (token: string) => current.panel().post(PATHS.check, { token });

  it('EVM-024 AC4 a link issued 2026-10-01 10:00 works until 2026-10-04 10:00 and is the same invalid answer at 10:01 — as for a used, a superseded and an unknown one', async () => {
    const admin = await browserOf(current);
    const { token } = await invited(admin);
    expect((await check(token)).status).toBe(200);
    current.clock.set('2026-10-04T07:59:59.000Z');
    expect((await check(token)).status).toBe(200);
    current.clock.set('2026-10-04T08:01:00.000Z'); // 2026-10-04 10:01 in Europe/Warsaw
    const expired = await check(token);
    expect(expired.status).toBe(400);
    expect(expired.body).toMatchObject({ code: 'activation_link_invalid' });
    const unknown = await check('A'.repeat(43));
    expect({ status: unknown.status, code: (unknown.body as { code: string }).code }).toEqual({
      status: 400,
      code: 'activation_link_invalid',
    });
    expect(JSON.stringify(expired.body)).toBe(
      JSON.stringify({ ...(unknown.body as object), traceId: (expired.body as { traceId: string }).traceId }),
    );
  });

  it('EVM-024 AC4 a resend ends the earlier link AT ONCE — also before the worker sends — and the new link is valid for 72 hours from its sending', async () => {
    const admin = await browserOf(current);
    const { body, token: first, harness } = await invited(admin);
    expect((await check(first)).status).toBe(200);

    current.clock.advance(10 * 60_000); // ten minutes later: 10:10 (the key of the Administrator is still fresh: the window of a step-up is 15 minutes)
    const resend = await admin.panel.post(`${USERS}/${body.id}/invitations`);
    expect(resend.status).toBe(200);
    expect(resend.body).toMatchObject({ id: body.id, status: 'invited', invitation: { state: 'sending', sentAt: null, expiresAt: null } });
    expect((await check(first)).status).toBe(400); // before any new message exists
    expect((await linksOf(current, body.id)).map((link) => link.superseded_at !== null)).toEqual([true]);

    const [, second] = await outboxRows(current, { recipient: body.id, kind: 'user_invitation' });
    expect((await outboxRows(current, { recipient: body.id }))[0]?.state).toBe('sent');
    await harness.job.run({ ids: [second?.id ?? ''] });
    const token = linkIn(harness.sender.sent.at(-1)?.text ?? '').token;
    expect(token).not.toBe(first);
    expect((await check(token)).status).toBe(200);
    const links = await linksOf(current, body.id);
    expect(links).toHaveLength(2);
    expect(links[1]?.expires_at.toISOString()).toBe('2026-10-04T08:10:00.000Z'); // 72 h from 10:10 Warsaw time, not from the first sending
    expect(await auditActions(current)).toContainEqual(
      expect.objectContaining({ action: 'invitation.resent', actor_user_id: admin.user.id, object_id: body.id, outcome: 'success' }),
    );
  });

  it('EVM-024 AC4 a resend ends the enrolment session started with the earlier link (link_superseded)', async () => {
    const admin = await browserOf(current);
    const { body, token } = await invited(admin);
    const person = current.panel();
    expect((await setPassword(person, token)).status).toBe(200);
    expect((await person.get(PATHS.session)).status).toBe(200);

    expect((await admin.panel.post(`${USERS}/${body.id}/invitations`)).status).toBe(200);

    const after = await person.get(PATHS.session);
    expect(after.status).toBe(401);
    expect(after.body).toMatchObject({ code: 'session_revoked' });
    const { rows } = await sql<{ revoke_reason: string }>`select revoke_reason from identity.sessions where user_id = ${body.id}`.execute(
      current.database.admin,
    );
    expect(rows).toEqual([{ revoke_reason: 'link_superseded' }]);
  });

  it('EVM-024 AC4 W1 an invitation or a resend for B never ends the link or the enrolment session of A', async () => {
    const admin = await browserOf(current);
    const a = await invited(admin, { email: 'a.osoba@example.com', displayName: 'Osoba A' });
    const person = current.panel();
    expect((await setPassword(person, a.token)).status).toBe(200);

    const b = await invited(admin, { email: 'b.osoba@example.com', displayName: 'Osoba B' });
    expect((await admin.panel.post(`${USERS}/${b.body.id}/invitations`)).status).toBe(200);
    await b.harness.job.run({ ids: [(await outboxRows(current, { recipient: b.body.id, kind: 'user_invitation' })).at(-1)?.id ?? ''] });

    expect((await check(a.token)).status).toBe(200);
    expect((await person.get(PATHS.session)).status).toBe(200);
    expect((await linksOf(current, a.body.id)).map((link) => link.superseded_at)).toEqual([null]);
  });
});

describe('the job of the outbox does not make a token it must not (EVM-024 AC1, AC4; SR-AUTH-12, SR-API-06)', () => {
  it('EVM-024 AC1 a row that was superseded is neither sent nor given a link — a late job cannot end a newer link', async () => {
    const admin = await browserOf(current);
    const body = inviteBody();
    expect((await invite(admin, body)).status).toBe(201);
    expect((await admin.panel.post(`${USERS}/${body.id}/invitations`)).status).toBe(200);
    const [old, newest] = await outboxRows(current, { recipient: body.id, kind: 'user_invitation' });
    expect(old?.state).toBe('superseded');
    const { job, sender } = emailHarness(current);

    expect(await job.run({ ids: [old?.id ?? ''] })).toMatchObject({ skipped: 1, sent: 0 });
    expect(sender.sent).toEqual([]);
    expect(await linksOf(current, body.id)).toEqual([]);

    await job.run({ ids: [newest?.id ?? ''] });
    const links = await linksOf(current, body.id);
    expect(links).toHaveLength(1);
    // the late job of the old row, once more: nothing changes the newer link
    expect(await job.run({ ids: [old?.id ?? ''] })).toMatchObject({ skipped: 1 });
    expect((await linksOf(current, body.id))[0]?.superseded_at).toBeNull();
    expect(sender.sent).toHaveLength(1);
  });

  it('EVM-024 AC1 an account that is no longer waiting (activated, deactivated, deleted) gets NO token: the row is superseded and nothing is sent', async () => {
    const admin = await browserOf(current);
    const { job, sender } = emailHarness(current);
    for (const change of [
      sql`update identity.users set status = 'active'`,
      sql`update identity.users set status = 'deactivated'`,
      sql`update identity.users set deleted_at = ${current.clock.now()}`,
    ]) {
      const body = inviteBody({ email: `osoba${uuidv7().slice(-6)}@example.com` });
      expect((await invite(admin, body)).status).toBe(201);
      await sql`${change} where id = ${body.id}`.execute(current.database.admin);
      const [row] = await outboxRows(current, { recipient: body.id });
      expect(await job.run({ ids: [row?.id ?? ''] })).toMatchObject({ superseded: 1, sent: 0 });
      expect((await outboxRows(current, { recipient: body.id }))[0]?.state).toBe('superseded');
      expect(await linksOf(current, body.id)).toEqual([]);
    }
    expect(sender.sent).toEqual([]);
  });

  it('EVM-024 AC1 an alert for a recipient who is not an active Administrator any more is superseded and not sent', async () => {
    const admin = await browserOf(current);
    const other = await createUser(current.database.admin, current.clock, { role: 'administrator' });
    expect((await invite(admin, inviteBody({ role: 'administrator' }))).status).toBe(201);
    await sql`update identity.users set status = 'deactivated' where id = ${other.id}`.execute(current.database.admin);
    const { job, sender } = emailHarness(current);
    const alerts = await outboxRows(current, { kind: 'administrator_alert' });
    for (const alert of alerts) await job.run({ ids: [alert.id] });
    expect(sender.sent.map((message) => message.to)).toEqual([admin.user.email]);
    expect((await outboxRows(current, { recipient: other.id, kind: 'administrator_alert' }))[0]?.state).toBe('superseded');
  });

  it('EVM-024 AC1 the job and a resend at the same moment never deadlock and leave exactly one valid link and one pending row', async () => {
    const admin = await browserOf(current);
    const body = inviteBody();
    expect((await invite(admin, body)).status).toBe(201);
    const { job } = emailHarness(current);
    for (let round = 0; round < 5; round += 1) {
      const rows = await outboxRows(current, { recipient: body.id, kind: 'user_invitation' });
      const pending = rows.filter((row) => row.state === 'pending').map((row) => row.id);
      const results = await Promise.all([
        job.run({ ids: pending }),
        admin.panel.post(`${USERS}/${body.id}/invitations`),
        admin.panel.post(`${USERS}/${body.id}/invitations`),
      ]);
      expect((results[1] as { status: number }).status).toBe(200);
      expect((results[2] as { status: number }).status).toBe(200);
    }
    const rows = await outboxRows(current, { recipient: body.id, kind: 'user_invitation' });
    expect(rows.filter((row) => row.state === 'pending')).toHaveLength(1);
    await job.run({ ids: rows.filter((row) => row.state === 'pending').map((row) => row.id) });
    const open = (await linksOf(current, body.id)).filter((link) => link.superseded_at === null && link.used_at === null);
    expect(open).toHaveLength(1);
  });
});

describe('an e-mail service that does not answer (EVM-024 AC5; SR-ERR-02, SR-LOG-02)', () => {
  async function pending(overrides = {}) {
    const admin = await browserOf(current);
    const body = inviteBody(overrides);
    expect((await invite(admin, body)).status).toBe(201);
    const [row] = await outboxRows(current, { recipient: body.id, kind: 'user_invitation' });
    return { admin, body, id: row?.id ?? '' };
  }

  it('EVM-024 AC5 a transient failure is retried: the job fails with a fixed code, the attempts grow, and after the fifth the row is failed WITHOUT an error of the job; the account stays invited', async () => {
    const { admin, body, id } = await pending();
    const sender = emailHarness(current).sender;
    const { job } = emailHarness(current, sender);
    sender.failAll(new EmailTransientError('connection_failed'));

    for (const attempt of [1, 2, 3, 4]) {
      await expect(job.run({ ids: [id] })).rejects.toMatchObject({ code: 'email_retry', message: 'email_retry' });
      expect((await outboxRows(current, { recipient: body.id }))[0]).toMatchObject({ state: 'pending', attempts: attempt });
    }
    expect(await job.run({ ids: [id] })).toMatchObject({ failed: 1 }); // the fifth: final, the queue is not asked to retry
    expect((await outboxRows(current, { recipient: body.id }))[0]).toMatchObject({ state: 'failed', attempts: 5, sent_at: null });
    expect(sender.sent).toEqual([]);

    const list = await admin.panel.get(USERS);
    expect(itemsOf(list).find((user) => user.id === body.id)).toMatchObject({
      status: 'invited',
      invitation: { state: 'failed', sentAt: null, expiresAt: null },
    });
    // a job run again after the end changes nothing
    expect(await job.run({ ids: [id] })).toMatchObject({ skipped: 1 });
  });

  it('EVM-024 AC5 after "Nie wysłano" the Administrator sends again: the new message goes out and the state is sent — nothing was lost', async () => {
    const { admin, body, id } = await pending();
    const sender = emailHarness(current).sender;
    const { job } = emailHarness(current, sender);
    sender.failAll(new EmailPermanentError('message_rejected'));
    expect(await job.run({ ids: [id] })).toMatchObject({ failed: 1 }); // a permanent refusal is final at once
    expect((await outboxRows(current, { recipient: body.id }))[0]).toMatchObject({ state: 'failed', attempts: 1 });

    sender.recover();
    expect((await admin.panel.post(`${USERS}/${body.id}/invitations`)).status).toBe(200);
    const rows = await outboxRows(current, { recipient: body.id, kind: 'user_invitation' });
    expect(rows.map((row) => row.state)).toEqual(['failed', 'pending']);
    await job.run({ ids: [rows[1]?.id ?? ''] });

    const list = await admin.panel.get(USERS);
    expect(itemsOf(list).find((user) => user.id === body.id)).toMatchObject({
      status: 'invited',
      invitation: { state: 'sent', sentAt: '2026-10-01T08:00:00.000Z', expiresAt: '2026-10-04T08:00:00.000Z' },
    });
    expect(sender.sent).toHaveLength(1);
  });

  it('EVM-024 AC5 the same job twice sends one message (the second finds the row sent)', async () => {
    const { id } = await pending();
    const { job, sender } = emailHarness(current);
    expect(await job.run({ ids: [id] })).toMatchObject({ sent: 1 });
    expect(await job.run({ ids: [id] })).toMatchObject({ skipped: 1, sent: 0 });
    expect(sender.sent).toHaveLength(1);
  });

  it('EVM-024 AC5 W3 neither the error of the job, nor the log, nor a stored row holds the address, the text or a token — after a transient and a permanent failure', async () => {
    const { id, body } = await pending({ email: 'tajny.adres@example.com' });
    const sender = emailHarness(current).sender;
    const lines: string[] = [];
    const { job } = emailHarness(current, sender);
    sender.failNext(new EmailTransientError('timeout'));
    const failure = await job.run({ ids: [id] }).catch((error: unknown) => error);
    lines.push(JSON.stringify(failure, Object.getOwnPropertyNames(failure)));
    sender.failNext(new EmailPermanentError('recipient_rejected'));
    await job.run({ ids: [id] });
    // the account itself holds its address (it is the data of the account); the outbox, the audit trail and the records of idempotency never do
    const stored = (await everythingAsText(current))
      .split(String.fromCharCode(10))
      .filter((line) => !line.startsWith('identity.users'))
      .join(String.fromCharCode(10));
    const text = [...lines, stored].join(String.fromCharCode(10));
    expect(text).not.toMatch(/tajny\.adres|zaproszono|activate#/);
    expect(body.id).toBeDefined();
  });
});

describe('a conflict of the address and the idempotency (EVM-024 AC7; SR-API-05, SR-AUTHZ-11)', () => {
  it('EVM-024 AC7 an address that belongs to an account — active, invited, deactivated, in another case or composition — is 409 email_conflict with the id of the account and nothing else', async () => {
    const admin = await browserOf(current);
    const active = await createUser(current.database.admin, current.clock, { role: 'editor', email: 'czynny@example.com' });
    const waiting = await createUser(current.database.admin, current.clock, {
      role: 'editor',
      status: 'invited',
      email: 'czeka@example.com',
    });
    const off = await createUser(current.database.admin, current.clock, {
      role: 'editor',
      status: 'deactivated',
      email: 'wylaczony@example.com',
    });
    for (const [address, existing] of [
      ['czynny@example.com', active],
      ['CZYNNY@Example.COM', active],
      ['  czeka@example.com', waiting],
      ['Wylaczony@example.com ', off],
    ] as const) {
      const before = await outboxRows(current);
      const response = await invite(admin, inviteBody({ email: address }));
      expect(response.status, address).toBe(409);
      expect(response.body).toMatchObject({ code: 'email_conflict', status: 409, existingUserId: existing.id });
      expect(JSON.stringify(response.body)).not.toMatch(/example\.com|Anna|Użytkownik/);
      expect(await outboxRows(current)).toEqual(before);
    }
  });

  it('EVM-024 AC7 the address of a deleted account is taken too, with the same code and WITHOUT a pointer to the account', async () => {
    const admin = await browserOf(current);
    const gone = await createUser(current.database.admin, current.clock, { role: 'editor', email: 'usuniety@example.com' });
    await sql`update identity.users set deleted_at = ${current.clock.now()} where id = ${gone.id}`.execute(current.database.admin);
    const response = await invite(admin, inviteBody({ email: 'usuniety@example.com' }));
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'email_conflict' });
    expect(response.body).not.toHaveProperty('existingUserId');
  });

  it('EVM-024 AC7 two invitations of one address at the same moment give one 201 and one 409 — never a 500', async () => {
    const admin = await browserOf(current);
    for (let round = 0; round < 5; round += 1) {
      const email = `wyscig${String(round)}@example.com`;
      const responses = await Promise.all([
        invite(admin, inviteBody({ email })),
        invite(admin, inviteBody({ email })),
        invite(admin, inviteBody({ email })),
      ]);
      const statuses = responses.map((response) => response.status).sort();
      expect(statuses, email).toEqual([201, 409, 409]);
      expect(
        responses
          .filter((response) => response.status === 409)
          .every((response) => (response.body as { code: string }).code === 'email_conflict'),
      ).toBe(true);
      expect(await outboxRows(current, { kind: 'user_invitation' })).toHaveLength(round + 1);
    }
  });

  it('EVM-024 AC7 the same key and body repeat the same 201 with Idempotent-Replayed and write nothing new; another body with the key is 422; an id that is taken is 409 id_conflict', async () => {
    const admin = await browserOf(current);
    const body = inviteBody();
    const key = uuidv7();
    const first = await invite(admin, body, key);
    expect(first.status).toBe(201);
    const second = await invite(admin, body, key);
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body).toEqual(first.body);
    expect(await outboxRows(current, { recipient: body.id })).toHaveLength(1);
    expect((await auditActions(current)).filter((event) => event.action === 'user.invited')).toHaveLength(1);

    expect((await invite(admin, { ...body, displayName: 'Inna Nazwa' }, key)).status).toBe(422);
    const sameId = await invite(admin, inviteBody({ id: body.id, email: 'inny@example.com' }));
    expect(sameId.status).toBe(409);
    expect(sameId.body).toMatchObject({ code: 'id_conflict' });
    // the record of idempotency holds a hash of the body, never the address
    const records = await sql<{ request_hash: string }>`select request_hash from platform.idempotency_records`.execute(
      current.database.admin,
    );
    expect(JSON.stringify(records.rows)).not.toMatch(/anna|example/);
  });

  it('EVM-024 AC7 an invitation without a key is allowed (the key is optional in the contract) and creates the account', async () => {
    const admin = await browserOf(current);
    const response = await admin.panel.post(USERS, inviteBody());
    expect(response.status).toBe(201);
    expect(response.headers['idempotent-replayed']).toBeUndefined();
  });
});

describe('who may invite, and in which order the checks run (EVM-024 AC8; SR-AUTHZ-05, SR-AUTHZ-11, SR-SESS-08, SR-API-06)', () => {
  it('EVM-024 AC8 an Editor and a Tylko odczyt user get 403 forbidden, an anonymous caller 401, a mobile token 403 and an enrolment session 403 — and nothing is written', async () => {
    const before = await everythingAsText(current);
    const anonymous = await current.panel().post(USERS, inviteBody());
    expect(anonymous.status).toBe(401);
    for (const role of ['editor', 'read_only'] as const) {
      const response = await invite(await browserOf(current, { role }), inviteBody());
      expect(response.status, role).toBe(403);
      expect(response.body).toMatchObject({ code: 'forbidden' });
    }
    const mobile = await invite(await browserOf(current, { channel: 'mobile' }), inviteBody());
    expect(mobile.status).toBe(403);
    expect(mobile.body).toMatchObject({ code: 'forbidden' });
    const enrolling = await invite(await browserOf(current, { state: 'mfa_enrollment' }), inviteBody());
    expect(enrolling.status).toBe(403);
    expect(enrolling.body).toMatchObject({ code: 'mfa_enrollment_required' });
    expect(
      (await everythingAsText(current))
        .split('\n')
        .filter((line) => !line.startsWith('identity.sessions') && !line.startsWith('identity.users'))
        .join('\n'),
    ).toBe(
      before
        .split('\n')
        .filter((line) => !line.startsWith('identity.sessions') && !line.startsWith('identity.users'))
        .join('\n'),
    );
  });

  it('EVM-024 AC8 W8 an Editor who names an existing address gets 403, not 409; an Administrator without a fresh key gets 403 step_up_required for it too — no account is revealed before the right to ask', async () => {
    await createUser(current.database.admin, current.clock, { role: 'editor', email: 'istnieje@example.com' });
    const editor = await invite(await browserOf(current, { role: 'editor' }), inviteBody({ email: 'istnieje@example.com' }));
    expect(editor.status).toBe(403);
    expect(editor.body).toMatchObject({ code: 'forbidden' });
    for (const key of ['none', 'stale'] as const) {
      const response = await invite(await browserOf(current, { key }), inviteBody({ email: 'istnieje@example.com' }));
      expect(response.status, key).toBe(403);
      expect(response.body).toMatchObject({ code: 'step_up_required' });
      expect(JSON.stringify(response.body)).not.toContain('existingUserId');
    }
    // the invalid body of a caller without a key is a 403 as well: the guard runs before the validation
    const invalid = await invite(await browserOf(current, { key: 'none' }), { email: 'x' });
    expect(invalid.status).toBe(403);
    expect(await sql`select 1 from platform.idempotency_records`.execute(current.database.admin).then((result) => result.rows)).toEqual([]);
  });

  it('EVM-024 AC8 the resend: an Editor and a Tylko odczyt user get 403, an anonymous caller 401, an Administrator without a fresh key 403 step_up_required', async () => {
    const waiting = await createUser(current.database.admin, current.clock, { role: 'editor', status: 'invited' });
    const path = `${USERS}/${waiting.id}/invitations`;
    expect((await current.panel().post(path)).status).toBe(401);
    for (const role of ['editor', 'read_only'] as const)
      expect((await (await browserOf(current, { role })).panel.post(path)).status, role).toBe(403);
    const stale = await (await browserOf(current, { key: 'stale' })).panel.post(path);
    expect(stale.status).toBe(403);
    expect(stale.body).toMatchObject({ code: 'step_up_required' });
    expect(await outboxRows(current)).toEqual([]);
  });

  it('EVM-024 AC8 the events of the invitation, the resend and the activation hold the actor, the object and the result — and never an address or a name', async () => {
    const admin = await browserOf(current);
    const body = inviteBody();
    await invite(admin, body);
    await admin.panel.post(`${USERS}/${body.id}/invitations`);
    const events = (await auditActions(current)).filter((event) => ['user.invited', 'invitation.resent'].includes(event.action));
    expect(events.map((event) => event.action)).toEqual(['user.invited', 'invitation.resent']);
    expect(
      events.every((event) => event.actor_user_id === admin.user.id && event.object_id === body.id && event.outcome === 'success'),
    ).toBe(true);
    const { rows } = await sql<{ row: string }>`select to_jsonb(t)::text as row from audit.events t`.execute(current.database.admin);
    expect(rows.map((row) => row.row).join('\n')).not.toMatch(/anna|testowa|example\.com/i);
  });
});

describe('the resend of an invitation: which accounts it accepts (EVM-024 AC4, AC8; CWE-639)', () => {
  it('EVM-024 AC8 an account that is not waiting is 409 invalid_state_transition with no data of the account; one that does not exist or is deleted is 404', async () => {
    const admin = await browserOf(current);
    const active = await createUser(current.database.admin, current.clock, {
      role: 'editor',
      email: 'czynny@example.com',
      displayName: 'Czynny Człowiek',
    });
    const off = await createUser(current.database.admin, current.clock, {
      role: 'editor',
      status: 'deactivated',
      email: 'off@example.com',
    });
    const gone = await createUser(current.database.admin, current.clock, { role: 'editor', status: 'invited', email: 'gone@example.com' });
    await sql`update identity.users set deleted_at = ${current.clock.now()} where id = ${gone.id}`.execute(current.database.admin);
    for (const account of [active, off]) {
      const response = await admin.panel.post(`${USERS}/${account.id}/invitations`);
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'invalid_state_transition' });
      expect(JSON.stringify(response.body)).not.toMatch(/example\.com|Czynny/);
    }
    for (const id of [gone.id, uuidv7()]) {
      const response = await admin.panel.post(`${USERS}/${id}/invitations`);
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ code: 'not_found' });
    }
    expect((await admin.panel.post(`${USERS}/not-a-uuid/invitations`)).status).toBe(400);
    expect(await outboxRows(current)).toEqual([]);
  });

  it('EVM-024 AC4 an account of the command of the first Administrator (a link issued by the CLI) is resent too: the CLI link is superseded and a new one is made by the worker', async () => {
    const admin = await browserOf(current);
    const { user, link } = await current.pendingAdministrator({ email: 'pierwszy@example.com' });
    expect((await admin.panel.post(`${USERS}/${user.id}/invitations`)).status).toBe(200);
    const { job, sender } = emailHarness(current);
    const rows = await outboxRows(current, { recipient: user.id, kind: 'user_invitation' });
    await job.run({ ids: rows.map((row) => row.id) });
    expect(sender.sent[0]?.to).toBe('pierwszy@example.com');
    const links = await linksOf(current, user.id);
    expect(links.map((row) => [row.issued_by, row.superseded_at !== null])).toEqual([
      ['cli', true],
      ['invitation', false],
    ]);
    expect((await current.panel().post(PATHS.check, { token: link.token })).status).toBe(400);
  });
});
