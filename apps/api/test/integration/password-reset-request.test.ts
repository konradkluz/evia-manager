import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD_RESET_RESPONSE_FLOOR_MS } from '../../src/modules/identity/domain/constants.ts';
import { createUser } from '../support/identity-fixtures.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { auditActions, emailHarness, everythingAsText, linksOf, outboxRows } from '../support/invitation-fixtures.ts';
import { enrolledAccount } from '../support/login-flows.ts';
import { processPending, requestReset, RESET } from '../support/password-reset-fixtures.ts';
import { InMemoryEmailSender } from '../../src/platform/email/in-memory-email-sender.ts';
import { EmailTransientError } from '../../src/platform/email/email-errors.ts';

let current: IdentityApp;
beforeEach(async () => {
  current = await createIdentityApp();
});
afterEach(async () => {
  await current.close();
});

const MINUTE = 60_000;
const ACTIVE_EMAIL = 'ewa.aktywna@example.com';

/** The answer without what differs per request (the trace id, the date). */
function shape(response: { status: number; body: unknown; headers: Record<string, unknown> }): string {
  const headers = Object.entries(response.headers)
    .filter(([name]) => !['date', 'etag'].includes(name) && !/trace|request-id/i.test(name))
    .sort(([a], [b]) => a.localeCompare(b));
  const body = JSON.stringify(response.body).replace(/"traceId":"[0-9a-f]+"/, '');
  return JSON.stringify({ status: response.status, body, headers });
}

const nextMinute = (): void => {
  current.clock.advance(MINUTE + 1000);
};

/** One account of every kind the request has to treat alike; @returns the address of each. */
async function everyKindOfAccount(): Promise<Record<string, string>> {
  const db = current.database.admin;
  await enrolledAccount(current, { role: 'editor', email: ACTIVE_EMAIL });
  await createUser(db, current.clock, { role: 'editor', status: 'invited', email: 'zaproszony@example.com' });
  await createUser(db, current.clock, { role: 'editor', status: 'deactivated', email: 'wylaczony@example.com' });
  await createUser(db, current.clock, { role: 'editor', status: 'active', email: 'bez.klucza@example.com' });
  const deleted = await createUser(db, current.clock, { role: 'editor', status: 'active', email: 'usuniety@example.com' });
  await sql`update identity.users set deleted_at = ${current.clock.now()} where id = ${deleted.id}`.execute(db);
  return {
    active: ACTIVE_EMAIL,
    unknown: 'nieznany@example.com',
    invited: 'zaproszony@example.com',
    deactivated: 'wylaczony@example.com',
    'without a passkey': 'bez.klucza@example.com',
    deleted: 'usuniety@example.com',
  };
}

describe('the request for a reset link (EVM-025 AC1; SR-AUTH-11, SR-INPUT-07, CWE-204, CWE-208, CWE-640)', () => {
  it('EVM-025 AC1 an active, an unknown, an invited, a deactivated, a deleted account and one without a passkey get ONE answer: 202 with an empty object, the same headers', async () => {
    const addresses = await everyKindOfAccount();
    const answers = new Map<string, string>();
    for (const [label, email] of Object.entries(addresses)) {
      nextMinute();
      const response = await requestReset(current.panel(), email);
      expect(response.status, label).toBe(202);
      expect(response.body, label).toEqual({});
      answers.set(label, shape(response));
    }
    expect(new Set(answers.values()).size).toBe(1);
  });

  it('EVM-025 AC1 only the active account with a passkey gets a message; no other kind of account gets a row of the outbox, a link or a token', async () => {
    const addresses = await everyKindOfAccount();
    for (const email of Object.values(addresses)) {
      nextMinute();
      await requestReset(current.panel(), email);
    }
    const { rows } = await sql<{ email: string }>`
      select u.email from platform.email_outbox o join identity.users u on u.id = o.recipient_user_id where o.kind = 'password_reset'`.execute(
      current.database.admin,
    );
    expect(rows).toEqual([{ email: ACTIVE_EMAIL }]);
    const { rows: links } = await sql`select 1 from identity.one_time_links where purpose = 'password_reset'`.execute(
      current.database.admin,
    );
    expect(links).toEqual([]); // the token is made by the worker, at the sending
  });

  it('EVM-025 AC1 the mail has only a link, the validity of 30 minutes and the footer; it goes to the address of the account — and holds no name, no address and no token in any table', async () => {
    const account = await enrolledAccount(current, { role: 'editor', email: ACTIVE_EMAIL });
    const harness = emailHarness(current);
    nextMinute();
    await requestReset(current.panel(), account.email);
    const { token, text } = await processPending(current, account.user.id, harness);

    const sent = harness.sender.sent.at(-1);
    expect(String(sent?.to)).toBe(ACTIVE_EMAIL);
    expect(sent?.subject).toBe('EVia Manager: link do ustawienia nowego hasła');
    expect(text).toContain('Link jest jednorazowy i ważny 30 minut — do ');
    expect(text).toContain(`https://panel.evia.test/reset-password#${token}`);
    expect(text).not.toContain(ACTIVE_EMAIL);
    expect(text).not.toMatch(/Użytkownik|ewa/i);
    expect(await everythingAsText(current)).not.toContain(token);
    expect(JSON.stringify(current.logs.entries)).not.toContain(token);
  });

  it('EVM-025 AC1 every answer waits for the same floor from the start of the request, in every branch', async () => {
    const addresses = await everyKindOfAccount();
    current.sleeper.slept.length = 0;
    for (const email of Object.values(addresses)) {
      nextMinute();
      await requestReset(current.panel(), email);
    }
    expect(current.sleeper.slept).toEqual(Array.from({ length: Object.keys(addresses).length }, () => PASSWORD_RESET_RESPONSE_FLOOR_MS));
  });

  it('EVM-025 AC1 the recipient is the address of the account, never the text of the request: case and spaces find the account, a line break or another address does not', async () => {
    await enrolledAccount(current, { role: 'editor', email: ACTIVE_EMAIL });
    const harness = emailHarness(current);
    nextMinute();
    expect((await requestReset(current.panel(), '  EWA.Aktywna@Example.com ')).status).toBe(202);
    const [account] = await outboxRows(current, { kind: 'password_reset' });
    await harness.job.run({ ids: [account?.id ?? ''] });
    expect(harness.sender.sent.map((email) => String(email.to))).toEqual([ACTIVE_EMAIL]);

    for (const email of [`${ACTIVE_EMAIL}\r\nBcc: obcy@example.com`, `${ACTIVE_EMAIL},obcy@example.com`, 'ewa.aktywna@example.com\u0000']) {
      nextMinute();
      expect((await requestReset(current.panel(), email)).status).toBe(202);
    }
    expect(await outboxRows(current, { kind: 'password_reset' })).toHaveLength(1);
    expect(harness.sender.sent).toHaveLength(1);
  });

  it('EVM-025 AC1 a body that is not of the schema is 400 validation_failed with no information about accounts; an unknown field and a missing e-mail are refused', async () => {
    const answers: string[] = [];
    for (const body of [{}, { email: '' }, { email: 5 }, { email: 'x'.repeat(255) }, { email: ACTIVE_EMAIL, role: 'administrator' }]) {
      const response = await current.panel().post(RESET.request, body);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'validation_failed' });
      answers.push(JSON.stringify(response.body).replace(/"traceId":"[0-9a-f]+"/, ''));
    }
    expect(answers.join('')).not.toMatch(/ewa|exist|account/i);
  });

  it('EVM-025 AC1 an account asks at most once per minute and five times per hour; the held-back request gets the same 202 and writes nothing — not even an audit event', async () => {
    await enrolledAccount(current, { role: 'editor', email: ACTIVE_EMAIL });
    const before = (await auditActions(current)).length;
    expect((await requestReset(current.panel(), ACTIVE_EMAIL)).status).toBe(202);
    const requested = (await auditActions(current)).length;
    expect(requested).toBe(before + 1);
    const held = await requestReset(current.panel(), ACTIVE_EMAIL);
    expect(held.status).toBe(202);
    expect(held.body).toEqual({});
    expect(await outboxRows(current, { kind: 'password_reset' })).toHaveLength(1);
    expect((await auditActions(current)).length).toBe(requested);

    for (let time = 0; time < 4; time += 1) {
      nextMinute();
      await requestReset(current.panel(), ACTIVE_EMAIL);
    }
    expect(await outboxRows(current, { kind: 'password_reset' })).toHaveLength(5);
    nextMinute();
    await requestReset(current.panel(), ACTIVE_EMAIL); // the sixth within the hour
    expect(await outboxRows(current, { kind: 'password_reset' })).toHaveLength(5);
    current.clock.advance(60 * MINUTE);
    await requestReset(current.panel(), ACTIVE_EMAIL);
    expect(await outboxRows(current, { kind: 'password_reset' })).toHaveLength(6);
  });

  it('EVM-025 AC1 a newer request replaces the message that still waits: the worker sends one mail, with the newest link only', async () => {
    const account = await enrolledAccount(current, { role: 'editor', email: ACTIVE_EMAIL });
    await requestReset(current.panel(), ACTIVE_EMAIL);
    nextMinute();
    await requestReset(current.panel(), ACTIVE_EMAIL);
    const rows = await outboxRows(current, { recipient: account.user.id, kind: 'password_reset' });
    expect(rows.map((row) => row.state)).toEqual(['superseded', 'pending']);
    const harness = emailHarness(current);
    await harness.job.run({ ids: rows.map((row) => row.id) });
    expect(harness.sender.sent).toHaveLength(1);
  });

  it('EVM-025 AC1 the audit trail records who asked for what, without the address, the name or the token; an unknown or deleted account leaves no event', async () => {
    const addresses = await everyKindOfAccount();
    const before = (await auditActions(current)).length;
    for (const email of Object.values(addresses)) {
      nextMinute();
      await requestReset(current.panel(), email);
    }
    const events = (await auditActions(current)).slice(before).filter((event) => event.action === 'password.reset_requested');
    expect(events.map((event) => [event.outcome, event.reason_code, event.actor_type])).toEqual([
      ['success', null, 'anonymous'],
      ['denied', 'not_active', 'anonymous'],
      ['denied', 'not_active', 'anonymous'],
      ['denied', 'other', 'anonymous'],
    ]);
    // the accounts themselves hold their addresses; nothing else may
    const elsewhere = (await everythingAsText(current))
      .split(String.fromCharCode(10))
      .filter((line) => !line.startsWith('identity.users '))
      .join(String.fromCharCode(10));
    expect(elsewhere).not.toMatch(/ewa\.aktywna|zaproszony@|wylaczony@|bez\.klucza@/);
  });

  it('EVM-025 AC1 a failure of the mail service changes nothing in the answer of the request, and the link of a failed attempt is never kept as a token', async () => {
    const account = await enrolledAccount(current, { role: 'editor', email: ACTIVE_EMAIL });
    const sender = new InMemoryEmailSender();
    sender.failAll(new EmailTransientError('connection_failed'));
    const harness = emailHarness(current, sender);
    const response = await requestReset(current.panel(), ACTIVE_EMAIL);
    expect(response.status).toBe(202);
    const rows = await outboxRows(current, { recipient: account.user.id, kind: 'password_reset' });
    await expect(harness.job.run({ ids: rows.map((row) => row.id) })).rejects.toBeDefined();
    const [link] = (await linksOf(current, account.user.id)).filter((candidate) => candidate.issued_by === 'password_reset');
    expect(link?.token_hash).toHaveLength(32); // only the hash exists
    expect(sender.sent).toHaveLength(0); // nothing was handed over
    const stored = await everythingAsText(current);
    const { rows: jobs } = await sql<{ row: string }>`select to_jsonb(j)::text as row from pgboss.job j`.execute(current.database.admin);
    expect(stored + jobs.map((job) => job.row).join('')).not.toContain('reset-password');
  });
});

describe('the limit of requests (EVM-025 AC6; SR-API-02, P10)', () => {
  it('EVM-025 AC6 after 60 anonymous requests in a minute from one address the next request for a link is 429 rate_limited with Retry-After — the same for every address', async () => {
    await enrolledAccount(current, { role: 'editor', email: ACTIVE_EMAIL });
    for (let time = 0; time < 60; time += 1) {
      const response = await requestReset(current.panel(), `osoba-${time}@example.com`);
      expect(response.status).toBe(202);
    }
    const known = await requestReset(current.panel(), ACTIVE_EMAIL);
    const unknown = await requestReset(current.panel(), 'nikt@example.com');
    expect(known.status).toBe(429);
    expect(unknown.status).toBe(429);
    expect(known.body).toMatchObject({ code: 'rate_limited' });
    expect(Number(known.headers['retry-after'])).toBeGreaterThan(0);
    expect(shape(known)).toBe(shape(unknown));
    expect(await outboxRows(current, { kind: 'password_reset' })).toEqual([]); // nothing happened behind a refused request
  });

  it('EVM-025 AC6 the check and the completion share the limit of anonymous operations', async () => {
    for (let time = 0; time < 60; time += 1) await current.panel().post(RESET.check, { token: 'A'.repeat(43) });
    const response = await current.panel().post(RESET.complete, { token: 'A'.repeat(43), password: 'x' });
    expect(response.status).toBe(429);
  });
});
